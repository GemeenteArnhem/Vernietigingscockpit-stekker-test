import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SelectieService } from '../src/application/selectie-service.js';
import { VernietigingService } from '../src/application/vernietiging-service.js';
import { stekkerConfig } from '../src/config/stekker-config.js';
import { CsvZaakSource } from '../src/infrastructure/datasource/csv-zaak-source.js';
import { FileIdempotencyRepository } from '../src/infrastructure/repositories/file-idempotency-repository.js';
import { FileSelectieRepository } from '../src/infrastructure/repositories/file-selectie-repository.js';
import { FileVernietigingRepository } from '../src/infrastructure/repositories/file-vernietiging-repository.js';
import { JsonFileStore } from '../src/infrastructure/repositories/json-file-store.js';

function tijdelijkeRuntime(t) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'stekker-runtime-'));
  t.after(() => fs.rmSync(map, { recursive: true, force: true }));
  return map;
}

// Een 'stekkerproces': services met bestandsopslag op een gedeelde runtime-map.
// Een tweede aanroep op dezelfde map simuleert een herstart.
function startStekker(runtime, { vernietigingRepository, processingDelayMs = 0, selectieDelayMs = 0 } = {}) {
  const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new FileSelectieRepository(path.join(runtime, 'selecties')),
    processingDelayMs: selectieDelayMs
  });
  const vernietigingService = new VernietigingService({
    zaakSource,
    selectieService,
    vernietigingRepository: vernietigingRepository ?? new FileVernietigingRepository(path.join(runtime, 'vernietigingen')),
    idempotencyRepository: new FileIdempotencyRepository(path.join(runtime, 'idempotency')),
    processingDelayMs
  });
  return { zaakSource, selectieService, vernietigingService };
}

function objectenVan(selectie, van, tot) {
  return selectie.kandidaten.slice(van, tot).map(({ vernietigingskandidaatId, bronId }) => ({ vernietigingskandidaatId, bronId }));
}

test('JsonFileStore schrijft atomisch en weigert id\'s die buiten de map kunnen wijzen', (t) => {
  const runtime = tijdelijkeRuntime(t);
  const store = new JsonFileStore(path.join(runtime, 'store'));

  store.save('vern-abc', { vernietigingId: 'vern-abc', status: 'IDLE' });
  assert.deepEqual(store.findById('vern-abc'), { vernietigingId: 'vern-abc', status: 'IDLE' });
  assert.deepEqual(fs.readdirSync(path.join(runtime, 'store')), ['vern-abc.json']);

  for (const id of ['../geheim', '..', 'a/b', 'a\\b', '', 'x'.repeat(201)]) {
    assert.equal(store.findById(id), undefined, `id ${JSON.stringify(id)}`);
    assert.throws(() => store.save(id, {}), /Ongeldig id/);
  }
});

test('selecties, vernietigingen en idempotency-keys overleven een herstart', async (t) => {
  const runtime = tijdelijkeRuntime(t);
  const eerste = startStekker(runtime);
  const selectie = await eerste.selectieService.startSelectie({ peildatum: '2026-09-25' });
  const verzoek = { selectieId: selectie.selectieId, cockpitTaakId: 'taak-p', besluitReferentie: 'besluit-p' };
  const vernietiging = eerste.vernietigingService.startVernietiging(verzoek, { idempotencyKey: 'taak-p:vernietiging' });
  eerste.vernietigingService.voegBatchToe(vernietiging.vernietigingId, { batchNummer: 1, objecten: objectenVan(selectie, 0, 2) });

  const herstart = startStekker(runtime);

  assert.equal(herstart.selectieService.getSelectie(selectie.selectieId).status, 'READY');
  assert.equal(herstart.vernietigingService.getVernietiging(vernietiging.vernietigingId).totaalKandidaten, 2);
  assert.equal(
    herstart.vernietigingService.startVernietiging(verzoek, { idempotencyKey: 'taak-p:vernietiging' }).vernietigingId,
    vernietiging.vernietigingId
  );
});

test('een onderbroken selectie wordt na herstart afgerond', async (t) => {
  const runtime = tijdelijkeRuntime(t);
  // Lange vertraging: het eerste 'proces' rondt de selectie niet af voordat het 'stopt'.
  const eerste = startStekker(runtime, { selectieDelayMs: 60000 });
  const selectie = await eerste.selectieService.startSelectie({ peildatum: '2026-09-25' });
  assert.equal(selectie.status, 'RUNNING');

  const herstart = startStekker(runtime);
  const hervat = await herstart.selectieService.hervatOnderbrokenSelecties();

  assert.deepEqual(hervat, [selectie.selectieId]);
  assert.equal(herstart.selectieService.getSelectie(selectie.selectieId).status, 'READY');
});

test('een onderbroken vernietiging wordt hervat zonder batches dubbel te verwerken', async (t) => {
  const runtime = tijdelijkeRuntime(t);
  const eerste = startStekker(runtime);
  const selectie = await eerste.selectieService.startSelectie({ peildatum: '2026-09-25' });
  const { vernietigingId } = eerste.vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-h',
    besluitReferentie: 'besluit-h'
  });
  [objectenVan(selectie, 0, 2), objectenVan(selectie, 2, 4), objectenVan(selectie, 4, 5)].forEach((objecten, index) => {
    eerste.vernietigingService.voegBatchToe(vernietigingId, { batchNummer: index + 1, objecten });
  });

  // Situatie bij een crash: vrijgegeven (RUNNING) en alleen batch 1 verwerkt.
  const repository = new FileVernietigingRepository(path.join(runtime, 'vernietigingen'));
  repository.save({ ...repository.findById(vernietigingId), status: 'RUNNING', totaalBatches: 3 });
  await eerste.vernietigingService.verwerkBatch(vernietigingId, 1);

  const herstart = startStekker(runtime, { processingDelayMs: 5 });
  assert.deepEqual(herstart.vernietigingService.hervatOnderbrokenVerwerkingen(), [vernietigingId]);
  const afgerond = await herstart.vernietigingService.wachtOpVerwerking(vernietigingId);

  assert.equal(afgerond.status, 'COMPLETED');
  assert.equal(afgerond.resultaten.length, 5);
  assert.equal(afgerond.succesvolVernietigd, 5);
  assert.deepEqual(afgerond.resultaten.map((resultaat) => resultaat.batchNummer), [1, 1, 2, 2, 3]);
});

