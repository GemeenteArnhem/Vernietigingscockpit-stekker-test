# S-6 – Tweede configuratie of instantie

## Status

Gereed. Tweede dataset `data/wmo-zaken.csv` met eigen id-reeks (`vk-wmo-…`), zie [S-14](S-14-testdata.md).

## Doel

Maak het mogelijk om met twee stekkerconfiguraties of instanties te testen, zodat de cockpit een taak met meerdere stekkers kan doorlopen.

## Context

De cockpit moet selecties en vernietigingen over meerdere bronnen kunnen aansturen. De teststekker heeft nu een enkele default CSV-bron.

## Opties

1. Tweede CSV-bron toevoegen, bijvoorbeeld `data/wmo-zaken.csv`.
2. Een configuratieparameter `domein` of `STEKKER_PROFILE` gebruiken.
3. Dezelfde code twee keer draaien met verschillende poort, naam, configuratieversie en databron.

Voorkeur: optie 3 voor F1/F4, omdat dit het dichtst bij echte meerdere stekkers blijft en weinig code vraagt.

## Scope

- Maak stekkernaam, omschrijving, configuratieversie, poort en databron configureerbaar via env.
- Voeg README-instructies toe om twee instanties naast elkaar te starten.
- Voeg een kleine tweede CSV of filterprofiel toe als dat nodig is voor onderscheidbare data.

## Acceptatiecriteria

- Twee stekkerinstanties kunnen tegelijk draaien op verschillende poorten.
- Beide instanties rapporteren verschillende `stekkerNaam` of `configuratieversie`.
- Beide instanties kunnen selectie en vernietiging zelfstandig uitvoeren.
- Runtime-data van de twee instanties botst niet.

## Raakt

- `src/config/stekker-config.js`
- `src/index.js`
- `src/infrastructure/datasource/csv-zaak-source.js`
- `README.md`
- eventueel `data/`
