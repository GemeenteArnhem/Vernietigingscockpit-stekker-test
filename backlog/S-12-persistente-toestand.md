# S-12 – Persistente toestand, hervatten en vernietigingslog

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-11.

## Gebouwd

- Selecties, vernietigingen en idempotency-keys als JSON-bestanden op het runtime-volume, atomisch weggeschreven; id's met onveilige tekens worden geweigerd.
- Na een herstart worden selecties en vernietigingen die `RUNNING` waren hervat; alleen batches zonder resultaat worden verwerkt.
- De snapshot-CSV blijft onveranderd; vernietigde records staan in een append-only `vernietigd.log` per selectie (met `datasync`). Eerst het log, dan de resultaten: een crash daartussen levert bij hervatten `SUCCESS` op, niet `NOT_FOUND`. Een half geschreven logregel wordt genegeerd.
- End-to-end getest met `docker kill` midden in een vernietiging. Doorlooptijd bij 67.208 kandidaten: vernietigen ~20 s (was ~190 s).
- Eén instantie per runtime-map, afgedwongen met een lease-lock (`instance.lock`): een tweede instantie stopt, `docker restart` start direct door, een nieuwe container na een kill neemt na maximaal 15 s over. Met Docker getest.