test('crash tussen vernietigingslog en resultaten: hervatting meldt SUCCESS, niet NOT_FOUND', async (t) => {
  const runtime = tijdelijkeRuntime(t);
  const echteRepository = new FileVernietigingRepository(path.join(runtime, 'vernietigingen'));
  let crashBijVolgendeResultaten = false;
  // Repository die 'crasht' op het moment dat de resultaten van een batch worden opgeslagen,
  // dus nádat de snapshot al is weggeschreven.
  const crashendeRepository = {
    findById: (id) => echteRepository.findById(id),
    findAll: () => echteRepository.findAll(),
    save(vernietiging) {
      if (crashBijVolgendeResultaten && vernietiging.resultaten.length > 0) {
        throw new Error('proces gestopt');
      }
      return echteRepository.save(vernietiging);
    }
  };
  const eerste = startStekker(runtime, { vernietigingRepository: crashendeRepository });
  const selectie = await eerste.selectieService.startSelectie({ peildatum: '2026-09-25' });
  const objecten = objectenVan(selectie, 0, 3);
  const { vernietigingId } = eerste.vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-c',
    besluitReferentie: 'besluit-c'
  });
  eerste.vernietigingService.voegBatchToe(vernietigingId, { batchNummer: 1, objecten });
  echteRepository.save({ ...echteRepository.findById(vernietigingId), status: 'RUNNING', totaalBatches: 1 });

  crashBijVolgendeResultaten = true;
  await assert.rejects(eerste.vernietigingService.verwerkBatch(vernietigingId, 1), /proces gestopt/);

  // De vernietiging staat al in het log, de resultaten zijn nog niet opgeslagen.
  const vernietigdNaCrash = await eerste.zaakSource.leesVernietigd(selectie.snapshotBronPath);
  assert.equal(objecten.filter((object) => vernietigdNaCrash.get(object.bronId) === vernietigingId).length, 3);
  assert.equal(echteRepository.findById(vernietigingId).resultaten.length, 0);

  const herstart = startStekker(runtime, { processingDelayMs: 5 });
  herstart.vernietigingService.hervatOnderbrokenVerwerkingen();
  const afgerond = await herstart.vernietigingService.wachtOpVerwerking(vernietigingId);

  assert.equal(afgerond.status, 'COMPLETED');
  assert.equal(afgerond.succesvolVernietigd, 3);
  assert.equal(afgerond.nietGevonden, 0);
});

test('vernietigingslog: een half geschreven laatste regel na een crash kost geen geldige regels', async (t) => {
  const runtime = tijdelijkeRuntime(t);
  const snapshotPad = path.join(runtime, 'sel-x', 'bron-snapshot.csv');
  fs.mkdirSync(path.dirname(snapshotPad), { recursive: true });
  const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);

  await zaakSource.registreerVernietigd(snapshotPad, [{ bronId: 'bron-1', vernietigingId: 'vern-a' }]);
  // Crash midden in het schrijven: regel zonder afsluitend regeleinde.
  fs.appendFileSync(path.join(runtime, 'sel-x', 'vernietigd.log'), '{"bronId":"bron-2","vernie');
  await zaakSource.registreerVernietigd(snapshotPad, [{ bronId: 'bron-3', vernietigingId: 'vern-a' }]);

  const vernietigd = await zaakSource.leesVernietigd(snapshotPad);
  assert.deepEqual([...vernietigd.entries()], [['bron-1', 'vern-a'], ['bron-3', 'vern-a']]);
});

test('na een herstart weet een nieuwe vernietiging via het log dat een record al vernietigd is', async (t) => {
  const runtime = tijdelijkeRuntime(t);
  const eerste = startStekker(runtime);
  const selectie = await eerste.selectieService.startSelectie({ peildatum: '2026-09-25' });
  const objecten = objectenVan(selectie, 0, 1);
  const verzoek = { selectieId: selectie.selectieId, cockpitTaakId: 'taak-l', besluitReferentie: 'besluit-l' };
  const eersteVernietiging = eerste.vernietigingService.startVernietiging(verzoek);
  eerste.vernietigingService.voegBatchToe(eersteVernietiging.vernietigingId, { batchNummer: 1, objecten });
  assert.equal((await eerste.vernietigingService.vrijgeven(eersteVernietiging.vernietigingId, { aantalBatches: 1, aantalKandidaten: 1 })).status, 'COMPLETED');

  const herstart = startStekker(runtime);
  const tweede = herstart.vernietigingService.startVernietiging(verzoek);
  herstart.vernietigingService.voegBatchToe(tweede.vernietigingId, { batchNummer: 1, objecten });
  const afgerond = await herstart.vernietigingService.vrijgeven(tweede.vernietigingId, { aantalBatches: 1, aantalKandidaten: 1 });

  assert.equal(afgerond.status, 'PARTIAL');
  assert.equal(afgerond.nietGevonden, 1);
});
