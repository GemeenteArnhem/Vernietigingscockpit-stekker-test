import crypto from 'node:crypto';
import { GEEN_SCENARIO, scenarioResultaat } from '../config/scenario-config.js';
import { stekkerConfig } from '../config/stekker-config.js';
import { SelectieStatus, Uitvoeringsresultaat, VernietigingStatus } from '../domain/status.js';
import { ConflictError, ResourceNotFoundError, ValidationError } from './errors.js';
import { InMemoryIdempotencyRepository } from '../infrastructure/repositories/in-memory-idempotency-repository.js';

export { ConflictError, ResourceNotFoundError, ValidationError };

export class VernietigingService {
  constructor({
    zaakSource,
    selectieService,
    vernietigingRepository,
    clock = () => new Date(),
    processingDelayMs = stekkerConfig.vernietigingProcessingDelayMs,
    idempotencyRepository = new InMemoryIdempotencyRepository(),
    idempotencyKeyRequired = stekkerConfig.idempotencyKeyRequired,
    scenario = stekkerConfig.scenario ?? GEEN_SCENARIO
  }) {
    this.zaakSource = zaakSource;
    this.selectieService = selectieService;
    this.vernietigingRepository = vernietigingRepository;
    this.clock = clock;
    this.processingDelayMs = processingDelayMs;
    this.idempotencyRepository = idempotencyRepository;
    this.idempotencyKeyRequired = idempotencyKeyRequired;
    this.scenario = scenario;
    this.lopendeVerwerkingen = new Map();
    this.snapshotLocks = new Map();
    this.snapshotCache = new Map();
    this.vernietigdCache = new Map();
  }

  startVernietiging({
    selectieId,
    cockpitTaakId,
    besluitReferentie,
    vernietigingsdossierId
  }, { idempotencyKey } = {}) {
    const idempotentie = this.controleerIdempotentie('POST /vernietigingen', idempotencyKey, {
      selectieId,
      cockpitTaakId,
      besluitReferentie,
      vernietigingsdossierId
    });

    if (idempotentie.registratie) {
      return this.mustGetVernietiging(idempotentie.registratie.vernietigingId);
    }

    const selectie = this.selectieService.getSelectie(selectieId);

    if (!selectie) {
      throw new ResourceNotFoundError('SELECTIE_NOT_FOUND', 'Selectie niet gevonden.');
    }

    if (selectie.status !== SelectieStatus.READY) {
      throw new ConflictError('SELECTIE_NOT_READY', `Selectie ${selectieId} is nog niet gereed.`);
    }

    if (!cockpitTaakId || !besluitReferentie) {
      throw new ValidationError('cockpitTaakId en besluitReferentie zijn verplicht.');
    }

    const starttijd = this.clock().toISOString();
    const vernietiging = {
      vernietigingId: makeVernietigingId(),
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

    this.vernietigingRepository.save(vernietiging);
    this.registreerIdempotentie(idempotentie, vernietiging.vernietigingId);
    return vernietiging;
  }

  getVernietiging(vernietigingId) {
    return this.vernietigingRepository.findById(vernietigingId);
  }

  voegBatchToe(vernietigingId, { batchNummer, objecten }, { idempotencyKey } = {}) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const idempotentie = this.controleerIdempotentie(`POST /vernietigingen/${vernietigingId}/batches`, idempotencyKey, {
      batchNummer,
      objecten: Array.isArray(objecten)
        ? objecten.map((object) => ({ vernietigingskandidaatId: object?.vernietigingskandidaatId, bronId: object?.bronId }))
        : objecten
    });

    // Een herhaling mag ook na vrijgeven: de cockpit kan na een crash niet weten of de batch al binnen was.
    if (idempotentie.registratie) {
      return this.toBatchResultaat(vernietiging, idempotentie.registratie.batchNummer);
    }

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

      return this.toBatchResultaat(vernietiging, batchNummer);
    }

    this.valideerObjecten(vernietiging, normalizedBatch.objecten);

    vernietiging.batches.push(normalizedBatch);
    vernietiging.ontvangenBatches = vernietiging.batches.length;
    vernietiging.totaalKandidaten = vernietiging.batches.reduce((total, batch) => total + batch.objecten.length, 0);
    vernietiging.totaalObjecten = this.telObjecten(vernietiging);

