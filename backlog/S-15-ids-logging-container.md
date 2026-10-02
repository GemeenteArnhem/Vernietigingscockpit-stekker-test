# S-15 – Unieke id's, request-logging en container

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-17, TS-18.

## Gebouwd

- Id's `sel-<peildatum>-<12 hex>` en `vern-<12 hex>` uit willekeurige bytes; geen botsingen meer bij gelijke tijdstempel.
- Request-logging (JSON, zonder bodies), standaard aan, uit met `LOG_REQUESTS=false`.
- Container als gebruiker `node`, nette afsluiting op `SIGTERM`. `.env` wordt alleen door `src/index.js` ingelezen, niet door tests.
- Lock per snapshot voorkomt verloren updates bij gelijktijdige vernietigingen op dezelfde selectie.
