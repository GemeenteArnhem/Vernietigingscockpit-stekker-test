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

  const snapshotRecords = await zaakSource.findAllFrom(selectie.snapshotBronPath);
  const defaultRecords = await zaakSource.findAll();
  const vernietigdeRecords = snapshotRecords.filter((record) => objecten.some((object) => object.bronId === record.bronId));
  const defaultRecordsMetZelfdeBronIds = defaultRecords.filter((record) => objecten.some((object) => object.bronId === record.bronId));

  assert.equal(vernietigdeRecords.every((record) => record.bronstatus === 'VERNIETIGD'), true);
  assert.equal(defaultRecordsMetZelfdeBronIds.every((record) => record.bronstatus === 'ONVERANDERD'), true);
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
});
