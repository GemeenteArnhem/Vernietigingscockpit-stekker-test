# S-5 – Scenario-configuratie voor foutpaden

## Status

Gereed en uitgebreid: naast de kandidaatresultaten (ook `SKIPPED`) en een falende selectie zijn er transportscenario's (eerste N calls per endpoint falen met 401/403/500/502/503/504, vóór of ná verwerking, met vaste vertraging). De vernietiging is nu standaard asynchroon, per batch (`VERNIETIGING_PROCESSING_DELAY_MS`, standaard 1000 ms). Scenario's staan alleen in env; ongeldige waarden laten de stekker bij opstarten falen.

## Doel

Maak foutpaden configureerbaar, zodat de cockpit betrouwbaar kan testen met `FAILED`, `CHANGED`, `NOT_FOUND`, falende selectie en trage verwerking.

## Context

De teststekker moet niet alleen de happy flow bewijzen. De cockpit heeft foutpaden nodig voor UI, workers, retries, audit en verklaring.

## Configuratievoorstel

- `SCENARIO_FAILED_PERCENTAGE`
- `SCENARIO_CHANGED_PERCENTAGE`
- `SCENARIO_NOT_FOUND_PERCENTAGE`
- `SCENARIO_SELECTIE_FAIL=true|false`
- `SELECTIE_PROCESSING_DELAY_MS`
- `VERNIETIGING_PROCESSING_DELAY_MS`

Percentages gelden deterministisch op basis van kandidaat-id, zodat tests reproduceerbaar blijven.

## Scope

- Voeg scenario-config toe in `stekker-config`.
- Pas selectie en/of vernietiging aan op basis van de scenario-config.
- Houd default gedrag gelijk aan nu: geen kunstmatige fouten.
- Documenteer scenario’s in README.

## Acceptatiecriteria

- Zonder scenario-env blijven bestaande tests groen.
- Met `SCENARIO_CHANGED_PERCENTAGE=100` krijgen alle resultaten `CHANGED`.
- Met `SCENARIO_FAILED_PERCENTAGE=100` krijgen alle resultaten `FAILED`.
- Met `SCENARIO_NOT_FOUND_PERCENTAGE=100` krijgen alle resultaten `NOT_FOUND`.
- Met selectie-faalconfiguratie eindigt selectie op `FAILED` met foutmelding.
- Scenario’s zijn deterministisch en geschikt voor CI.

## Raakt

- `src/config/stekker-config.js`
- `src/application/selectie-service.js`
- `src/application/vernietiging-service.js`
- `test/selectie-service.test.js`
- `test/vernietiging-service.test.js`
