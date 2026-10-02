# S-4 – Idempotency-Key bij vernietiging respecteren

## Status

Gereed en uitgebreid: de key werkt op `POST /vernietigingen`, `…/batches` en `…/vrijgeven`. Een herhaling geeft dezelfde resource in de actuele stand; de key geldt per endpoint en vernietiging; dezelfde key met andere inhoud geeft `409 IDEMPOTENCY_KEY_CONFLICT`. Met `IDEMPOTENCY_KEY_REQUIRED=true` is de key verplicht. Keys staan op het runtime-volume (zie [S-12](S-12-persistente-toestand.md)).

## Doel

Maak `POST /vernietigingen` idempotent op basis van de `Idempotency-Key`-header.

## Context

De cockpit-worker moet veilig kunnen herstarten. Bij retry met dezelfde idempotency key moet de stekker dezelfde `vernietigingId` teruggeven in plaats van een nieuwe vernietiging te starten.

## Scope

- Lees `Idempotency-Key` in `POST /vernietigingen`.
- Sla de key op bij de aangemaakte vernietiging.
- Als dezelfde key opnieuw wordt gebruikt met dezelfde requestinhoud, retourneer dezelfde vernietiging.
- Als dezelfde key opnieuw wordt gebruikt met andere inhoud, geef 409.
- Als geen key is meegegeven, blijft huidig gedrag toegestaan voor lokale tests.

## Acceptatiecriteria

- Twee gelijke requests met dezelfde key leveren dezelfde `vernietigingId`.
- Tweede request met dezelfde key en andere `selectieId` of `besluitReferentie` geeft 409.
- Idempotency werkt ook als de eerste vernietiging al `IDLE`, `RUNNING`, `COMPLETED` of `PARTIAL` is.
- Unit-tests dekken happy path en conflict path.

## Raakt

- `src/api/http-server.js`
- `src/application/vernietiging-service.js`
- `src/infrastructure/repositories/in-memory-vernietiging-repository.js`
- `test/vernietiging-service.test.js`
