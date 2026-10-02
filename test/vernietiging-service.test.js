import assert from 'node:assert/strict';
import test from 'node:test';
import { SelectieService } from '../src/application/selectie-service.js';
import { VernietigingService } from '../src/application/vernietiging-service.js';
import { stekkerConfig } from '../src/config/stekker-config.js';
import { CsvZaakSource } from '../src/infrastructure/datasource/csv-zaak-source.js';
import { InMemorySelectieRepository } from '../src/infrastructure/repositories/in-memory-selectie-repository.js';
import { InMemoryVernietigingRepository } from '../src/infrastructure/repositories/in-memory-vernietiging-repository.js';

test('vernietigt vrijgegeven kandidaten in de selectie-snapshot', async () => {
  const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new InMemorySelectieRepository(),
    clock: () => new Date('2026-09-25T11:00:00.000Z'),
    processingDelayMs: 0
  });
  const vernietigingService = new VernietigingService({
    zaakSource,
    processingDelayMs: 0,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    clock: () => new Date('2026-09-25T11:05:00.000Z')
  });

  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  const objecten = selectie.kandidaten.slice(0, 3).map((kandidaat) => ({
    vernietigingskandidaatId: kandidaat.vernietigingskandidaatId,
    bronId: kandidaat.bronId
  }));

  const vernietiging = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-test-001',
    besluitReferentie: 'besluit-test-001'
  });

  vernietigingService.voegBatchToe(vernietiging.vernietigingId, {
    batchNummer: 1,
    objecten
  });

  const afgerond = await vernietigingService.vrijgeven(vernietiging.vernietigingId, {
    aantalBatches: 1,
    aantalKandidaten: 3
  });

  assert.equal(afgerond.status, 'COMPLETED');
  assert.equal(afgerond.succesvolVernietigd, 3);
  assert.equal(afgerond.nietGevonden, 0);
  assert.equal(afgerond.totaalKandidaten, 3);
  assert.equal(
    afgerond.totaalObjecten,
    selectie.kandidaten.slice(0, 3).reduce((total, kandidaat) => total + kandidaat.aantalObjecten, 0)
  );

  // Vernietigingen staan in het log naast de snapshot; snapshot en bronset blijven ongewijzigd.
  const vernietigd = await zaakSource.leesVernietigd(selectie.snapshotBronPath);
  const snapshotRecords = await zaakSource.findAllFrom(selectie.snapshotBronPath);
  const defaultRecords = await zaakSource.findAll();
  const metZelfdeBronIds = (records) => records.filter((record) => objecten.some((object) => object.bronId === record.bronId));

  assert.equal(objecten.every((object) => vernietigd.get(object.bronId) === vernietiging.vernietigingId), true);
  assert.equal(vernietigd.size, 3);
  assert.equal(metZelfdeBronIds(snapshotRecords).every((record) => record.bronstatus === 'ONVERANDERD'), true);
  assert.equal(metZelfdeBronIds(defaultRecords).every((record) => record.bronstatus === 'ONVERANDERD'), true);
});

test('rapporteert NOT_FOUND bij vernietiging van al vernietigde snapshotrecords', async () => {
  const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new InMemorySelectieRepository(),
    clock: () => new Date('2026-09-25T12:00:00.000Z'),
    processingDelayMs: 0
  });
  const vernietigingService = new VernietigingService({
    zaakSource,
    processingDelayMs: 0,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    clock: () => new Date('2026-09-25T12:05:00.000Z')
  });

  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  const object = {
    vernietigingskandidaatId: selectie.kandidaten[0].vernietigingskandidaatId,
    bronId: selectie.kandidaten[0].bronId
  };

  const eersteVernietiging = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-test-002',
    besluitReferentie: 'besluit-test-002'
  });
  vernietigingService.voegBatchToe(eersteVernietiging.vernietigingId, { batchNummer: 1, objecten: [object] });
  await vernietigingService.vrijgeven(eersteVernietiging.vernietigingId, { aantalBatches: 1, aantalKandidaten: 1 });

  const tweedeVernietiging = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-test-003',
    besluitReferentie: 'besluit-test-003'
  });
  vernietigingService.voegBatchToe(tweedeVernietiging.vernietigingId, { batchNummer: 1, objecten: [object] });
  const afgerond = await vernietigingService.vrijgeven(tweedeVernietiging.vernietigingId, {
    aantalBatches: 1,
    aantalKandidaten: 1
  });

  assert.equal(afgerond.succesvolVernietigd, 0);
  assert.equal(afgerond.nietGevonden, 1);
  assert.equal(afgerond.resultaten[0].resultaat, 'NOT_FOUND');
  assert.equal(afgerond.status, 'PARTIAL');
});

