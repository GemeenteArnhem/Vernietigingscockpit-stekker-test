import crypto from 'node:crypto';
import { Begrippenlijst, begrip } from '../config/mdto-config.js';
import { GEEN_SCENARIO, scenarioResultaat } from '../config/scenario-config.js';
import { stekkerConfig } from '../config/stekker-config.js';
import { maakSpecificatieXml } from '../domain/mdto-xml.js';
import { onderdelen, verschilInOnderdelen } from '../domain/onderdelen.js';
import { SelectieStatus, Uitvoeringsresultaat, VernietigingStatus } from '../domain/status.js';
import { mapBronrecordToKandidaat, technischeSleutel, validateBronrecord } from '../domain/vernietigingskandidaat.js';
import { ConflictError, ResourceNotFoundError, ValidationError } from './errors.js';
import { canoniekeJson, Idempotentie } from './idempotentie.js';
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
    scenario = stekkerConfig.scenario ?? GEEN_SCENARIO,
    mdto = stekkerConfig.mdto
  }) {
    this.zaakSource = zaakSource;
    this.selectieService = selectieService;
    this.vernietigingRepository = vernietigingRepository;
    this.clock = clock;
    this.processingDelayMs = processingDelayMs;
    this.idempotentie = new Idempotentie(idempotencyRepository);
    this.scenario = scenario;
    this.mdto = mdto;
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
    const idempotentie = this.idempotentie.controleer('POST /vernietigingen', idempotencyKey, {
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
    this.idempotentie.registreer(idempotentie, { vernietigingId: vernietiging.vernietigingId });
    return vernietiging;
  }

  getVernietiging(vernietigingId) {
    return this.vernietigingRepository.findById(vernietigingId);
  }

  voegBatchToe(vernietigingId, { batchNummer, vernietigingskandidaten }, { idempotencyKey } = {}) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const idempotentie = this.idempotentie.controleer(`POST /vernietigingen/${vernietigingId}/batches`, idempotencyKey, {
      batchNummer,
      vernietigingskandidaten: Array.isArray(vernietigingskandidaten)
        ? vernietigingskandidaten.map((kandidaat) => ({
            vernietigingskandidaatId: kandidaat?.vernietigingskandidaatId,
            identificatie: kandidaat?.identificatie
          }))
        : vernietigingskandidaten
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

    if (!Array.isArray(vernietigingskandidaten) || vernietigingskandidaten.length === 0) {
      throw new ValidationError('vernietigingskandidaten moet minimaal een kandidaat bevatten.');
    }

    // Intern blijft per object de technische sleutel (bronId) bewaard, afgeleid uit de identificatie.
    const normalizedBatch = {
      batchNummer,
      ontvangenTijdstip: this.clock().toISOString(),
      objecten: vernietigingskandidaten.map((kandidaat) => ({
        vernietigingskandidaatId: kandidaat?.vernietigingskandidaatId,
        identificatie: kandidaat?.identificatie,
        bronId: technischeSleutel(kandidaat?.identificatie, this.mdto)
      }))
    };

    const existingBatch = vernietiging.batches.find((batch) => batch.batchNummer === batchNummer);

    if (existingBatch) {
      if (canoniekeJson(existingBatch.objecten) !== canoniekeJson(normalizedBatch.objecten)) {
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
    this.idempotentie.registreer(idempotentie, { vernietigingId, batchNummer });
    return this.toBatchResultaat(vernietiging, batchNummer);
  }

  // Een batch wordt alleen geaccepteerd als elke kandidaat uit de selectie komt, met
  // precies de identificatie die de stekker voor die kandidaat heeft geleverd.
  valideerObjecten(vernietiging, objecten) {
    const selectie = this.selectieService.getSelectie(vernietiging.selectieId);
    const kandidaatById = new Map(
      (selectie?.kandidaten ?? []).map((kandidaat) => [kandidaat.vernietigingskandidaatId, kandidaat])
    );
    const inDezeBatch = new Set();
    const alAangeleverd = new Map(
      vernietiging.batches.flatMap((batch) => batch.objecten.map((object) => [object.vernietigingskandidaatId, batch.batchNummer]))
    );

    for (const { vernietigingskandidaatId, identificatie } of objecten) {
      if (typeof vernietigingskandidaatId !== 'string' || !vernietigingskandidaatId
        || !Array.isArray(identificatie) || identificatie.length === 0) {
        throw new ValidationError('Elke kandidaat moet een vernietigingskandidaatId en een identificatie bevatten.');
      }

      if (inDezeBatch.has(vernietigingskandidaatId)) {
        throw new ValidationError(`Kandidaat ${vernietigingskandidaatId} komt meer dan eens voor in deze batch.`);
      }

      inDezeBatch.add(vernietigingskandidaatId);
      const kandidaat = kandidaatById.get(vernietigingskandidaatId);

      if (!kandidaat) {
        throw new ValidationError(`Kandidaat ${vernietigingskandidaatId} komt niet voor in selectie ${vernietiging.selectieId}.`);
      }

      if (canoniekeJson(kandidaat.identificatie) !== canoniekeJson(identificatie)) {
        throw new ValidationError(`identificatie hoort niet bij kandidaat ${vernietigingskandidaatId}.`);
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
    const idempotentie = this.idempotentie.controleer(`POST /vernietigingen/${vernietigingId}/vrijgeven`, idempotencyKey, {
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

    // De wijze van vernietiging is verplicht vanaf RUNNING (ADR-0005, B-M4).
    const running = this.vernietigingRepository.save({
      ...vernietiging,
      status: VernietigingStatus.RUNNING,
      totaalBatches: aantalBatches,
      vernietigingsmethode: begrip(this.mdto.vernietigingsmethode, Begrippenlijst.vernietigingsmethoden),
      vernietigingsmethodeToelichting: this.mdto.vernietigingsmethodeToelichting
    });
    this.idempotentie.registreer(idempotentie, { vernietigingId });

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
      const huidigByBronId = await this.huidigeBronRecords();
      const vernietigd = await this.vernietigdeRecords(selectie.snapshotBronPath);
      const inDezeBatch = new Set();
      const nieuwVernietigd = [];
      const tijdstip = this.clock().toISOString();
      // Bij hervatting na een crash: het oorspronkelijke tijdstip van vernietiging uit het log.
      const hervat = batch.objecten.some((object) => vernietigd.get(object.bronId) === vernietiging.vernietigingId);
      const eerdereTijdstippen = hervat ? await this.zaakSource.leesVernietigdTijdstippen(selectie.snapshotBronPath) : new Map();

      const resultaten = batch.objecten.map((object) => {
        const { resultaat, vernietigen } = executeObject({
          kandidaat: kandidaatById.get(object.vernietigingskandidaatId),
          record: recordByBronId.get(object.bronId),
          huidigRecord: huidigByBronId.get(object.bronId),
          mdto: this.mdto,
          vernietigdDoor: vernietigd.get(object.bronId) ?? (inDezeBatch.has(object.bronId) ? vernietiging.vernietigingId : undefined),
          object,
          batchNummer,
          vernietigingId: vernietiging.vernietigingId,
          correlatieId: `${vernietiging.vernietigingId}-${batchNummer}-${object.vernietigingskandidaatId}`,
          scenario: this.scenario,
          tijdstip: eerdereTijdstippen.get(object.bronId) ?? tijdstip,
          methode: this.mdto.vernietigingsmethode
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

  // De bron zoals die nú is (niet de snapshot), om te zien of een kandidaat sinds de
  // selectie is veranderd (ADR-0007, DR-04). Per batch opnieuw ingelezen: de bron kan wijzigen.
  async huidigeBronRecords() {
    const records = await this.zaakSource.findAll();
    return new Map(records.map((record) => [record.bronId, record]));
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

  // MDTO-XML-specificatie van een vernietigde kandidaat (ADR-0005, B-M2). Alleen bij SUCCESS.
  getSpecificatie(vernietigingId, vernietigingskandidaatId) {
    const vernietiging = this.mustGetVernietiging(vernietigingId);
    const aangeboden = vernietiging.batches
      .flatMap((batch) => batch.objecten)
      .some((object) => object.vernietigingskandidaatId === vernietigingskandidaatId);

    if (!aangeboden) {
      throw new ResourceNotFoundError(
        'KANDIDAAT_NOT_FOUND',
        `Kandidaat ${vernietigingskandidaatId} is niet aangeboden in vernietiging ${vernietigingId}.`
      );
    }

    const resultaat = vernietiging.resultaten.find((item) => item.vernietigingskandidaatId === vernietigingskandidaatId);

    if (resultaat?.resultaat !== Uitvoeringsresultaat.SUCCESS) {
      throw new ConflictError(
        'SPECIFICATIE_NIET_BESCHIKBAAR',
        `Er is geen specificatie: kandidaat ${vernietigingskandidaatId} heeft resultaat ${resultaat?.resultaat ?? 'nog geen'}.`
      );
    }

    const kandidaat = this.selectieService.getSelectie(vernietiging.selectieId)?.kandidaten
      .find((item) => item.vernietigingskandidaatId === vernietigingskandidaatId);

    return maakSpecificatieXml({
      kandidaat,
      event: resultaat.event,
      archiefvormer: this.mdto.archiefvormer,
      vernietigingsmethodeToelichting: vernietiging.vernietigingsmethodeToelichting
    });
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
function executeObject({ kandidaat, record, huidigRecord, mdto, vernietigdDoor, object, batchNummer, vernietigingId, correlatieId, scenario, tijdstip, methode }) {
  const baseResult = {
    vernietigingskandidaatId: object.vernietigingskandidaatId,
    identificatie: object.identificatie,
    batchNummer,
    logReference: `log-${correlatieId}`,
    correlatieId
  };
  const zonderVernietiging = (resultaat) => ({ resultaat: { ...baseResult, ...resultaat }, vernietigen: false });
  // MDTO-event Vernietigen met het tijdstip van vernietiging (Archiefbesluit art. 8).
  const vernietigd = () => ({
    ...baseResult,
    resultaat: Uitvoeringsresultaat.SUCCESS,
    event: {
      eventType: begrip('Vernietigen', Begrippenlijst.eventtypen),
      eventTijd: tijdstip,
      eventResultaat: `Vernietigd; methode: ${methode}.`
    },
    bronstatus: 'VERNIETIGD'
  });

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
    return { resultaat: vernietigd(), vernietigen: false };
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

  if (!huidigRecord) {
    return zonderVernietiging({
      resultaat: Uitvoeringsresultaat.NOT_FOUND,
      foutcode: 'NOT_FOUND',
      foutmelding: 'Bronrecord bestaat niet meer in de bron.',
      bronstatus: 'ONTBREEKT'
    });
  }

  // De kandidaat wordt alleen als geheel vernietigd, en alleen met de onderdelen uit de
  // momentopname. Zijn er onderdelen bijgekomen of verdwenen, dan niets (ADR-0007, DR-04).
  const wijziging = wijzigingInOnderdelen(kandidaat, huidigRecord, mdto);

  if (wijziging) {
    return zonderVernietiging({
      resultaat: Uitvoeringsresultaat.CHANGED,
      foutcode: 'ONDERDELEN_GEWIJZIGD',
      foutmelding: `${wijziging} Niets van deze kandidaat is vernietigd.`,
      bronstatus: 'GEWIJZIGD'
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

  return { resultaat: vernietigd(), vernietigen: true };
}

// Beschrijft hoe de onderdelen in de bron afwijken van de momentopname, of undefined als
// ze gelijk zijn. Een bronrecord dat geen geldige kandidaat meer oplevert, telt als gewijzigd.
function wijzigingInOnderdelen(kandidaat, huidigRecord, mdto) {
  if (!validateBronrecord(huidigRecord, 0).valid) {
    return 'Bronrecord is sinds selectie ongeldig geworden.';
  }

  const huidig = onderdelen(mapBronrecordToKandidaat(huidigRecord, mdto));
  const { bijgekomen, verdwenen } = verschilInOnderdelen(onderdelen(kandidaat), huidig);

  if (bijgekomen.length === 0 && verdwenen.length === 0) {
    return undefined;
  }

  return `Onderdelen gewijzigd sinds selectie: ${bijgekomen.length} bijgekomen, ${verdwenen.length} verdwenen.`;
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
