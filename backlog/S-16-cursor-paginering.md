# S-16 – Cursor-paginering

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-20.

## Gebouwd

- Elke kandidatenpagina met meer resultaten heeft een opake `nextCursor` (ook bij offset-paginering); `?cursor=` haalt de volgende pagina op.
- Cursor samen met `offset`, een gemanipuleerde cursor of een cursor van een andere selectie geeft `400`.
