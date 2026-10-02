import assert from 'node:assert/strict';
import test from 'node:test';
import { SelectieNogNietGereedError, SelectieService } from '../src/application/selectie-service.js';
import { stekkerConfig } from '../src/config/stekker-config.js';
import { CsvZaakSource } from '../src/infrastructure/datasource/csv-zaak-source.js';
import { InMemorySelectieRepository } from '../src/infrastructure/repositories/in-memory-selectie-repository.js';

test('maakt een bevroren selectie uit de CSV-bron', async () => {
  const service = new SelectieService({
    zaakSource: new CsvZaakSource(stekkerConfig.dataSource.path),
    selectieRepository: new InMemorySelectieRepository(),
    clock: () => new Date('2026-09-25T10:00:00.000Z'),
    processingDelayMs: 0
  });

  const selectie = await service.startSelectie({ peildatum: '2026-09-25' });

  assert.equal(selectie.status, 'READY');
  assert.equal(selectie.bronRecords, 200);
  assert.equal(selectie.aantalWaarschuwingen, 0);
  assert.equal(selectie.totaalKandidaten > 0, true);
  assert.equal(selectie.kandidaten.every((kandidaat) => kandidaat.vernietigingsdatum <= '2026-09-25'), true);
});

test('levert kandidaten gepagineerd en zonder metadata mutatie', async () => {
  const service = new SelectieService({
    zaakSource: new CsvZaakSource(stekkerConfig.dataSource.path),
    selectieRepository: new InMemorySelectieRepository(),
    clock: () => new Date('2026-09-25T10:00:00.000Z'),
    processingDelayMs: 0
  });

  const selectie = await service.startSelectie({ peildatum: '2026-09-25' });
  const pagina = service.getKandidaten(selectie.selectieId, { offset: 10, limit: 5 });

  assert.equal(pagina.items.length, 5);
  assert.equal(pagina.offset, 10);
  assert.equal(pagina.limit, 5);
  assert.equal(pagina.totaal, selectie.totaalKandidaten);
});

test('houdt selectie tijdelijk op RUNNING en rondt daarna de snapshot af', async () => {
  const service = new SelectieService({
    zaakSource: new CsvZaakSource(stekkerConfig.dataSource.path),
    selectieRepository: new InMemorySelectieRepository(),
    clock: () => new Date('2026-09-25T10:00:00.000Z'),
    processingDelayMs: 25
  });

  const selectie = await service.startSelectie({ peildatum: '2026-09-25' });

  assert.equal(selectie.status, 'RUNNING');
  assert.match(selectie.snapshotBronPath, /bron-snapshot\.csv$/);
  assert.throws(
    () => service.getKandidaten(selectie.selectieId, { offset: 0, limit: 5 }),
    SelectieNogNietGereedError
  );

  await new Promise((resolve) => {
    setTimeout(resolve, 60);
  });

  const afgerond = service.getSelectie(selectie.selectieId);

  assert.equal(afgerond.status, 'READY');
  assert.equal(afgerond.bronRecords, 200);
  assert.equal(afgerond.totaalKandidaten, 142);
});