    this.vernietigingRepository.save(vernietiging);
    this.registreerIdempotentie(idempotentie, vernietigingId, { batchNummer });
    return this.toBatchResultaat(vernietiging, batchNummer);
  }

  // Idempotency-Key, per endpoint (scope). Dezelfde key met dezelfde inhoud levert
  // dezelfde resource in de actuele stand; dezelfde key met andere inhoud geeft 409.
  controleerIdempotentie(scope, idempotencyKey, request) {
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';

    if (!key) {
      if (this.idempotencyKeyRequired) {
        throw new ValidationError('Idempotency-Key is verplicht voor deze stekker (IDEMPOTENCY_KEY_REQUIRED=true).');
      }

      return {};
    }

    const vingerafdruk = vingerafdrukVan(request);
    const registratie = this.idempotencyRepository.find(scope, key);

    if (registratie && registratie.vingerafdruk !== vingerafdruk) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency-Key is al gebruikt voor een verzoek met een andere inhoud.'
      );
    }

    return { scope, key, vingerafdruk, registratie };
  }

  registreerIdempotentie({ scope, key, vingerafdruk }, vernietigingId, extra = {}) {
    if (key) {
      this.idempotencyRepository.save(scope, key, { vingerafdruk, vernietigingId, ...extra });
    }
  }

  // Een batch wordt alleen geaccepteerd als elk object een kandidaat uit de selectie is,
  // met precies het bronId dat de stekker voor die kandidaat heeft vastgelegd.
  valideerObjecten(vernietiging, objecten) {
    const selectie = this.selectieService.getSelectie(vernietiging.selectieId);
    const kandidaatById = new Map(
      (selectie?.kandidaten ?? []).map((kandidaat) => [kandidaat.vernietigingskandidaatId, kandidaat])
    );
    const inDezeBatch = new Set();
    const alAangeleverd = new Map(
      vernietiging.batches.flatMap((batch) => batch.objecten.map((object) => [object.vernietigingskandidaatId, batch.batchNummer]))
    );

    for (const { vernietigingskandidaatId, bronId } of objecten) {
      if (typeof vernietigingskandidaatId !== 'string' || !vernietigingskandidaatId || typeof bronId !== 'string' || !bronId) {
        throw new ValidationError('Elk object moet een vernietigingskandidaatId en een bronId bevatten.');
      }

      if (inDezeBatch.has(vernietigingskandidaatId)) {
        throw new ValidationError(`Kandidaat ${vernietigingskandidaatId} komt meer dan eens voor in deze batch.`);
      }

      inDezeBatch.add(vernietigingskandidaatId);
      const kandidaat = kandidaatById.get(vernietigingskandidaatId);

      if (!kandidaat) {
        throw new ValidationError(`Kandidaat ${vernietigingskandidaatId} komt niet voor in selectie ${vernietiging.selectieId}.`);
      }

      if (kandidaat.bronId !== bronId) {
        throw new ValidationError(`bronId ${bronId} hoort niet bij kandidaat ${vernietigingskandidaatId}.`);
      }

      if (alAangeleverd.has(vernietigingskandidaatId)) {
        throw new ConflictError(
          'KANDIDAAT_AL_AANGELEVERD',
          `Kandidaat ${vernietigingskandidaatId} is al aangeleverd in batch ${alAangeleverd.get(vernietigingskandidaatId)}.`
        );
      }
    }
  }

  telObjecten(vernietiging) {
    const selectie = this.selectieService.getSelectie(vernietiging.selectieId);
    const aantalObjectenPerKandidaat = new Map(
      (selectie?.kandidaten ?? []).map((kandidaat) => [kandidaat.vernietigingskandidaatId, kandidaat.aantalObjecten])
    );

    return vernietiging.batches
      .flatMap((batch) => batch.objecten)
      .reduce((total, object) => total + (aantalObjectenPerKandidaat.get(object.vernietigingskandidaatId) ?? 0), 0);
  }

  async vrijgeven(vernietigingId, { aantalBatches, aantalKandidaten }, { idempotencyKey } = {}) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const idempotentie = this.controleerIdempotentie(`POST /vernietigingen/${vernietigingId}/vrijgeven`, idempotencyKey, {
      aantalBatches,
      aantalKandidaten
    });

    if (idempotentie.registratie) {
      return vernietiging;
    }

    if (vernietiging.status === VernietigingStatus.COMPLETED || vernietiging.status === VernietigingStatus.PARTIAL) {
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
    this.registreerIdempotentie(idempotentie, vernietigingId);

    // Met vertraging 0 verwerkt de stekker synchroon (bedoeld voor unittests).
    if (this.processingDelayMs <= 0) {
      return this.verwerkVernietiging(vernietigingId);
    }

    this.startAsynchroneVerwerking(vernietigingId);
    return running;
  }

  startAsynchroneVerwerking(vernietigingId) {
    const verwerking = this.verwerkVernietiging(vernietigingId)
      .catch(() => undefined)
      .finally(() => this.lopendeVerwerkingen.delete(vernietigingId));
    this.lopendeVerwerkingen.set(vernietigingId, verwerking);
    return verwerking;
  }

  // Na een herstart van de stekker: vernietigingen die RUNNING waren, gaan verder
  // met de batches die nog geen resultaat hebben.
  hervatOnderbrokenVerwerkingen() {
    const onderbroken = this.vernietigingRepository.findAll()
      .filter((vernietiging) => vernietiging.status === VernietigingStatus.RUNNING);

    for (const { vernietigingId } of onderbroken) {
      this.startAsynchroneVerwerking(vernietigingId);
    }

    return onderbroken.map(({ vernietigingId }) => vernietigingId);
  }

  // Wacht tot een lopende asynchrone verwerking klaar is (voor tests en nette afsluiting).
  async wachtOpVerwerking(vernietigingId) {
    await this.lopendeVerwerkingen.get(vernietigingId);
    return this.getVernietiging(vernietigingId);
  }

  // Verwerkt de batches één voor één, in volgorde van batchnummer. Na elke batch
  // worden resultaten en tellingen opgeslagen, zodat de voortgang zichtbaar is.
  async verwerkVernietiging(vernietigingId) {
    const huidig = this.mustGetVernietiging(vernietigingId);
    const alVerwerkt = new Set(huidig.resultaten.map((resultaat) => resultaat.batchNummer));
    const batchNummers = huidig.batches
      .map((batch) => batch.batchNummer)
      .filter((batchNummer) => !alVerwerkt.has(batchNummer))
      .sort((a, b) => a - b);

    try {
      for (const batchNummer of batchNummers) {
        if (this.processingDelayMs > 0) {
          await sleep(this.processingDelayMs);
        }

        await this.verwerkBatch(vernietigingId, batchNummer);
      }
    } catch (error) {
      const mislukt = this.mustGetVernietiging(vernietigingId);
      this.vernietigingRepository.save({
        ...mislukt,
        status: VernietigingStatus.FAILED,
        eindtijd: this.clock().toISOString(),
        aantalFouten: mislukt.aantalFouten + 1
      });
      throw error;
    }

    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const allesSucces = vernietiging.resultaten.every((resultaat) => resultaat.resultaat === Uitvoeringsresultaat.SUCCESS);

    return this.vernietigingRepository.save({
      ...vernietiging,
      // FAILED blijft gereserveerd voor een uitvoering die als geheel niet betrouwbaar kan afronden.
      status: allesSucces ? VernietigingStatus.COMPLETED : VernietigingStatus.PARTIAL,
      eindtijd: this.clock().toISOString()
    });
  }

  async verwerkBatch(vernietigingId, batchNummer) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const selectie = this.selectieService.getSelectie(vernietiging.selectieId);

    if (!selectie) {
      throw new ResourceNotFoundError('SELECTIE_NOT_FOUND', 'Selectie niet gevonden.');
    }

    const batch = vernietiging.batches.find((kandidaatBatch) => kandidaatBatch.batchNummer === batchNummer);
    const kandidaatById = new Map(selectie.kandidaten.map((kandidaat) => [kandidaat.vernietigingskandidaatId, kandidaat]));

    // Meerdere vernietigingen op dezelfde selectie delen één vernietigingslog;
    // lezen en toevoegen gebeurt daarom onder een lock per snapshot.
    const batchResultaten = await this.metSnapshotLock(selectie.snapshotBronPath, async () => {
      const recordByBronId = await this.snapshotRecords(selectie.snapshotBronPath);
      const vernietigd = await this.vernietigdeRecords(selectie.snapshotBronPath);
      const inDezeBatch = new Set();
      const nieuwVernietigd = [];
      const tijdstip = this.clock().toISOString();

      const resultaten = batch.objecten.map((object) => {
        const { resultaat, vernietigen } = executeObject({
          kandidaat: kandidaatById.get(object.vernietigingskandidaatId),
          record: recordByBronId.get(object.bronId),
          vernietigdDoor: vernietigd.get(object.bronId) ?? (inDezeBatch.has(object.bronId) ? vernietiging.vernietigingId : undefined),
          object,
          batchNummer,
          vernietigingId: vernietiging.vernietigingId,
          correlatieId: `${vernietiging.vernietigingId}-${batchNummer}-${object.vernietigingskandidaatId}`,
          scenario: this.scenario
        });

        if (vernietigen) {
          inDezeBatch.add(object.bronId);
          nieuwVernietigd.push({ bronId: object.bronId, vernietigingId: vernietiging.vernietigingId, tijdstip });
        }

        return resultaat;
      });

      // Eerst het log (duurzaam), dan pas de resultaten: na een crash daartussen ziet de
      // hervatting de records als 'door deze vernietiging vernietigd' en meldt SUCCESS.
      await this.zaakSource.registreerVernietigd(selectie.snapshotBronPath, nieuwVernietigd);
      nieuwVernietigd.forEach(({ bronId }) => vernietigd.set(bronId, vernietiging.vernietigingId));
      return resultaten;
    });

    const bijgewerkt = this.mustGetVernietiging(vernietigingId);
    const resultaten = [...bijgewerkt.resultaten, ...batchResultaten];

    return this.vernietigingRepository.save({ ...bijgewerkt, resultaten, ...telResultaten(resultaten) });
  }

  // De snapshot verandert niet meer; één keer inlezen per selectie is genoeg.
  async snapshotRecords(snapshotPath) {
    if (!this.snapshotCache.has(snapshotPath)) {
      const records = await this.zaakSource.findAllFrom(snapshotPath);
      this.snapshotCache.set(snapshotPath, new Map(records.map((record) => [record.bronId, record])));
    }

    return this.snapshotCache.get(snapshotPath);
  }

  // Alleen deze service schrijft het log, dus na één keer inlezen houdt de cache het bij.
  async vernietigdeRecords(snapshotPath) {
    if (!this.vernietigdCache.has(snapshotPath)) {
      this.vernietigdCache.set(snapshotPath, await this.zaakSource.leesVernietigd(snapshotPath));
    }

    return this.vernietigdCache.get(snapshotPath);
  }

  async metSnapshotLock(snapshotPath, werk) {
    const vorige = this.snapshotLocks.get(snapshotPath) ?? Promise.resolve();
    const huidige = vorige.catch(() => undefined).then(werk);
    const opgeruimd = huidige.catch(() => undefined).finally(() => {
      if (this.snapshotLocks.get(snapshotPath) === opgeruimd) {
        this.snapshotLocks.delete(snapshotPath);
      }
    });
    this.snapshotLocks.set(snapshotPath, opgeruimd);
    return huidige;
  }

  getBatchResultaten(vernietigingId) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);

    return vernietiging.batches
      .map((batch) => batch.batchNummer)
      .sort((a, b) => a - b)
      .map((batchNummer) => this.toBatchResultaat(vernietiging, batchNummer));
  }

  getBatchResultaat(vernietigingId, batchNummer) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);

    if (!vernietiging.batches.some((batch) => batch.batchNummer === batchNummer)) {
      throw new ResourceNotFoundError('BATCH_NOT_FOUND', `Batch ${batchNummer} niet gevonden.`);
    }

    return this.toBatchResultaat(vernietiging, batchNummer);
  }

  // Zolang een batch niet is verwerkt, is de lijst met resultaten leeg.
  toBatchResultaat(vernietiging, batchNummer) {
    return {
      batchNummer,
      resultaten: vernietiging.resultaten.filter((resultaat) => resultaat.batchNummer === batchNummer)
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

// Bepaalt het resultaat voor één aangeboden object. Muteert niets: of het record
// vernietigd moet worden, komt terug als `vernietigen` en wordt door de aanroeper vastgelegd.
function executeObject({ kandidaat, record, vernietigdDoor, object, batchNummer, vernietigingId, correlatieId, scenario }) {
  const baseResult = {
    vernietigingskandidaatId: object.vernietigingskandidaatId,
    bronId: object.bronId,
    batchNummer,
    logReference: `log-${correlatieId}`,
    correlatieId
  };
  const zonderVernietiging = (resultaat) => ({ resultaat: { ...baseResult, ...resultaat }, vernietigen: false });

  // Vangnet naast de controle bij aanlevering: vernietig nooit een bronrecord
  // dat niet bij de aangeboden kandidaat hoort.
  if (kandidaat && kandidaat.bronId !== object.bronId) {
    return zonderVernietiging({
      resultaat: Uitvoeringsresultaat.FAILED,
      foutcode: 'BRONID_MISMATCH',
      foutmelding: 'bronId hoort niet bij de vernietigingskandidaat; object is niet vernietigd.',
      bronstatus: vernietigdDoor ? 'VERNIETIGD' : record?.bronstatus ?? 'ONTBREEKT'
    });
  }

  // Hervatting na een crash tussen het vastleggen in het log en het opslaan van de
  // resultaten: dit record is al door déze vernietiging vernietigd.
  if (kandidaat && record && vernietigdDoor === vernietigingId) {
    return zonderVernietiging({ resultaat: Uitvoeringsresultaat.SUCCESS, bronstatus: 'VERNIETIGD' });
  }

  if (!kandidaat || !record || vernietigdDoor || record.bronstatus === 'VERNIETIGD') {
    return zonderVernietiging({
      resultaat: Uitvoeringsresultaat.NOT_FOUND,
      foutcode: 'NOT_FOUND',
      foutmelding: 'Kandidaat of bronrecord niet gevonden in selectie-snapshot.',
      bronstatus: vernietigdDoor ? 'VERNIETIGD' : record?.bronstatus ?? 'ONTBREEKT'
    });
  }

  if (record.bronstatus === 'GEWIJZIGD') {
    return zonderVernietiging({
      resultaat: Uitvoeringsresultaat.CHANGED,
      foutcode: 'CHANGED',
      foutmelding: 'Bronrecord is gewijzigd sinds selectie.',
      bronstatus: record.bronstatus
    });
  }

  // Testscenario: een vast deel van de kandidaten krijgt een afwijkend resultaat;
  // het bronrecord blijft dan ongewijzigd.
  const afwijkend = scenarioResultaat(scenario, object.vernietigingskandidaatId);

  if (afwijkend) {
    return zonderVernietiging({
      resultaat: afwijkend,
      foutcode: `SCENARIO_${afwijkend}`,
      foutmelding: `Resultaat ${afwijkend} gesimuleerd via scenario-configuratie.`,
      bronstatus: record.bronstatus
    });
  }

  return {
    resultaat: { ...baseResult, resultaat: Uitvoeringsresultaat.SUCCESS, bronstatus: 'VERNIETIGD' },
    vernietigen: true
  };
}

function vingerafdrukVan(waarde) {
  return crypto.createHash('sha256').update(canoniekeJson(waarde)).digest('hex');
}

// JSON met gesorteerde sleutels, zodat de volgorde van velden in het verzoek niet uitmaakt.
function canoniekeJson(waarde) {
  if (Array.isArray(waarde)) {
    return `[${waarde.map(canoniekeJson).join(',')}]`;
  }

  if (waarde && typeof waarde === 'object') {
    return `{${Object.keys(waarde)
      .filter((sleutel) => waarde[sleutel] !== undefined)
      .sort()
      .map((sleutel) => `${JSON.stringify(sleutel)}:${canoniekeJson(waarde[sleutel])}`)
      .join(',')}}`;
  }

  return JSON.stringify(waarde) ?? 'null';
}

function telResultaten(resultaten) {
  const aantal = (waarde) => resultaten.filter((resultaat) => resultaat.resultaat === waarde).length;

  return {
    succesvolVernietigd: aantal(Uitvoeringsresultaat.SUCCESS),
    mislukt: aantal(Uitvoeringsresultaat.FAILED),
    overgeslagen: aantal(Uitvoeringsresultaat.SKIPPED),
    gewijzigd: aantal(Uitvoeringsresultaat.CHANGED),
    nietGevonden: aantal(Uitvoeringsresultaat.NOT_FOUND)
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeVernietigingId() {
  return `vern-${crypto.randomBytes(6).toString('hex')}`;
}
