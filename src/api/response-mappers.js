// Responses bevatten uitsluitend velden uit de Stekker-OpenAPI-spec
// (spec/stekker-openapi-spec-v1.0.0.yaml). Interne velden, zoals het pad van
// de selectie-snapshot of de waarschuwingen per bronrij, blijven zo binnen de stekker.

const SELECTIE_VELDEN = [
  'selectieId',
  'peildatum',
  'selectietijdstip',
  'status',
  'totaalKandidaten',
  'totaalObjecten',
  'totaalBetrokkenen',
  'stekkerNaam',
  'stekkerOmschrijving',
  'stekkerversie',
  'configuratieversie',
  'apiVersie',
  'aantalWaarschuwingen',
  'aantalFouten'
];

const KANDIDATEN_PAGINA_VELDEN = ['selectieId', 'offset', 'limit', 'cursor', 'nextCursor', 'totaal', 'items'];

const VERNIETIGING_VELDEN = [
  'vernietigingId',
  'selectieId',
  'cockpitTaakId',
  'vernietigingsdossierId',
  'besluitReferentie',
  'status',
  'starttijd',
  'eindtijd',
  'totaalKandidaten',
  'totaalObjecten',
  'totaalBatches',
  'ontvangenBatches',
  'succesvolVernietigd',
  'mislukt',
  'overgeslagen',
  'gewijzigd',
  'nietGevonden',
  'stekkerNaam',
  'stekkerOmschrijving',
  'stekkerversie',
  'configuratieversie',
  'aantalBatches',
  'aantalWaarschuwingen',
  'aantalFouten'
];

export function toSelectieResponse(selectie) {
  return pick(selectie, SELECTIE_VELDEN);
}

export function toKandidatenPaginaResponse(pagina) {
  return pick(pagina, KANDIDATEN_PAGINA_VELDEN);
}

export function toVernietigingResponse(vernietiging) {
  return pick(
    { ...vernietiging, aantalBatches: vernietiging.batches.length },
    VERNIETIGING_VELDEN
  );
}

function pick(source, velden) {
  return Object.fromEntries(
    velden
      .filter((veld) => source[veld] !== undefined)
      .map((veld) => [veld, source[veld]])
  );
}
