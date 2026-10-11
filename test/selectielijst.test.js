import assert from 'node:assert/strict';
import test from 'node:test';
import { stekkerConfig } from '../src/config/stekker-config.js';
import { selectielijstcode } from '../src/domain/selectielijst.js';
import { mapBronrecordToKandidaat } from '../src/domain/vernietigingskandidaat.js';
import { CsvZaakSource } from '../src/infrastructure/datasource/csv-zaak-source.js';

// Selectielijstcode (ADR-0008, DR-SL-01 en DR-SL-05): de selectielijst wordt aangeduid met een
// code uit de begrippenlijst Cockpit-selectielijsten, met die lijst als identificatieBron.
const PATROON = /^[A-Z][A-Z0-9]{1,11}-[0-9]{4}(\.[0-9]{2})?$/;

test('selectielijstcode: gemeentelijke selectielijsten 2012, 2017 en 2020', () => {
  assert.equal(selectielijstcode(2012), 'GEM-2012');
  assert.equal(selectielijstcode('2017'), 'GEM-2017');
  assert.equal(selectielijstcode(2020), 'GEM-2020');
});

test('informatiecategorie verwijst naar de selectielijst met code en bron Cockpit-selectielijsten', async () => {
  const records = await new CsvZaakSource(stekkerConfig.dataSource.path).findAll();
  for (const record of records) {
    const { verwijzingNaam, verwijzingIdentificatie } = mapBronrecordToKandidaat(record).informatiecategorie.begripBegrippenlijst;
    assert.equal(verwijzingNaam, record.selectielijst);
    assert.match(verwijzingIdentificatie.identificatieKenmerk, PATROON);
    assert.equal(verwijzingIdentificatie.identificatieKenmerk, `GEM-${record.selectielijstjaar}`);
    assert.equal(verwijzingIdentificatie.identificatieBron, 'Cockpit-selectielijsten');
  }
});
