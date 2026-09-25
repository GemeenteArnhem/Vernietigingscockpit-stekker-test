import crypto from 'node:crypto';
import { stekkerConfig } from '../config/stekker-config.js';
import { SelectieStatus, Uitvoeringsresultaat, VernietigingStatus } from '../domain/status.js';

export class VernietigingService {
  constructor({
    zaakSource,
    selectieService,
    vernietigingRepository,
    clock = () => new Date()
  }) {
    this.zaakSource = zaakSource;
    this.selectieService = selectieService;
    this.vernietigingRepository = vernietigingRepository;
    this.clock = clock;
  }

  startVernietiging({
    selectieId,
    cockpitTaakId,
    besluitReferentie,
    vernietigingsdossierId
  }) {
    const selectie = this.selectieService.getSelectie(selectieId);

    if (!selectie) {
      throw new ResourceNotFoundError('SELECTIE_NOT_FOUND', 'Selectie niet gevonden.');
    }

    if (selectie.selectiestatus !== SelectieStatus.READY) {
      throw new ConflictError('SELECTIE_NOT_READY', `Selectie ${selectieId} is nog niet gereed.`);
    }

    if (!cockpitTaakId || !besluitReferentie) {
      throw new ValidationError('cockpitTaakId en besluitReferentie zijn verplicht.');
    }

    const starttijd = this.clock().toISOString();
    const vernietiging = {
      vernietigingId: makeVernietigingId({ selectieId, starttijd }),
      selectieId,
      cockpitTaakId,
      besluitReferentie,
      vernietigingsdossierId,
      status: VernietigingStatus.IDLE,
      starttijd,
      eindtijd: undefined,
      totaalKandidaten: 0,
      totaalObjecten: 0,
      totaalBatches: 0,
      ontvangenBatches: 0,
      succesvolVernietigd: 0,
      mislukt: 0,
      overgeslagen: 0,
      gewijzigd: 0,
      nietGevonden: 0,
      stekkerNaam: stekkerConfig.naam,
      stekkerOmschrijving: stekkerConfig.omschrijving,
      stekkerversie: stekkerConfig.versie,
      configuratieversie: stekkerConfig.configuratieversie,
      aantalWaarschuwingen: 0,
      aantalFouten: 0,
      batches: [],
      resultaten: []
    };

    return this.vernietigingRepository.save(vernietiging);
  }

  getVernietiging(vernietigingId) {
    return this.vernietigingRepository.findById(vernietigingId);
  }

