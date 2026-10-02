# S-9 – Contracttest tegen de vastgepinde spec

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-1.

## Gebouwd

- Kopie van de spec in `spec/stekker-openapi-spec-v1.0.0.yaml` (uit `Vernietigingscockpit`, branch `Review`, commit `afeaa03`).
- `test/contract/` doorloopt de volledige sequence en de foutpaden en toetst per call de HTTP-status en de body tegen het schema. Objectschema's worden gesloten, dus ook velden die niet in de spec staan zijn een fout. Elke fout moet `correlatieId` en `logReference` bevatten.
- Validatie met `ajv`, `ajv-formats` en `yaml` (alleen devDependencies; de runtime blijft dependency-vrij). Draait mee in `npm test`, los via `npm run test:contract`.