test('levert batchresultaten per batch, ook voordat de vernietiging is verwerkt', async () => {
  const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new InMemorySelectieRepository(),
    clock: () => new Date('2026-09-25T13:00:00.000Z'),
    processingDelayMs: 0
  });
  const vernietigingService = new VernietigingService({
    zaakSource,
    processingDelayMs: 0,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    clock: () => new Date('2026-09-25T13:05:00.000Z')
  });

  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  const objecten = selectie.kandidaten.slice(0, 5).map((kandidaat) => ({
    vernietigingskandidaatId: kandidaat.vernietigingskandidaatId,
    bronId: kandidaat.bronId
  }));
  const vernietiging = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-test-004',
    besluitReferentie: 'besluit-test-004'
  });

  vernietigingService.voegBatchToe(vernietiging.vernietigingId, { batchNummer: 2, objecten: objecten.slice(3) });
  const ontvangen = vernietigingService.voegBatchToe(vernietiging.vernietigingId, { batchNummer: 1, objecten: objecten.slice(0, 3) });

  assert.deepEqual(ontvangen, { batchNummer: 1, resultaten: [] });
  assert.deepEqual(
    vernietigingService.getBatchResultaten(vernietiging.vernietigingId),
    [{ batchNummer: 1, resultaten: [] }, { batchNummer: 2, resultaten: [] }]
  );

  await vernietigingService.vrijgeven(vernietiging.vernietigingId, { aantalBatches: 2, aantalKandidaten: 5 });

  const batch1 = vernietigingService.getBatchResultaat(vernietiging.vernietigingId, 1);
  const batch2 = vernietigingService.getBatchResultaat(vernietiging.vernietigingId, 2);
  assert.equal(batch1.resultaten.length, 3);
  assert.equal(batch2.resultaten.length, 2);
  assert.equal([...batch1.resultaten, ...batch2.resultaten].every((resultaat) => resultaat.resultaat === 'SUCCESS'), true);
  assert.equal(vernietigingService.getVernietiging(vernietiging.vernietigingId).status, 'COMPLETED');

  assert.throws(
    () => vernietigingService.getBatchResultaat(vernietiging.vernietigingId, 3),
    (error) => error.code === 'BATCH_NOT_FOUND'
  );
  assert.throws(
    () => vernietigingService.getBatchResultaten('vern-bestaat-niet'),
    (error) => error.code === 'VERNIETIGING_NOT_FOUND'
  );
});

async function maakVernietigingContext(tijdstip) {
  const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new InMemorySelectieRepository(),
    clock: () => new Date(`${tijdstip}:00.000Z`),
    processingDelayMs: 0
  });
  const vernietigingRepository = new InMemoryVernietigingRepository();
  const vernietigingService = new VernietigingService({
    zaakSource,
    processingDelayMs: 0,
    selectieService,
    vernietigingRepository,
    clock: () => new Date(`${tijdstip}:30.000Z`)
  });
  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  const vernietiging = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: `taak-${tijdstip}`,
    besluitReferentie: `besluit-${tijdstip}`
  });
  const object = (index) => ({
    vernietigingskandidaatId: selectie.kandidaten[index].vernietigingskandidaatId,
    bronId: selectie.kandidaten[index].bronId
  });

  return { zaakSource, selectie, vernietiging, vernietigingService, vernietigingRepository, object };
}

