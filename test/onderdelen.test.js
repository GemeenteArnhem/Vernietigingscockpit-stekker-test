import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SelectieService } from '../src/application/selectie-service.js';
import { VernietigingService } from '../src/application/vernietiging-service.js';
import { stekkerConfig } from '../src/config/stekker-config.js';
import { onderdelen, verschilInOnderdelen } from '../src/domain/onderdelen.js';
import { mapBronrecordToKandidaat } from '../src/domain/vernietigingskandidaat.js';
import { CsvZaakSource } from '../src/infrastructure/datasource/csv-zaak-source.js';
import { InMemorySelectieRepository } from '../src/infrastructure/repositories/in-memory-selectie-repository.js';
import { InMemoryVernietigingRepository } from '../src/infrastructure/repositories/in-memory-vernietiging-repository.js';

// Uitvoeringsscope (ADR-0007, DR-04): een kandidaat wordt alleen als geheel vernietigd, met
// precies de onderdelen uit de momentopname. Wijken de onderdelen in de bron af, dan CHANGED.

test('onderdelen: archiefstuk heeft er geen, verschil telt bijgekomen en verdwenen op kenmerk', async () => {
  const [record] = await new CsvZaakSource(stekkerConfig.dataSource.path).findAll();
  const dossier = mapBronrecordToKandidaat({ ...record, aantalObjecten: '3' });
  const archiefstuk = mapBronrecordToKandidaat({ ...record, aantalObjecten: '3', aggregatieniveau: 'Archiefstuk' });

  // aantalObjecten = aantal direct onderliggende informatieobjecten = aantal bevatOnderdeel.
  assert.equal(onderdelen(dossier).length, dossier.aantalObjecten);
  assert.equal(dossier.aantalObjecten, 3);
  assert.equal(archiefstuk.aantalObjecten, 0);
  assert.deepEqual(onderdelen(archiefstuk), []);

  const meer = onderdelen(mapBronrecordToKandidaat({ ...record, aantalObjecten: '4' }));
  const minder = onderdelen(mapBronrecordToKandidaat({ ...record, aantalObjecten: '2' }));

  assert.deepEqual(verschilInOnderdelen(onderdelen(dossier), onderdelen(dossier)), { bijgekomen: [], verdwenen: [] });
  assert.equal(verschilInOnderdelen(onderdelen(dossier), meer).bijgekomen.length, 1);
  assert.equal(verschilInOnderdelen(onderdelen(dossier), minder).verdwenen.length, 1);
});

