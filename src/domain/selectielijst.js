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

// Alleen waardering V (Tijdelijk te bewaren) met een verstreken bewaartermijn is vernietigbaar.
// Met `leverNietV` (testscenario) gaan ook B-kandidaten mee, zodat de Cockpit die kan uitsluiten.
export function isVernietigbaarOpPeildatum(kandidaat, peildatum, { leverNietV = false } = {}) {
  return (kandidaat.waardering.begripCode === 'V' || leverNietV)
    && kandidaat.statusVernietigingskandidaat === 'SELECTED'
    && kandidaat.bewaartermijn.termijnEinddatum <= peildatum;
}
