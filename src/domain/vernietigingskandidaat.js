import { Begrippenlijst, begrip, STANDAARD_MDTO } from '../config/mdto-config.js';
import { selectielijstcode } from './selectielijst.js';

const REQUIRED_FIELDS = [
  'vernietigingskandidaatId',
  'bronId',
  'bronIdNaam',
  'omschrijving',
  'classificatieschema',
  'classificatiesleutel',
  'classificatieomschrijving',
  'selectielijst',
  'selectielijstjaar',
  'grondslag',
  'resultaat',
  'bewaartermijn',
  'waardering',
  'begindatum',
  'einddatum',
  'vernietigingsdatum',
  'statusVernietigingskandidaat'
];

const AGGREGATIENIVEAUS = ['Archief', 'Serie', 'Dossier', 'Archiefstuk'];

const WAARDERINGEN = {
  BEWAREN: ['Blijvend te bewaren', 'B'],
  VERNIETIGEN: ['Tijdelijk te bewaren', 'V'],
  NADER_TE_BEPALEN: ['Nader te bepalen', 'N']
};

export function validateBronrecord(record, rowNumber) {
  const missing = REQUIRED_FIELDS.filter((field) => !record[field]);

  if (missing.length > 0) {
    return {
      valid: false,
      message: `Rij ${rowNumber}: verplichte velden ontbreken: ${missing.join(', ')}.`
    };
  }

  if (record.aggregatieniveau && !AGGREGATIENIVEAUS.includes(record.aggregatieniveau)) {
    return {
      valid: false,
      message: `Rij ${rowNumber}: aggregatieniveau ${record.aggregatieniveau} is geen MDTO-aggregatieniveau.`
    };
  }

  if (!WAARDERINGEN[record.waardering]) {
    return { valid: false, message: `Rij ${rowNumber}: onbekende waardering ${record.waardering}.` };
  }

  return { valid: true };
}

// Zet een bronrecord (CSV) om naar een vernietigingskandidaat volgens Stekker API v2 (MDTO).
// `bronId` en `bronstatus` zijn intern: de response-mapper geeft alleen spec-velden door.
export function mapBronrecordToKandidaat(record, mdto = STANDAARD_MDTO) {
  const [waarderingLabel, waarderingCode] = WAARDERINGEN[record.waardering];
  const aggregatieniveau = record.aggregatieniveau || 'Dossier';

  return {
    vernietigingskandidaatId: record.vernietigingskandidaatId,
    identificatie: [
      { identificatieKenmerk: record.bronId, identificatieBron: mdto.technischeBron },
      { identificatieKenmerk: record.bronIdNaam, identificatieBron: mdto.kenmerkBron }
    ],
    naam: record.omschrijving,
    // Elke rij is een zaak: een zaakdossier, tenzij de bron een ander niveau opgeeft.
    aggregatieniveau: begrip(aggregatieniveau, Begrippenlijst.aggregatieniveaus),
    classificatie: [
      begrip(record.classificatieomschrijving, record.classificatieschema, record.classificatiesleutel)
    ],
    dekkingInTijd: [{
      dekkingInTijdType: begrip('Looptijd', Begrippenlijst.dekkingInTijdtypen, 'looptijd'),
      dekkingInTijdBegindatum: record.begindatum,
      dekkingInTijdEinddatum: record.einddatum
    }],
    waardering: begrip(waarderingLabel, Begrippenlijst.waarderingen, waarderingCode),
    bewaartermijn: {
      termijnTriggerStartLooptijd: begrip('Afgehandeld', Begrippenlijst.termijntriggers, 'afgehandeld'),
      // De looptijd start de dag na afhandeling: einddatum + 1 dag + looptijd = vernietigingsdatum.
      termijnStartdatumLooptijd: plusEenDag(record.einddatum),
      termijnLooptijd: record.bewaartermijn,
      termijnEinddatum: record.vernietigingsdatum
    },
    informatiecategorie: {
      begripLabel: `${record.grondslag} – ${record.resultaat}`,
      begripBegrippenlijst: {
        verwijzingNaam: record.selectielijst,
        verwijzingIdentificatie: {
          identificatieKenmerk: selectielijstcode(record.selectielijstjaar),
          identificatieBron: Begrippenlijst.selectielijsten
        }
      }
    },
    ...(record.grondslagAfwijkend
      ? { informatiecategorieAfwijking: { toelichting: record.grondslagAfwijkend } }
      : {}),
    ...(record.relatieType && record.relatieId
      ? {
          gerelateerdInformatieobject: [{
            gerelateerdInformatieobjectVerwijzing: {
              verwijzingNaam: `${record.relatieType} ${record.relatieId}`,
              verwijzingIdentificatie: { identificatieKenmerk: record.relatieId, identificatieBron: mdto.kenmerkBron }
            },
            gerelateerdInformatieobjectTypeRelatie: begrip('Refereert aan', Begrippenlijst.relatietypenInformatieobject)
          }]
        }
      : {}),
    activiteit: { verwijzingNaam: record.zaaktype || record.classificatieomschrijving },
    // Alleen de direct onderliggende informatieobjecten; een archiefstuk heeft er geen (ADR-0007, DR-04).
    aantalObjecten: aggregatieniveau === 'Archiefstuk' ? 0 : Number.parseInt(record.aantalObjecten || '0', 10),
    aantalBetrokkenen: Number.parseInt(record.aantalBetrokkenen || '0', 10),
    ...(record.toelichting ? { toelichting: record.toelichting } : {}),
    // Intern
    bronId: record.bronId,
    relatieType: record.relatieType || undefined,
    statusVernietigingskandidaat: record.statusVernietigingskandidaat
  };
}

// De technische sleutel uit een identificatielijst (zoals de Cockpit die terugstuurt).
export function technischeSleutel(identificatie, mdto = STANDAARD_MDTO) {
  return Array.isArray(identificatie)
    ? identificatie.find((item) => item?.identificatieBron === mdto.technischeBron)?.identificatieKenmerk
    : undefined;
}

function plusEenDag(datum) {
  const dag = new Date(`${datum}T00:00:00Z`);
  dag.setUTCDate(dag.getUTCDate() + 1);
  return dag.toISOString().slice(0, 10);
}
