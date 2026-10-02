# S-1 – Batchresultaten ophalen via spec-endpoints

## Status

Gereed. `GET …/batches` en `GET …/batches/{batchNummer}` volgen `BatchResultaat`; ook `POST …/batches` geeft nu een `BatchResultaat`. Afwijkend van de scope: `/resultaten` is verwijderd in plaats van behouden (besluit 02-10-2026). Een ongeldig batchnummer geeft 404, omdat de spec hier geen 400 kent.

## Doel

Maak de vernietigingsresultaten beschikbaar via de endpoints uit de stekker-specificatie:

- `GET /vernietigingen/{id}/batches`
- `GET /vernietigingen/{id}/batches/{batchNummer}`

De cockpit gebruikt alleen deze spec-endpoints voor resultaatimport.

## Context

De teststekker heeft nu `GET /vernietigingen/{id}/resultaten?offset=&limit=`, maar mist de batch-resultaat-endpoints. `POST /vernietigingen/{id}/batches` bestaat al voor het aanleveren van batches.

## Scope

- Voeg een servicefunctie toe die batchresultaten uit `vernietiging.resultaten` groepeert op `batchNummer`.
- Voeg HTTP-routes toe voor de twee GET-endpoints.
- Geef 404 terug als de vernietiging of batch niet bestaat.
- Laat `/resultaten` voorlopig bestaan als extra debug-/compatibiliteitsendpoint.
- Gebruik het responsemodel `BatchResultaat` uit de stekker-OpenAPI als leidraad.

## Acceptatiecriteria

- `GET /vernietigingen/{id}/batches` retourneert alle batchnummers met aantallen en resultaten per batch.
- `GET /vernietigingen/{id}/batches/{batchNummer}` retourneert precies een batch.
- Een onbekende `vernietigingId` geeft 404.
- Een onbekend `batchNummer` geeft 404.
- Tests dekken minimaal: meerdere batches, lege/niet-verwerkte resultaten, onbekende batch.

## Raakt

- `src/api/http-server.js`
- `src/application/vernietiging-service.js`
- `test/vernietiging-service.test.js`
- `test/cockpit-sequence.test.js`
