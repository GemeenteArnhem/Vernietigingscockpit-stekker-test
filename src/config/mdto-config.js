// MDTO-gegevens die niet in de CSV-bron staan, maar wel nodig zijn voor de Stekker API v2
// en de MDTO-XML-specificatie (ADR-0005). Per stekkerinstantie instelbaar via env.

export const METHODE_LABELS = [
  'Verwijderd via bronfunctie',
  'Fysiek verwijderd',
  'Overschreven',
  'Cryptografisch onleesbaar gemaakt',
  'Overig'
];

export function parseMdtoConfig(env = process.env) {
  const vernietigingsmethode = (env.STEKKER_VERNIETIGINGSMETHODE ?? '').trim() || 'Overig';

  if (!METHODE_LABELS.includes(vernietigingsmethode)) {
    throw new Error(`STEKKER_VERNIETIGINGSMETHODE moet een van ${METHODE_LABELS.join(', ')} zijn.`);
  }

  return {
    // identificatieBron van de technische sleutel (bronId) en van het zaaknummer (bronIdNaam).
    technischeBron: (env.STEKKER_IDENTIFICATIEBRON_TECHNISCH ?? '').trim() || 'CSV-bron sociaal domein (technische sleutel)',
    kenmerkBron: (env.STEKKER_IDENTIFICATIEBRON_KENMERK ?? '').trim() || 'Zaaknummering gemeente Voorbeeld',
    archiefvormer: (env.STEKKER_ARCHIEFVORMER ?? '').trim() || 'Gemeente Voorbeeld',
    vernietigingsmethode,
    vernietigingsmethodeToelichting: (env.STEKKER_VERNIETIGINGSMETHODE_TOELICHTING ?? '').trim()
      || 'Teststekker: het bronrecord wordt in een append-only vernietigingslog bij de selectie-snapshot als vernietigd gemarkeerd. Er zijn geen back-ups, replica\'s of indexen.'
  };
}

export const STANDAARD_MDTO = parseMdtoConfig({});

// Namen van de begrippenlijsten (MDTO en eigen, designrules/begrippenlijsten/).
export const Begrippenlijst = Object.freeze({
  aggregatieniveaus: 'Begrippenlijst Aggregatieniveaus MDTO',
  waarderingen: 'Begrippenlijst Waarderingen MDTO',
  eventtypen: 'Begrippenlijst Eventtypen MDTO',
  relatietypenInformatieobject: 'Begrippenlijst Relatietypen informatieobject MDTO',
  beperkingGebruik: 'Begrippenlijst BeperkingGebruik MDTO',
  termijntriggers: 'Cockpit-termijntriggers',
  dekkingInTijdtypen: 'Cockpit-dekkingInTijdtypen',
  vernietigingsmethoden: 'Cockpit-vernietigingsmethoden',
  selectielijsten: 'Cockpit-selectielijsten'
});

export function begrip(begripLabel, begrippenlijst, begripCode) {
  return {
    begripLabel,
    ...(begripCode ? { begripCode } : {}),
    begripBegrippenlijst: { verwijzingNaam: begrippenlijst }
  };
}
