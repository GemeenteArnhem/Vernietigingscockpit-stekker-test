import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GEEN_SCENARIO } from '../config/scenario-config.js';
import { stekkerConfig } from '../config/stekker-config.js';
import { SelectieStatus } from '../domain/status.js';
import { ValidationError } from './errors.js';
import { isVernietigbaarOpPeildatum, selectielijstjaarVoorZaakjaar } from '../domain/selectielijst.js';
import { mapBronrecordToKandidaat, validateBronrecord } from '../domain/vernietigingskandidaat.js';

export class SelectieService {
  constructor({
    zaakSource,
    selectieRepository,
    clock = () => new Date(),
    processingDelayMs = stekkerConfig.selectieProcessingDelayMs,
    scenario = stekkerConfig.scenario ?? GEEN_SCENARIO
  }) {
    this.zaakSource = zaakSource;
    this.selectieRepository = selectieRepository;
    this.clock = clock;
    this.processingDelayMs = processingDelayMs;
    this.scenario = scenario;
    this.afgerondeSelecties = new Map();
  }

  async startSelectie({ peildatum = stekkerConfig.defaultPeildatum } = {}) {
    if (!isGeldigeDatum(peildatum)) {
      throw new ValidationError('peildatum moet een geldige datum zijn in de vorm JJJJ-MM-DD.');
    }

    const selectietijdstip = this.clock().toISOString();
    const selectieId = makeSelectieId(peildatum);
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
      status: SelectieStatus.RUNNING,
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
      return this.voltooiSelectie(selectieId);
    }

    // unref: de timer alleen houdt het proces niet in leven; in de stekker doet de
    // HTTP-server dat al, en een test hoeft niet op een openstaande selectie te wachten.
    setTimeout(() => {
      void this.voltooiSelectie(selectieId);
    }, this.processingDelayMs).unref();

    return selectie;
  }

  // Na een herstart van de stekker: selecties die nog RUNNING waren, alsnog afronden.
  async hervatOnderbrokenSelecties() {
    const onderbroken = this.selectieRepository.findAll()
      .filter((selectie) => selectie.status === SelectieStatus.RUNNING);

    await Promise.all(onderbroken.map(({ selectieId }) => this.voltooiSelectie(selectieId)));
    return onderbroken.map(({ selectieId }) => selectieId);
  }

  // Een fout tijdens het selecteren levert een selectie met status FAILED op,
  // niet een 500: de Cockpit ziet de fout via GET /selecties/{selectieId}.
  async voltooiSelectie(selectieId) {
    try {
      return await this.completeSelectie(selectieId);
    } catch (error) {
      const failedSelection = this.selectieRepository.findById(selectieId);

      if (!failedSelection) {
        return undefined;
      }

      return this.selectieRepository.save({
        ...failedSelection,
        status: SelectieStatus.FAILED,
        aantalFouten: 1,
        foutmelding: error.message
      });
    }
  }

  async completeSelectie(selectieId) {
    const selectie = this.getSelectie(selectieId);

    if (!selectie) {
      return undefined;
    }

    if (this.scenario.selectieFail) {
      throw new Error('Selectie mislukt (gesimuleerd via SCENARIO_SELECTIE_FAIL).');
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
      status: SelectieStatus.READY,
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

  // Een selectie in eindstatus (READY of FAILED) verandert niet meer. Die wordt na de
  // eerste keer bevroren in het geheugen gehouden, zodat pagineren en batch-aanlevering
  // bij grote selecties niet steeds het hele bestand opnieuw inlezen.
  getSelectie(selectieId) {
    const gecachet = this.afgerondeSelecties.get(selectieId);

    if (gecachet) {
      return gecachet;
    }

    const selectie = this.selectieRepository.findById(selectieId);

    if (selectie && (selectie.status === SelectieStatus.READY || selectie.status === SelectieStatus.FAILED)) {
      const bevroren = diepBevriezen(selectie);
      this.afgerondeSelecties.set(selectieId, bevroren);
      return bevroren;
    }

    return selectie;
  }

  getKandidaten(selectieId, { offset = 0, limit = 100 } = {}) {
    const selectie = this.getSelectie(selectieId);

    if (!selectie) {
      return undefined;
    }

    if (selectie.status !== SelectieStatus.READY) {
      throw new SelectieNogNietGereedError(selectieId, selectie.status);
    }

    const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));

    return {
      selectieId: selectie.selectieId,
      offset: safeOffset,
      limit: safeLimit,
      totaal: selectie.kandidaten.length,
      items: selectie.kandidaten.slice(safeOffset, safeOffset + safeLimit)
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

function diepBevriezen(waarde) {
  if (waarde && typeof waarde === 'object' && !Object.isFrozen(waarde)) {
    Object.values(waarde).forEach(diepBevriezen);
    Object.freeze(waarde);
  }

  return waarde;
}

function isGeldigeDatum(waarde) {
  if (typeof waarde !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(waarde)) {
    return false;
  }

  const datum = new Date(`${waarde}T00:00:00Z`);
  return !Number.isNaN(datum.getTime()) && datum.toISOString().slice(0, 10) === waarde;
}

// Leesbaar prefix met de peildatum, plus een willekeurig deel zodat twee selecties
// in dezelfde milliseconde nooit hetzelfde id krijgen.
function makeSelectieId(peildatum) {
  return `sel-${peildatum.replaceAll('-', '')}-${crypto.randomBytes(6).toString('hex')}`;
}
