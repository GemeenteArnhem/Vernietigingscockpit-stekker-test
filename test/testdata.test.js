import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { genereerRecords, variantCategorie } from '../scripts/genereer-testdata.js';
import { SelectieService } from '../src/application/selectie-service.js';
import { VernietigingService } from '../src/application/vernietiging-service.js';
import { CsvZaakSource } from '../src/infrastructure/datasource/csv-zaak-source.js';
import { parseCsv } from '../src/infrastructure/datasource/csv-parser.js';
import { InMemorySelectieRepository } from '../src/infrastructure/repositories/in-memory-selectie-repository.js';
import { InMemoryVernietigingRepository } from '../src/infrastructure/repositories/in-memory-vernietiging-repository.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const VARIANTEN = { bestand: path.join(dataDir, 'sociaal-domein-varianten.csv'), opties: { aantal: 60, varianten: true } };
const WMO = { bestand: path.join(dataDir, 'wmo-zaken.csv'), opties: { aantal: 120, domein: 'wmo', seed: 20261001 } };

async function selecteer(csvPad) {
  const zaakSource = new CsvZaakSource(csvPad);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new InMemorySelectieRepository(),
    processingDelayMs: 0
  });
  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  return { zaakSource, selectieService, selectie };
}

test('de generator is deterministisch per seed', () => {
  const eerste = genereerRecords({ aantal: 50, seed: 1 });
  assert.deepEqual(genereerRecords({ aantal: 50, seed: 1 }), eerste);
  assert.notDeepEqual(genereerRecords({ aantal: 50, seed: 2 }), eerste);
  assert.equal(new Set(eerste.map((record) => record.vernietigingskandidaatId)).size, 50);
});

test('de datasets in data/ zijn precies wat de generator met de gedocumenteerde opties maakt', () => {
  for (const { bestand, opties } of [VARIANTEN, WMO]) {
    const opgeslagen = parseCsv(fs.readFileSync(bestand, 'utf8'));
    assert.deepEqual(opgeslagen, genereerRecords(opties), path.basename(bestand));
  }
});

test('de variantendataset dekt alle randgevallen van de selectie', async () => {
  const { selectie } = await selecteer(VARIANTEN.bestand);
  const records = genereerRecords(VARIANTEN.opties);
  const perCategorie = (categorie) => records.filter((_, index) => variantCategorie(index) === categorie).length;
  const kandidaatIds = new Set(selectie.kandidaten.map((kandidaat) => kandidaat.vernietigingskandidaatId));
  const categorieVan = (id) => variantCategorie(records.findIndex((record) => record.vernietigingskandidaatId === id));

  assert.equal(selectie.status, 'READY');
  assert.equal(selectie.totaalKandidaten, perCategorie('NORMAAL') + perCategorie('GEWIJZIGD'));
  assert.equal(selectie.aantalWaarschuwingen, perCategorie('ONGELDIG') + perCategorie('AFWIJKEND_SELECTIELIJSTJAAR'));
  assert.equal([...kandidaatIds].some((id) => ['BEWAREN', 'NOG_NIET_VERNIETIGBAAR'].includes(categorieVan(id))), false);
  assert.deepEqual(
    [...new Set(selectie.kandidaten.map((kandidaat) => kandidaat.relatieType))].sort(),
    ['DOCUMENT', 'DOSSIER', 'ZAAK']
  );
});

test('gewijzigde bronrecords uit de variantendataset leveren CHANGED op', async () => {
  const { zaakSource, selectieService, selectie } = await selecteer(VARIANTEN.bestand);
  const vernietigingService = new VernietigingService({
    zaakSource,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    processingDelayMs: 0
  });
  const objecten = selectie.kandidaten.map(({ vernietigingskandidaatId, bronId }) => ({ vernietigingskandidaatId, bronId }));
  const { vernietigingId } = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-varianten',
    besluitReferentie: 'besluit-varianten'
  });
  vernietigingService.voegBatchToe(vernietigingId, { batchNummer: 1, objecten });
  const afgerond = await vernietigingService.vrijgeven(vernietigingId, { aantalBatches: 1, aantalKandidaten: objecten.length });

  assert.equal(afgerond.status, 'PARTIAL');
  assert.equal(afgerond.gewijzigd, genereerRecords(VARIANTEN.opties).filter((_, index) => variantCategorie(index) === 'GEWIJZIGD').length);
  assert.equal(afgerond.succesvolVernietigd + afgerond.gewijzigd, objecten.length);
});

test('de Wmo-dataset heeft een eigen id-reeks naast de standaarddataset', async () => {
  const { selectie: wmo } = await selecteer(WMO.bestand);
  const { selectie: standaard } = await selecteer(path.join(dataDir, 'sociaal-domein-zaken.csv'));

  assert.ok(wmo.totaalKandidaten > 0);
  assert.equal(wmo.kandidaten.every((kandidaat) => kandidaat.vernietigingskandidaatId.startsWith('vk-wmo-')), true);
  const standaardIds = new Set(standaard.kandidaten.map((kandidaat) => kandidaat.vernietigingskandidaatId));
  assert.equal(wmo.kandidaten.some((kandidaat) => standaardIds.has(kandidaat.vernietigingskandidaatId)), false);
});
