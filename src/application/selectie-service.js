import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stekkerConfig } from '../config/stekker-config.js';
import { SelectieStatus } from '../domain/status.js';
import { isVernietigbaarOpPeildatum, selectielijstjaarVoorZaakjaar } from '../domain/selectielijst.js';
import { mapBronrecordToKandidaat, validateBronrecord } from '../domain/vernietigingskandidaat.js';

export class SelectieService {
  constructor({
    zaakSource,
    selectieRepository,
    clock = () => new Date(),
    processingDelayMs = stekkerConfig.selectieProcessingDelayMs
  }) {
    this.zaakSource = zaakSource;
    this.selectieRepository = selectieRepository;
    this.clock = clock;
    this.processingDelayMs = processingDelayMs;
  }

  async startSelectie({ peildatum = stekkerConfig.defaultPeildatum } = {}) {
    const selectietijdstip = this.clock().toISOString();
    const selectieId = makeSelectieId({ peildatum, selectietijdstip });
    const snapshotDir = path.join(stekkerConfig.runtime.selectiesPath, selectieId);
    const snapshotBronPath = path.join(snapshotDir, 'bron-snapshot.csv');

    await fs.mkdir(snapshotDir, { recursive: true });
    await this.zaakSource.copyTo(snapshotBronPath);

    const selectie = {
      selectieId,
      peildatum,
      selectietijdstip,
      processingDelayMs: this.processingDelayMs,
      snapshotBronPath,
      selectiestatus: SelectieStatus.RUNNING,
      totaalKandidaten: 0,
      totaalObjecten: 0,
      totaalBetrokkenen: 0,
      bronRecords: 0,
      stekkerNaam: stekkerConfig.naam,
      stekkerOmschrijving: stekkerConfig.omschrijving,
      stekkerversie: stekkerConfig.versie,
      configuratieversie: stekkerConfig.configuratieversie,
      apiVersie: stekkerConfig.apiVersie,
      aantalWaarschuwingen: 0,
      aantalFouten: 0,
      waarschuwingen: [],
      kandidaten: []
    };

    this.selectieRepository.save(selectie);

    if (this.processingDelayMs <= 0) {
      return this.completeSelectie(selectieId);
    }

    setTimeout(() => {
      this.completeSelectie(selectieId).catch((error) => {
        const failedSelection = this.selectieRepository.findById(selectieId);

        if (failedSelection) {
          this.selectieRepository.save({
            ...failedSelection,
            selectiestatus: SelectieStatus.FAILED,
            aantalFouten: 1,
            foutmelding: error.message
          });
        }
      });
    }, this.processingDelayMs);

    return selectie;
  }

  async completeSelectie(selectieId) {
    const selectie = this.getSelectie(selectieId);

    if (!selectie) {
      return undefined;
    }

    const records = await this.zaakSource.findAllFrom(selectie.snapshotBronPath);
    const waarschuwingen = [];
    const kandidaten = [];

    records.forEach((record, index) => {
      const validation = validateBronrecord(record, index + 2);

      if (!validation.valid) {
        waarschuwingen.push(validation.message);
        return;
      }

      const zaakjaar = Number.parseInt(record.begindatum.slice(0, 4), 10);
      const verwachtSelectielijstjaar = selectielijstjaarVoorZaakjaar(zaakjaar);

      if (Number.parseInt(record.selectielijstjaar, 10) !== verwachtSelectielijstjaar) {
        waarschuwingen.push(
          `Rij ${index + 2}: selectielijstjaar ${record.selectielijstjaar} wijkt af van mapping ${verwachtSelectielijstjaar}.`
        );
        return;
      }

      const kandidaat = mapBronrecordToKandidaat(record);

      if (isVernietigbaarOpPeildatum(kandidaat, selectie.peildatum)) {
        kandidaten.push(kandidaat);
      }
    });

    const completedSelection = {
      ...selectie,
      gereedTijdstip: this.clock().toISOString(),
      selectiestatus: SelectieStatus.READY,
      totaalKandidaten: kandidaten.length,
      totaalObjecten: kandidaten.reduce((total, kandidaat) => total + kandidaat.aantalObjecten, 0),
      totaalBetrokkenen: kandidaten.reduce((total, kandidaat) => total + kandidaat.aantalBetrokkenen, 0),
      bronRecords: records.length,
      aantalWaarschuwingen: waarschuwingen.length,
      aantalFouten: 0,
      waarschuwingen,
      kandidaten
    };

    return this.selectieRepository.save(completedSelection);
  }

  getSelectie(selectieId) {
    return this.selectieRepository.findById(selectieId);
  }

  getKandidaten(selectieId, { offset = 0, limit = 100 } = {}) {
    const selectie = this.getSelectie(selectieId);

    if (!selectie) {
      return undefined;
    }

    if (selectie.selectiestatus !== SelectieStatus.READY) {
      throw new SelectieNogNietGereedError(selectieId, selectie.selectiestatus);
    }

    const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));

    return {
      selectieId: selectie.selectieId,
      offset: safeOffset,
      limit: safeLimit,
      totaal: selectie.kandidaten.length,
      objecten: selectie.kandidaten.slice(safeOffset, safeOffset + safeLimit)
    };
  }
}

export class SelectieNogNietGereedError extends Error {
  constructor(selectieId, status) {
    super(`Selectie ${selectieId} is nog niet gereed; huidige status is ${status}.`);
    this.name = 'SelectieNogNietGereedError';
    this.selectieId = selectieId;
    this.status = status;
  }
}

function makeSelectieId({ peildatum, selectietijdstip }) {
  const hash = crypto
    .createHash('sha256')
    .update(`${peildatum}:${selectietijdstip}`)
    .digest('hex')
    .slice(0, 12);

  return `sel-${peildatum.replaceAll('-', '')}-${hash}`;
}
