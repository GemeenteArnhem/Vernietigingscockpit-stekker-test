// Genereert fictieve bronrecords voor de teststekker, deterministisch op basis van een seed.
//
//   node scripts/genereer-testdata.js --aantal 100000 --uit runtime/data/sociaal-domein-100k.csv
//   node scripts/genereer-testdata.js --domein wmo --aantal 120 --uit data/wmo-zaken.csv
//   node scripts/genereer-testdata.js --varianten --aantal 60 --uit data/sociaal-domein-varianten.csv
//
// Alle gegevens zijn fictief: geen namen, BSN's of andere persoonsgegevens.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyCsv } from '../src/infrastructure/datasource/csv-parser.js';

const KOLOMMEN = [
  'vernietigingskandidaatId', 'bronId', 'bronIdNaam', 'omschrijving', 'classificatieschema',
  'classificatiesleutel', 'classificatieomschrijving', 'domein', 'zaaktype', 'selectielijst',
  'selectielijstjaar', 'grondslag', 'resultaat', 'bewaartermijn', 'waardering', 'begindatum',
  'einddatum', 'vernietigingsdatum', 'aantalObjecten', 'aantalBetrokkenen', 'relatieType',
  'relatieId', 'statusVernietigingskandidaat', 'bronstatus', 'toelichting'
];

const ZAAKTYPEN = {
  Bestaanszekerheid: [
    ['ZTC-SD-BZ-001', 'Aanvraag bijstandsuitkering', 'Sociaal domein bestaanszekerheid - uitkering'],
    ['ZTC-SD-BZ-002', 'Bijzondere bijstand', 'Sociaal domein bestaanszekerheid - bijzondere bijstand'],
    ['ZTC-SD-BZ-003', 'Minimaregeling', 'Sociaal domein bestaanszekerheid - minimabeleid'],
    ['ZTC-SD-BZ-004', 'Schuldhulpverlening', 'Sociaal domein bestaanszekerheid - schuldhulp']
  ],
  Wmo: [
    ['ZTC-SD-WMO-001', 'Wmo maatwerkvoorziening', 'Sociaal domein Wmo - maatwerkvoorziening'],
    ['ZTC-SD-WMO-002', 'Huishoudelijke ondersteuning', 'Sociaal domein Wmo - huishoudelijke ondersteuning'],
    ['ZTC-SD-WMO-003', 'Wmo vervoersvoorziening', 'Sociaal domein Wmo - vervoer'],
    ['ZTC-SD-WMO-004', 'Beschermd wonen', 'Sociaal domein Wmo - beschermd wonen']
  ],
  Jeugd: [
    ['ZTC-SD-JGD-001', 'Jeugdhulpvoorziening', 'Sociaal domein jeugd - jeugdhulp'],
    ['ZTC-SD-JGD-002', 'Pgb jeugd', 'Sociaal domein jeugd - pgb'],
    ['ZTC-SD-JGD-003', 'Jeugdbescherming melding', 'Sociaal domein jeugd - jeugdbescherming'],
    ['ZTC-SD-JGD-004', 'Leerlingenvervoer jeugd', 'Sociaal domein jeugd - leerlingenvervoer']
  ]
};

const PROFIELEN = {
  sociaal: { prefix: 'sd', domeinen: ['Bestaanszekerheid', 'Wmo', 'Jeugd'] },
  wmo: { prefix: 'wmo', domeinen: ['Wmo'] }
};

const BEWAARTERMIJNEN = [5, 7, 7, 7, 10, 15, 20];
const RELATIETYPEN = ['ZAAK', 'DOSSIER', 'DOCUMENT'];

// Bij --varianten krijgt elk record een categorie op basis van zijn volgnummer,
// zodat de aantallen per categorie vastliggen en in tests te voorspellen zijn.
export const VARIANT_CATEGORIEEN = [
  'BEWAREN',
  'GEWIJZIGD',
  'ONGELDIG',
  'AFWIJKEND_SELECTIELIJSTJAAR',
  'NOG_NIET_VERNIETIGBAAR',
  'NORMAAL',
  'NORMAAL',
  'NORMAAL',
  'NORMAAL',
  'NORMAAL'
];

export function variantCategorie(index) {
  return VARIANT_CATEGORIEEN[index % VARIANT_CATEGORIEEN.length];
}

