# Backlog teststekker

De teststekker is de referentie-implementatie voor cockpit-CI. De cockpit bouwt tegen de stekker-OpenAPI-specificatie; afwijkingen in deze repo moeten dus worden opgelost in de teststekker, niet in de cockpit.

De oorspronkelijke items S-1 t/m S-8 komen uit het bouwplan van de Vernietigingscockpit, paragraaf 9. S-9 t/m S-16 komen uit de review van 01-10-2026 (actielijst teststekker, TS-1 t/m TS-21).

## Status

| Item | Onderwerp | Status |
| --- | --- | --- |
| [S-1](S-1-batchresultaten-spec-endpoints.md) | Batchresultaten via spec-endpoints | Gereed (`/resultaten` verwijderd) |
| [S-2](S-2-status-partial.md) | Status `PARTIAL` | Gereed |
| [S-3](S-3-optionele-jwt-validatie.md) | JWT-validatie met scopes | Gereed (in compose standaard aan) |
| [S-4](S-4-idempotency-key.md) | Idempotency-Key | Gereed (ook batches en vrijgeven) |
| [S-5](S-5-scenario-configuratie.md) | Scenario's en asynchrone vernietiging | Gereed (plus transportfouten) |
| [S-6](S-6-tweede-configuratie-of-instantie.md) | Tweede instantie | Gereed (Wmo-dataset) |
| [S-7](S-7-docker-health-runtime.md) | Docker, runtime-volume, health | Gereed (non-root) |
| [S-8](S-8-sequence-test-spec-endpoints.md) | Sequence-test op de spec | Gereed (in `npm test`) |
| [S-9](S-9-contracttest.md) | Contracttest tegen vastgepinde spec | Gereed |
| [S-10](S-10-responsevorm-spec-conform.md) | Responsevorm spec-conform | Gereed |
| [S-11](S-11-batchvalidatie-en-bronid.md) | Controle kandidaat ↔ bronId, batchvalidatie | Gereed |
| [S-12](S-12-persistente-toestand.md) | Persistente toestand, hervatten, vernietigingslog | Gereed |
| [S-13](S-13-foutafhandeling-validatie-correlatie.md) | Foutafhandeling, validatie, correlatie | Gereed |
| [S-14](S-14-testdata.md) | Testdata: varianten, Wmo, generator | Gereed |
| [S-15](S-15-ids-logging-container.md) | Unieke id's, logging, container | Gereed |
| [S-16](S-16-cursor-paginering.md) | Cursor-paginering | Gereed |

## Open

- [SPEC-1](SPEC-1-409-objecten-niet-gereed.md): voorstel om `409` voor kandidaten van een nog niet gereedte selectie in de spec op te nemen. Loopt via een issue of ADR in de architectuurrepo.
- Cockpit-worker aanpassen aan de spec-conforme stekker (`items`, asynchrone vrijgave, batch-endpoints, OAuth2, Idempotency-Key). Hoort bij de cockpit-repo, niet bij deze backlog.
