# S-11 – Controle kandidaat ↔ bronId en batchvalidatie

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-7, TS-13.

## Gebouwd

- Bij aanlevering: kandidaat moet in de selectie staan met precies dat `bronId`, niet dubbel in een batch (`400 VALIDATION_ERROR`), en niet al in een andere batch (`409 KANDIDAAT_AL_AANGELEVERD`).
- Vangnet bij uitvoering: een object waarvan het `bronId` niet bij de kandidaat hoort, wordt nooit vernietigd (`FAILED`, `BRONID_MISMATCH`). Een mutatietest bewijst dat dit vangnet nodig is.