  voegBatchToe(vernietigingId, { batchNummer, objecten }) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);

    if (vernietiging.status !== VernietigingStatus.IDLE) {
      throw new ConflictError('VERNIETIGING_NOT_IDLE', 'Batches kunnen alleen worden toegevoegd zolang de vernietiging IDLE is.');
    }

    if (!Number.isInteger(batchNummer) || batchNummer < 1) {
      throw new ValidationError('batchNummer moet een positief geheel getal zijn.');
    }

    if (!Array.isArray(objecten) || objecten.length === 0) {
      throw new ValidationError('objecten moet minimaal een kandidaat bevatten.');
    }

    const normalizedBatch = {
      batchNummer,
      ontvangenTijdstip: this.clock().toISOString(),
      objecten: objecten.map((object) => ({
        vernietigingskandidaatId: object.vernietigingskandidaatId,
        bronId: object.bronId
      }))
    };

    const existingBatch = vernietiging.batches.find((batch) => batch.batchNummer === batchNummer);

    if (existingBatch) {
      if (JSON.stringify(existingBatch.objecten) !== JSON.stringify(normalizedBatch.objecten)) {
        throw new ConflictError('BATCH_CONFLICT', 'BatchNummer bestaat al met een afwijkende inhoud.');
      }

      return existingBatch;
    }

    vernietiging.batches.push(normalizedBatch);
    vernietiging.ontvangenBatches = vernietiging.batches.length;
    vernietiging.totaalKandidaten = vernietiging.batches.reduce((total, batch) => total + batch.objecten.length, 0);
    vernietiging.totaalObjecten = vernietiging.totaalKandidaten;

    this.vernietigingRepository.save(vernietiging);
    return normalizedBatch;
  }

  async vrijgeven(vernietigingId, { aantalBatches, aantalKandidaten }) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);

    if (vernietiging.status === VernietigingStatus.COMPLETED) {
      return vernietiging;
    }

    if (vernietiging.status !== VernietigingStatus.IDLE) {
      throw new ConflictError('VERNIETIGING_NOT_IDLE', 'Vernietiging kan alleen worden vrijgegeven vanuit IDLE.');
    }

    if (aantalBatches !== vernietiging.batches.length || aantalKandidaten !== vernietiging.totaalKandidaten) {
      throw new ConflictError('AANTALLEN_CONFLICT', 'Aangeleverde aantallen komen niet overeen met ontvangen batches.');
    }

    const running = this.vernietigingRepository.save({
      ...vernietiging,
      status: VernietigingStatus.RUNNING,
      totaalBatches: aantalBatches
    });

    return this.verwerkVernietiging(running.vernietigingId);
  }

  async verwerkVernietiging(vernietigingId) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const selectie = this.selectieService.getSelectie(vernietiging.selectieId);

    if (!selectie) {
      throw new ResourceNotFoundError('SELECTIE_NOT_FOUND', 'Selectie niet gevonden.');
    }

    const snapshotRecords = await this.zaakSource.findAllFrom(selectie.snapshotBronPath);
    const kandidaatById = new Map(selectie.kandidaten.map((kandidaat) => [kandidaat.vernietigingskandidaatId, kandidaat]));
    const recordByBronId = new Map(snapshotRecords.map((record) => [record.bronId, record]));
    const resultaten = [];

    for (const batch of vernietiging.batches) {
      for (const object of batch.objecten) {
        const kandidaat = kandidaatById.get(object.vernietigingskandidaatId);
        const record = recordByBronId.get(object.bronId);

        resultaten.push(executeObject({
          kandidaat,
          record,
          object,
          batchNummer: batch.batchNummer,
          correlatieId: `${vernietiging.vernietigingId}-${batch.batchNummer}-${object.vernietigingskandidaatId}`
        }));
      }
    }

    await this.zaakSource.saveAllTo(selectie.snapshotBronPath, snapshotRecords);

    const completed = {
      ...vernietiging,
      status: VernietigingStatus.COMPLETED,
      eindtijd: this.clock().toISOString(),
      resultaten,
      succesvolVernietigd: resultaten.filter((resultaat) => resultaat.resultaat === Uitvoeringsresultaat.SUCCESS).length,
      mislukt: resultaten.filter((resultaat) => resultaat.resultaat === Uitvoeringsresultaat.FAILED).length,
      overgeslagen: resultaten.filter((resultaat) => resultaat.resultaat === Uitvoeringsresultaat.SKIPPED).length,
      gewijzigd: resultaten.filter((resultaat) => resultaat.resultaat === Uitvoeringsresultaat.CHANGED).length,
      nietGevonden: resultaten.filter((resultaat) => resultaat.resultaat === Uitvoeringsresultaat.NOT_FOUND).length
    };

    return this.vernietigingRepository.save(completed);
  }

  getResultaten(vernietigingId, { offset = 0, limit = 100 } = {}) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));

    return {
      vernietigingId,
      offset: safeOffset,
      limit: safeLimit,
      totaal: vernietiging.resultaten.length,
      resultaten: vernietiging.resultaten.slice(safeOffset, safeOffset + safeLimit)
    };
  }

  mustGetVernietiging(vernietigingId) {
    const vernietiging = this.getVernietiging(vernietigingId);

    if (!vernietiging) {
      throw new ResourceNotFoundError('VERNIETIGING_NOT_FOUND', 'Vernietiging niet gevonden.');
    }

    return vernietiging;
  }
}

function executeObject({ kandidaat, record, object, batchNummer, correlatieId }) {
  const baseResult = {
    vernietigingskandidaatId: object.vernietigingskandidaatId,
    bronId: object.bronId,
    batchNummer,
    logReference: `log-${correlatieId}`,
    correlatieId
  };

  if (!kandidaat || !record || record.bronstatus === 'VERNIETIGD') {
    return {
      ...baseResult,
      resultaat: Uitvoeringsresultaat.NOT_FOUND,
      foutcode: 'NOT_FOUND',
      foutmelding: 'Kandidaat of bronrecord niet gevonden in selectie-snapshot.',
      bronstatus: record?.bronstatus ?? 'ONTBREEKT'
    };
  }

  if (record.bronstatus === 'GEWIJZIGD') {
    return {
      ...baseResult,
      resultaat: Uitvoeringsresultaat.CHANGED,
      foutcode: 'CHANGED',
      foutmelding: 'Bronrecord is gewijzigd sinds selectie.',
      bronstatus: record.bronstatus
    };
  }

  record.bronstatus = 'VERNIETIGD';
  record.statusVernietigingskandidaat = 'VERNIETIGD';
  record.toelichting = `${record.toelichting || ''} | Vernietigd via teststekker.`.trim();

  return {
    ...baseResult,
    resultaat: Uitvoeringsresultaat.SUCCESS,
    bronstatus: record.bronstatus
  };
}

function makeVernietigingId({ selectieId, starttijd }) {
  const hash = crypto
    .createHash('sha256')
    .update(`${selectieId}:${starttijd}`)
    .digest('hex')
    .slice(0, 12);

  return `vern-${hash}`;
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

export class ConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}

export class ResourceNotFoundError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResourceNotFoundError';
    this.code = code;
  }
}
