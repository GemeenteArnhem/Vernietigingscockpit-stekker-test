// De direct onderliggende informatieobjecten van een aggregatie (ADR-0007, DR-04). De CSV-bron
// kent alleen het aantal; de teststekker maakt daarvoor fictieve, herleidbare kenmerken.
// Voor een kandidaat uit een selectie is dit de momentopname: de kandidaat is afgeleid van de
// bevroren bronkopie en verandert niet meer.
export function onderdelen(kandidaat) {
  if (kandidaat.aggregatieniveau.begripLabel === 'Archiefstuk') {
    return [];
  }

  const kenmerk = kandidaat.identificatie.at(-1);

  return Array.from({ length: kandidaat.aantalObjecten ?? 0 }, (_, index) => {
    const volgnummer = String(index + 1).padStart(3, '0');

    return {
      verwijzingNaam: `${kandidaat.naam} – document ${volgnummer}`,
      verwijzingIdentificatie: {
        identificatieKenmerk: `${kenmerk.identificatieKenmerk}-D${volgnummer}`,
        identificatieBron: kenmerk.identificatieBron
      }
    };
  });
}

// Welke onderdelen sinds de momentopname zijn bijgekomen of verdwenen, op kenmerk.
export function verschilInOnderdelen(momentopname, huidig) {
  const kenmerken = (lijst) => new Set(lijst.map((item) => item.verwijzingIdentificatie.identificatieKenmerk));
  const voor = kenmerken(momentopname);
  const na = kenmerken(huidig);

  return {
    bijgekomen: [...na].filter((kenmerk) => !voor.has(kenmerk)),
    verdwenen: [...voor].filter((kenmerk) => !na.has(kenmerk))
  };
}