export function genereerRecords({ aantal, domein = 'sociaal', seed = 20260925, varianten = false, peildatum = '2026-09-25' }) {
  const profiel = PROFIELEN[domein];

  if (!profiel) {
    throw new Error(`Onbekend domein ${domein}; kies uit ${Object.keys(PROFIELEN).join(', ')}.`);
  }

  const random = mulberry32(seed);
  const kies = (lijst) => lijst[Math.floor(random() * lijst.length)];
  const cijfers = String(aantal).length;
  const peiljaar = Number.parseInt(peildatum.slice(0, 4), 10);

  return Array.from({ length: aantal }, (_, index) => {
    const nummer = String(index + 1).padStart(Math.max(4, cijfers), '0');
    const categorie = varianten ? variantCategorie(index) : 'NORMAAL';
    const domeinNaam = kies(profiel.domeinen);
    const [classificatiesleutel, zaaktype, grondslag] = kies(ZAAKTYPEN[domeinNaam]);
    const termijn = kies(BEWAARTERMIJNEN);

    // Varianten: 'normale' records zijn altijd vernietigbaar op de peildatum,
    // NOG_NIET_VERNIETIGBAAR juist nooit. Zonder varianten: willekeurig zaakjaar.
    const zaakjaar = categorie === 'NOG_NIET_VERNIETIGBAAR'
      ? peiljaar - 1
      : varianten
        ? 1996 + Math.floor(random() * Math.max(1, peiljaar - termijn - 1997))
        : 1996 + Math.floor(random() * (peiljaar - 1996));
    const begindatum = datumIn(zaakjaar, random);
    const einddatum = plusDagen(begindatum, 30 + Math.floor(random() * 300));
    const vernietigingsdatum = plusDagen(plusJaren(einddatum, termijn), 1);
    const selectielijstjaar = selectielijstjaarVoor(zaakjaar);
    const zaaknummer = `ZAAK-${zaakjaar}-${nummer}`;

    return {
      vernietigingskandidaatId: `vk-${profiel.prefix}-${nummer}`,
      bronId: `bron-${profiel.prefix}-${nummer}`,
      bronIdNaam: zaaknummer,
      omschrijving: categorie === 'ONGELDIG' ? '' : `${zaaktype} ${zaaknummer}`,
      classificatieschema: 'ZTC',
      classificatiesleutel,
      classificatieomschrijving: zaaktype,
      domein: domeinNaam,
      zaaktype,
      selectielijst: `Selectielijst gemeenten en intergemeentelijke organen ${selectielijstjaar}`,
      selectielijstjaar: String(categorie === 'AFWIJKEND_SELECTIELIJSTJAAR' ? selectielijstjaar - 5 : selectielijstjaar),
      grondslag,
      resultaat: 'Afgehandeld',
      bewaartermijn: `P${termijn}Y`,
      waardering: categorie === 'BEWAREN' ? 'BEWAREN' : 'VERNIETIGEN',
      begindatum,
      einddatum,
      vernietigingsdatum,
      aantalObjecten: String(1 + Math.floor(random() * 12)),
      aantalBetrokkenen: String(1 + Math.floor(random() * 4)),
      relatieType: RELATIETYPEN[index % RELATIETYPEN.length],
      relatieId: `REL-${profiel.prefix.toUpperCase()}-${nummer}`,
      statusVernietigingskandidaat: 'SELECTED',
      bronstatus: categorie === 'GEWIJZIGD' ? 'GEWIJZIGD' : 'ONVERANDERD',
      toelichting: `Fictieve testzaak (${domeinNaam}); categorie ${categorie}`
    };
  });
}

function selectielijstjaarVoor(zaakjaar) {
  if (zaakjaar <= 2016) {
    return 2012;
  }

  return zaakjaar <= 2019 ? 2017 : 2020;
}

function datumIn(jaar, random) {
  return plusDagen(`${jaar}-01-01`, Math.floor(random() * 365));
}

function plusDagen(datum, dagen) {
  const resultaat = new Date(`${datum}T00:00:00Z`);
  resultaat.setUTCDate(resultaat.getUTCDate() + dagen);
  return resultaat.toISOString().slice(0, 10);
}

function plusJaren(datum, jaren) {
  const resultaat = new Date(`${datum}T00:00:00Z`);
  resultaat.setUTCFullYear(resultaat.getUTCFullYear() + jaren);
  return resultaat.toISOString().slice(0, 10);
}

// Kleine, deterministische PRNG; dezelfde seed geeft altijd dezelfde dataset.
function mulberry32(seed) {
  let staat = seed >>> 0;
  return () => {
    staat = (staat + 0x6d2b79f5) >>> 0;
    let t = staat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function leesArgumenten(argv) {
  const opties = { aantal: 1000, domein: 'sociaal', seed: 20260925, varianten: false, uit: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--varianten') {
      opties.varianten = true;
    } else if (['--aantal', '--domein', '--seed', '--uit'].includes(argument)) {
      opties[argument.slice(2)] = argv[index += 1];
    } else {
      throw new Error(`Onbekend argument ${argument}.`);
    }
  }

  opties.aantal = Number.parseInt(opties.aantal, 10);
  opties.seed = Number.parseInt(opties.seed, 10);

  if (!Number.isInteger(opties.aantal) || opties.aantal < 1 || opties.aantal > 1000000) {
    throw new Error('--aantal moet tussen 1 en 1000000 liggen.');
  }

  opties.uit ??= path.join('runtime', 'data', `${opties.domein}-${opties.aantal}${opties.varianten ? '-varianten' : ''}.csv`);
  return opties;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opties = leesArgumenten(process.argv.slice(2));
  const records = genereerRecords(opties);
  fs.mkdirSync(path.dirname(path.resolve(opties.uit)), { recursive: true });
  fs.writeFileSync(opties.uit, stringifyCsv(records.map((record) => Object.fromEntries(KOLOMMEN.map((kolom) => [kolom, record[kolom]])))), 'utf8');
  console.log(`${records.length} records geschreven naar ${opties.uit}`);
}