test('weigert bij aanlevering objecten die niet bij de selectie horen', async () => {
  const { vernietiging, vernietigingService, object } = await maakVernietigingContext('2026-09-25T14:00');
  const id = vernietiging.vernietigingId;
  const isValidatieFout = (error) => error.code === 'VALIDATION_ERROR';

  assert.throws(
    () => vernietigingService.voegBatchToe(id, { batchNummer: 1, objecten: [{ vernietigingskandidaatId: 'vk-bestaat-niet', bronId: 'bron-x' }] }),
    isValidatieFout
  );
  assert.throws(
    () => vernietigingService.voegBatchToe(id, { batchNummer: 1, objecten: [{ ...object(0), bronId: object(1).bronId }] }),
    isValidatieFout
  );
  assert.throws(
    () => vernietigingService.voegBatchToe(id, { batchNummer: 1, objecten: [object(0), object(0)] }),
    isValidatieFout
  );
  assert.throws(
    () => vernietigingService.voegBatchToe(id, { batchNummer: 1, objecten: [{ vernietigingskandidaatId: object(0).vernietigingskandidaatId }] }),
    isValidatieFout
  );

  assert.equal(vernietigingService.getVernietiging(id).batches.length, 0);
});

test('weigert een kandidaat die al in een andere batch is aangeleverd, en accepteert dezelfde batch opnieuw', async () => {
  const { vernietiging, vernietigingService, object } = await maakVernietigingContext('2026-09-25T14:10');
  const id = vernietiging.vernietigingId;

  vernietigingService.voegBatchToe(id, { batchNummer: 1, objecten: [object(0), object(1)] });

  assert.throws(
    () => vernietigingService.voegBatchToe(id, { batchNummer: 2, objecten: [object(2), object(1)] }),
    (error) => error.code === 'KANDIDAAT_AL_AANGELEVERD'
  );
  assert.deepEqual(
    vernietigingService.voegBatchToe(id, { batchNummer: 1, objecten: [object(0), object(1)] }),
    { batchNummer: 1, resultaten: [] }
  );
  assert.equal(vernietigingService.getVernietiging(id).totaalKandidaten, 2);
});

test('vernietigt nooit een bronrecord dat niet bij de kandidaat hoort (vangnet bij uitvoering)', async () => {
  const { zaakSource, selectie, vernietiging, vernietigingService, vernietigingRepository, object } =
    await maakVernietigingContext('2026-09-25T14:20');
  const id = vernietiging.vernietigingId;
  const kandidaatA = object(0);
  const bronIdB = object(1).bronId;

  // Omzeilt de controle bij aanlevering, zoals een fout in een toekomstige codewijziging zou doen.
  const opgeslagen = vernietigingRepository.findById(id);
  opgeslagen.batches.push({ batchNummer: 1, objecten: [{ ...kandidaatA, bronId: bronIdB }] });
  opgeslagen.totaalKandidaten = 1;
  vernietigingRepository.save(opgeslagen);

  const afgerond = await vernietigingService.vrijgeven(id, { aantalBatches: 1, aantalKandidaten: 1 });
  const snapshotRecords = await zaakSource.findAllFrom(selectie.snapshotBronPath);

  assert.equal(afgerond.resultaten[0].resultaat, 'FAILED');
  assert.equal(afgerond.resultaten[0].foutcode, 'BRONID_MISMATCH');
  assert.equal(afgerond.status, 'PARTIAL');
  assert.equal(snapshotRecords.find((record) => record.bronId === bronIdB).bronstatus, 'ONVERANDERD');
  assert.equal(snapshotRecords.find((record) => record.bronId === kandidaatA.bronId).bronstatus, 'ONVERANDERD');
});

