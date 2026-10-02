# S-10 – Responsevorm spec-conform

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-2.

## Gebouwd

- `status` in plaats van `selectiestatus`, `items` in plaats van `objecten`, 202 voor `POST /selecties`, `POST /vernietigingen` en `POST …/vrijgeven`.
- Alle responses lopen via `src/api/response-mappers.js` met een vaste lijst spec-velden; interne velden (zoals het pad van de snapshot) lekken niet meer.
- `totaalObjecten` is de som van `aantalObjecten`; `aantalBatches` staat in de vernietiging-response.
- Breaking voor de Cockpit-worker (`page.objecten`, synchrone vrijgave, `/resultaten`).
