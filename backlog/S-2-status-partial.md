# S-2 – Status PARTIAL ondersteunen

## Status

Gereed. `COMPLETED` bij alleen `SUCCESS`, anders `PARTIAL`; `FAILED` alleen als de verwerking als geheel mislukt.

## Doel

Zet de vernietigingsstatus op `PARTIAL` wanneer de uitvoering is afgerond, maar minimaal een resultaat niet `SUCCESS` is.

## Context

De stekker-OpenAPI kent `PARTIAL`. De huidige service zet na verwerking altijd `COMPLETED`, ook bij `FAILED`, `SKIPPED`, `NOT_FOUND` of `CHANGED` op kandidaatniveau.

## Scope

- Breid `VernietigingStatus` uit met `PARTIAL` als dat nog ontbreekt.
- Bepaal na verwerking:
  - `COMPLETED` als alle resultaten `SUCCESS` zijn.
  - `PARTIAL` als er minstens een resultaat `FAILED`, `SKIPPED`, `NOT_FOUND` of `CHANGED` is.
  - `FAILED` blijft gereserveerd voor een uitvoering die als geheel niet betrouwbaar kan afronden.
- Houd tellingen `succesvolVernietigd`, `mislukt`, `overgeslagen`, `gewijzigd`, `nietGevonden` consistent.

## Acceptatiecriteria

- Een volledig succesvolle batch eindigt op `COMPLETED`.
- Een tweede vernietigingspoging op hetzelfde snapshotrecord levert kandidaatresultaat `NOT_FOUND` en vernietigingsstatus `PARTIAL`.
- Een `CHANGED`-scenario eindigt op `PARTIAL`.
- Sequence-test verwacht `COMPLETED` of `PARTIAL` volgens de resultaten.

## Raakt

- `src/domain/status.js`
- `src/application/vernietiging-service.js`
- `test/vernietiging-service.test.js`
- `test/cockpit-sequence.test.js`
