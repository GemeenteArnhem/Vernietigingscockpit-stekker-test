# S-13 – Foutafhandeling, invoervalidatie en correlatie

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-14, TS-19.

## Gebouwd

- Elke fout heeft de `Fout`-vorm met `correlatieId` (overgenomen uit `X-Correlation-ID`, anders gegenereerd) en `logReference` (verwijzing naar de logregel). Bij een 500 geen interne details naar de client.
- Invoervalidatie (400): ongeldige JSON, body geen object, body groter dan `MAX_BODY_BYTES` (`REQUEST_TOO_LARGE`; 400 omdat de spec geen 413 kent), ongeldige `peildatum`, `offset`/`limit` buiten het spec-bereik.
- Open spec-gat: 409 bij kandidaten van een selectie die nog niet `READY` is, zie [SPEC-1](SPEC-1-409-objecten-niet-gereed.md).
