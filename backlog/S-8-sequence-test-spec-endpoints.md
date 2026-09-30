# S-8 – Sequence-test aanpassen aan gewijzigde endpoints

## Doel

Laat `npm run test:sequence` draaien tegen de spec-conforme endpoints en statussen.

## Context

De sequence-test is de snelste regressietest voor cockpit-achtige interactie met de teststekker. Na S-1, S-2 en S-4 moet deze test de nieuwe contractkeuzes bewijzen.

## Scope

- Gebruik `Idempotency-Key` bij `POST /vernietigingen`.
- Haal resultaten op via:
  - `GET /vernietigingen/{id}/batches`
  - `GET /vernietigingen/{id}/batches/{batchNummer}`
- Verwacht `COMPLETED` bij alle `SUCCESS`.
- Verwacht `PARTIAL` bij `NOT_FOUND`, `CHANGED`, `SKIPPED` of `FAILED`.
- Laat `/resultaten` buiten de hoofdsequence.

## Acceptatiecriteria

- `npm run test:sequence` blijft zelfstandig een tijdelijke stekker starten en afsluiten.
- De test faalt als batchresultaat-endpoints ontbreken.
- De test faalt als een niet-success-resultaat toch status `COMPLETED` oplevert.
- De tweede vernietigingspoging controleert `NOT_FOUND` en `PARTIAL`.

## Raakt

- `test/cockpit-sequence.test.js`
- eventueel `test/vernietiging-service.test.js`
- README sequence-beschrijving