async function maakAsyncContext({ processingDelayMs = 30, zaakSourceOverride } = {}) {
  const csvSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const zaakSource = zaakSourceOverride?.(csvSource) ?? csvSource;
  let tik = 0;
  // Oplopende klok, zodat elke vernietiging een eigen id krijgt.
  const clock = () => new Date(Date.UTC(2026, 8, 25, 15, 0, 0, tik++));
  const selectieService = new SelectieService({
    zaakSource: csvSource,
    selectieRepository: new InMemorySelectieRepository(),
    clock,
    processingDelayMs: 0
  });
  const vernietigingService = new VernietigingService({
    zaakSource,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    clock,
    processingDelayMs
  });
  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  const object = (index) => ({
    vernietigingskandidaatId: selectie.kandidaten[index].vernietigingskandidaatId,
    bronId: selectie.kandidaten[index].bronId
  });
  const maakVernietiging = (batches) => {
    const vernietiging = vernietigingService.startVernietiging({
      selectieId: selectie.selectieId,
      cockpitTaakId: 'taak-async',
      besluitReferentie: 'besluit-async'
    });
    batches.forEach((objecten, index) => {
      vernietigingService.voegBatchToe(vernietiging.vernietigingId, { batchNummer: index + 1, objecten });
    });
    return vernietiging.vernietigingId;
  };

  return { csvSource, selectie, vernietigingService, object, maakVernietiging };
}

test('verwerkt een vrijgegeven vernietiging asynchroon, batch voor batch', async () => {
  const { vernietigingService, object, maakVernietiging } = await maakAsyncContext({ processingDelayMs: 200 });
  const id = maakVernietiging([[object(0), object(1)], [object(2)]]);

  const vrijgegeven = await vernietigingService.vrijgeven(id, { aantalBatches: 2, aantalKandidaten: 3 });
  assert.equal(vrijgegeven.status, 'RUNNING');
  assert.equal(vrijgegeven.succesvolVernietigd, 0);

  // Wacht tot batch 1 verwerkt is; batch 2 volgt pas 200 ms later, dus de tussenstand
  // is ruim zichtbaar zonder af te hangen van een vaste wachttijd.
  let tussenstand = vernietigingService.getVernietiging(id);
  const start = Date.now();
  while (tussenstand.succesvolVernietigd === 0 && Date.now() - start < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    tussenstand = vernietigingService.getVernietiging(id);
  }

  assert.equal(tussenstand.status, 'RUNNING');
  assert.equal(tussenstand.succesvolVernietigd, 2);
  assert.equal(vernietigingService.getBatchResultaat(id, 2).resultaten.length, 0);

  const afgerond = await vernietigingService.wachtOpVerwerking(id);
  assert.equal(afgerond.status, 'COMPLETED');
  assert.equal(afgerond.succesvolVernietigd, 3);
  assert.ok(afgerond.eindtijd);
});

test('verliest geen updates als twee vernietigingen tegelijk dezelfde snapshot bewerken', async () => {
  const { csvSource, selectie, vernietigingService, object, maakVernietiging } = await maakAsyncContext({ processingDelayMs: 5 });
  const idA = maakVernietiging([[object(0)], [object(1)], [object(2)]]);
  const idB = maakVernietiging([[object(3)], [object(4)], [object(5)]]);

  await Promise.all([
    vernietigingService.vrijgeven(idA, { aantalBatches: 3, aantalKandidaten: 3 }),
    vernietigingService.vrijgeven(idB, { aantalBatches: 3, aantalKandidaten: 3 })
  ]);
  await Promise.all([vernietigingService.wachtOpVerwerking(idA), vernietigingService.wachtOpVerwerking(idB)]);

  const vernietigd = await csvSource.leesVernietigd(selectie.snapshotBronPath);
  const bronIds = [0, 1, 2, 3, 4, 5].map((index) => object(index).bronId);
  assert.equal(bronIds.filter((bronId) => vernietigd.has(bronId)).length, 6);
  assert.deepEqual(new Set(vernietigd.values()), new Set([idA, idB]));
});

