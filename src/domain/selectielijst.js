export function selectielijstjaarVoorZaakjaar(zaakjaar) {
  if (zaakjaar >= 1996 && zaakjaar <= 2016) {
    return 2012;
  }

  if (zaakjaar >= 2017 && zaakjaar <= 2019) {
    return 2017;
  }

  if (zaakjaar >= 2020) {
    return 2020;
  }

  throw new Error(`Geen selectielijstmapping voor zaakjaar ${zaakjaar}.`);
}

export function isVernietigbaarOpPeildatum(kandidaat, peildatum) {
  return kandidaat.waardering === 'VERNIETIGEN'
    && kandidaat.statusVernietigingskandidaat === 'SELECTED'
    && kandidaat.vernietigingsdatum <= peildatum;
}