test('gewijzigde onderdelen na selectie: CHANGED voor de hele kandidaat, niets vernietigd', async (t) => {
  const map = await fs.mkdtemp(path.join(os.tmpdir(), 'stekker-onderdelen-'));
  t.after(() => fs.rm(map, { recursive: true, force: true }));
  const bronPad = path.join(map, 'bron.csv');
  await fs.copyFile(stekkerConfig.dataSource.path, bronPad);

  const zaakSource = new CsvZaakSource(bronPad);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new InMemorySelectieRepository(),
    processingDelayMs: 0
  });
  const vernietigingService = new VernietigingService({
    zaakSource,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository(),
    processingDelayMs: 0
  });

  const selectie = await selectieService.startSelectie({ peildatum: '2026-09-25' });
  const snapshot = new Map((await zaakSource.findAllFrom(selectie.snapshotBronPath)).map((record) => [record.bronId, record]));
  const [bijgekomen, verdwenen, verwijderd, ongewijzigd] = selectie.kandidaten
    .filter((kandidaat) => snapshot.get(kandidaat.bronId).bronstatus === 'ONVERANDERD' && kandidaat.aantalObjecten >= 2)
    .slice(0, 4);

  // De bron verandert ná de selectie; de snapshot niet.
  await wijzigBron(bronPad, (veld, regel) => {
    if (veld.bronId === bijgekomen.bronId) return { ...veld, aantalObjecten: String(bijgekomen.aantalObjecten + 1) };
    if (veld.bronId === verdwenen.bronId) return { ...veld, aantalObjecten: String(verdwenen.aantalObjecten - 1) };
    if (veld.bronId === verwijderd.bronId) return undefined;
    return regel;
  });

  const vernietiging = vernietigingService.startVernietiging({
    selectieId: selectie.selectieId,
    cockpitTaakId: 'taak-onderdelen',
    besluitReferentie: 'besluit-onderdelen'
  });
  const kandidaten = [bijgekomen, verdwenen, verwijderd, ongewijzigd];
  vernietigingService.voegBatchToe(vernietiging.vernietigingId, {
    batchNummer: 1,
    vernietigingskandidaten: kandidaten.map(({ vernietigingskandidaatId, identificatie }) => ({ vernietigingskandidaatId, identificatie }))
  });
  const afgerond = await vernietigingService.vrijgeven(vernietiging.vernietigingId, { aantalBatches: 1, aantalKandidaten: 4 });

  const resultaat = (kandidaat) => afgerond.resultaten.find((item) => item.vernietigingskandidaatId === kandidaat.vernietigingskandidaatId);

  assert.equal(afgerond.status, 'PARTIAL');
  assert.equal(resultaat(bijgekomen).resultaat, 'CHANGED');
  assert.equal(resultaat(bijgekomen).foutcode, 'ONDERDELEN_GEWIJZIGD');
  assert.match(resultaat(bijgekomen).foutmelding, /1 bijgekomen, 0 verdwenen/);
  assert.equal(resultaat(verdwenen).resultaat, 'CHANGED');
  assert.match(resultaat(verdwenen).foutmelding, /0 bijgekomen, 1 verdwenen/);
  assert.equal(resultaat(verwijderd).resultaat, 'NOT_FOUND');
  assert.equal(resultaat(ongewijzigd).resultaat, 'SUCCESS');
  assert.equal(afgerond.gewijzigd, 2);

  // Alleen de ongewijzigde kandidaat staat in het vernietigingslog.
  const vernietigd = await zaakSource.leesVernietigd(selectie.snapshotBronPath);
  assert.deepEqual([...vernietigd.keys()], [ongewijzigd.bronId]);

  // De specificatie bevat precies de onderdelen uit de momentopname; zonder SUCCESS is er geen.
  const xml = vernietigingService.getSpecificatie(vernietiging.vernietigingId, ongewijzigd.vernietigingskandidaatId);
  assert.equal(xml.match(/<bevatOnderdeel>/g)?.length ?? 0, ongewijzigd.aantalObjecten);
  assert.throws(
    () => vernietigingService.getSpecificatie(vernietiging.vernietigingId, bijgekomen.vernietigingskandidaatId),
    (error) => error.code === 'SPECIFICATIE_NIET_BESCHIKBAAR'
  );
});

// Herschrijft de bron-CSV regel voor regel. `wijzig` krijgt de velden van een datarij en geeft
// nieuwe velden terug, de ongewijzigde regel, of undefined om de rij te verwijderen.
async function wijzigBron(pad, wijzig) {
  const [kop, ...regels] = (await fs.readFile(pad, 'utf8')).split('\n');
  const kolommen = velden(kop);
  const nieuw = regels.flatMap((regel) => {
    if (!regel.trim()) return [regel];
    const veld = Object.fromEntries(velden(regel).map((waarde, index) => [kolommen[index], waarde]));
    const uitkomst = wijzig(veld, regel);
    if (uitkomst === undefined) return [];
    if (typeof uitkomst === 'string') return [uitkomst];
    return [kolommen.map((kolom) => `"${uitkomst[kolom]}"`).join(',')];
  });

  await fs.writeFile(pad, [kop, ...nieuw].join('\n'), 'utf8');
}

// De test-CSV's hebben alleen gequote velden zonder `","` in de waarde.
function velden(regel) {
  return regel.replace(/\r$/, '').slice(1, -1).split('","');
}