test('zet de vernietiging op FAILED als de verwerking zelf faalt', async () => {
  const { vernietigingService, object, maakVernietiging } = await maakAsyncContext({
    processingDelayMs: 5,
    zaakSourceOverride: (csvSource) => ({
      findAllFrom: () => Promise.reject(new Error('snapshot niet leesbaar')),
      leesVernietigd: csvSource.leesVernietigd.bind(csvSource),
      registreerVernietigd: csvSource.registreerVernietigd.bind(csvSource)
    })
  });
  const id = maakVernietiging([[object(0)]]);

  await vernietigingService.vrijgeven(id, { aantalBatches: 1, aantalKandidaten: 1 });
  const afgerond = await vernietigingService.wachtOpVerwerking(id);

  assert.equal(afgerond.status, 'FAILED');
  assert.equal(afgerond.aantalFouten, 1);
  assert.ok(afgerond.eindtijd);
});

test('Idempotency-Key bij POST /vernietigingen: zelfde key levert dezelfde vernietiging, andere inhoud geeft 409', async () => {
  const { selectie, vernietigingService } = await maakAsyncContext();
  const verzoek = { selectieId: selectie.selectieId, cockpitTaakId: 'taak-idem', besluitReferentie: 'besluit-idem' };

  const eerste = vernietigingService.startVernietiging(verzoek, { idempotencyKey: 'taak-idem:stekker:vernietiging' });
  const herhaling = vernietigingService.startVernietiging({ ...verzoek }, { idempotencyKey: 'taak-idem:stekker:vernietiging' });
  const andereKey = vernietigingService.startVernietiging(verzoek, { idempotencyKey: 'taak-idem:stekker:vernietiging-2' });

  assert.equal(herhaling.vernietigingId, eerste.vernietigingId);
  assert.notEqual(andereKey.vernietigingId, eerste.vernietigingId);
  assert.throws(
    () => vernietigingService.startVernietiging(
      { ...verzoek, besluitReferentie: 'ander-besluit' },
      { idempotencyKey: 'taak-idem:stekker:vernietiging' }
    ),
    (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );
});

test('Idempotency-Key bij batches en vrijgeven: herhaling na vrijgeven geeft de actuele stand, geen 409', async () => {
  const { selectie, vernietigingService, object } = await maakAsyncContext({ processingDelayMs: 20 });
  const vernietiging = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-idem-2',
    besluitReferentie: 'besluit-idem-2'
  });
  const id = vernietiging.vernietigingId;
  const batch = { batchNummer: 1, objecten: [object(0), object(1)] };
  const vrijgave = { aantalBatches: 1, aantalKandidaten: 2 };

  vernietigingService.voegBatchToe(id, batch, { idempotencyKey: 'k:batch:1' });
  const running = await vernietigingService.vrijgeven(id, vrijgave, { idempotencyKey: 'k:vrijgeven' });
  assert.equal(running.status, 'RUNNING');

  // Cockpit herstart tijdens RUNNING en herhaalt zijn calls met dezelfde keys.
  assert.equal((await vernietigingService.vrijgeven(id, vrijgave, { idempotencyKey: 'k:vrijgeven' })).status, 'RUNNING');
  assert.deepEqual(vernietigingService.voegBatchToe(id, batch, { idempotencyKey: 'k:batch:1' }).batchNummer, 1);

  // Zonder key blijft een tweede vrijgave een conflict.
  await assert.rejects(vernietigingService.vrijgeven(id, vrijgave), (error) => error.code === 'VERNIETIGING_NOT_IDLE');
  // Dezelfde key met andere inhoud is een conflict.
  await assert.rejects(
    vernietigingService.vrijgeven(id, { aantalBatches: 1, aantalKandidaten: 3 }, { idempotencyKey: 'k:vrijgeven' }),
    (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );
  assert.throws(
    () => vernietigingService.voegBatchToe(id, { batchNummer: 1, objecten: [object(0)] }, { idempotencyKey: 'k:batch:1' }),
    (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );

  await vernietigingService.wachtOpVerwerking(id);
  const naAfronding = await vernietigingService.vrijgeven(id, vrijgave, { idempotencyKey: 'k:vrijgeven' });
  assert.equal(naAfronding.status, 'COMPLETED');
  assert.equal(vernietigingService.voegBatchToe(id, batch, { idempotencyKey: 'k:batch:1' }).resultaten.length, 2);
  assert.equal(naAfronding.succesvolVernietigd, 2);
});

test('dezelfde Idempotency-Key op een ander endpoint telt als een andere key', async () => {
  const { selectie, vernietigingService, object } = await maakAsyncContext({ processingDelayMs: 0 });
  const vernietiging = vernietigingService.startVernietiging(
    { selectieId: selectie.selectieId, cockpitTaakId: 'taak-scope', besluitReferentie: 'besluit-scope' },
    { idempotencyKey: 'zelfde-key' }
  );

  vernietigingService.voegBatchToe(vernietiging.vernietigingId, { batchNummer: 1, objecten: [object(0)] }, { idempotencyKey: 'zelfde-key' });
  const afgerond = await vernietigingService.vrijgeven(
    vernietiging.vernietigingId,
    { aantalBatches: 1, aantalKandidaten: 1 },
    { idempotencyKey: 'zelfde-key' }
  );

  assert.equal(afgerond.status, 'COMPLETED');
});

test('met IDEMPOTENCY_KEY_REQUIRED geeft een muterende call zonder key een validatiefout', async () => {
  const csvSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const selectieService = new SelectieService({
    zaakSource: csvSource,
    selectieRepository: new InMemorySelectieRepository(),
    processingDelayMs: 0
  });
  const vernietigingService = new VernietigingService({
    zaakSource: csvSource,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    processingDelayMs: 0,
    idempotencyKeyRequired: true
  });
  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  const verzoek = { selectieId: selectie.selectieId, cockpitTaakId: 'taak-verplicht', besluitReferentie: 'besluit-verplicht' };

  assert.throws(() => vernietigingService.startVernietiging(verzoek), (error) => error.code === 'VALIDATION_ERROR');
  assert.ok(vernietigingService.startVernietiging(verzoek, { idempotencyKey: 'verplicht-1' }).vernietigingId);
});

test('geeft unieke selectie- en vernietigingId\'s, ook bij gelijke tijdstempel', async () => {
  const csvSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const stilstaandeKlok = () => new Date('2026-09-25T16:00:00.000Z');
  const selectieService = new SelectieService({
    zaakSource: csvSource,
    selectieRepository: new InMemorySelectieRepository(),
    clock: stilstaandeKlok,
    processingDelayMs: 0
  });
  const vernietigingService = new VernietigingService({
    zaakSource: csvSource,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    clock: stilstaandeKlok,
    processingDelayMs: 0
  });

  const [selectieA, selectieB] = await Promise.all([
    selectieService.startSelectie({ peildatum: '2026-09-25' }),
    selectieService.startSelectie({ peildatum: '2026-09-25' })
  ]);
  const verzoek = { selectieId: selectieA.selectieId, cockpitTaakId: 'taak-uniek', besluitReferentie: 'besluit-uniek' };
  const vernietigingA = vernietigingService.startVernietiging(verzoek);
  const vernietigingB = vernietigingService.startVernietiging(verzoek);

  assert.notEqual(selectieA.selectieId, selectieB.selectieId);
  assert.match(selectieA.selectieId, /^sel-20260925-[0-9a-f]{12}$/);
  assert.notEqual(vernietigingA.vernietigingId, vernietigingB.vernietigingId);
  assert.match(vernietigingA.vernietigingId, /^vern-[0-9a-f]{12}$/);
  assert.equal(vernietigingService.getVernietiging(vernietigingA.vernietigingId).cockpitTaakId, 'taak-uniek');
});
