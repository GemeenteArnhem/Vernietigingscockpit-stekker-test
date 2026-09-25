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

export function validateBronrecord(record, rowNumber) {
  const missing = REQUIRED_FIELDS.filter((field) => !record[field]);

  if (missing.length > 0) {
    return {
      valid: false,
      message: `Rij ${rowNumber}: verplichte velden ontbreken: ${missing.join(', ')}.`
    };
  }

  return { valid: true };
}

export function mapBronrecordToKandidaat(record) {
  return {
    vernietigingskandidaatId: record.vernietigingskandidaatId,
    omschrijving: record.omschrijving,
    classificatieschema: record.classificatieschema,
    classificatiesleutel: record.classificatiesleutel,
    classificatieomschrijving: record.classificatieomschrijving,
    selectielijst: record.selectielijst,
    grondslag: record.grondslag,
    grondslagAfwijkend: record.grondslagAfwijkend || undefined,
    resultaat: record.resultaat,
    bewaartermijn: record.bewaartermijn,
    waardering: record.waardering,
    begindatum: record.begindatum,
    einddatum: record.einddatum,
    vernietigingsdatum: record.vernietigingsdatum,
    aantalObjecten: Number.parseInt(record.aantalObjecten || '0', 10),
    aantalBetrokkenen: Number.parseInt(record.aantalBetrokkenen || '0', 10),
    bronIdNaam: record.bronIdNaam,
    bronId: record.bronId,
    relatieType: record.relatieType || undefined,
    relatieId: record.relatieId || undefined,
    statusVernietigingskandidaat: record.statusVernietigingskandidaat,
    bronstatus: record.bronstatus || undefined,
    toelichting: record.toelichting || undefined
  };
}
