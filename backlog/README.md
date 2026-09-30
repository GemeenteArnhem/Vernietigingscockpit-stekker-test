# Backlog teststekker

Deze map bevat de F1-backlog voor het spec-conform maken van de teststekker. De items komen uit het bouwplan van de Vernietigingscockpit, paragraaf 9.

De teststekker is de referentie-implementatie voor cockpit-CI. De cockpit bouwt tegen de stekker-OpenAPI-specificatie; afwijkingen in deze repo moeten dus worden opgelost in de teststekker, niet in de cockpit.

## Volgorde

1. [S-1 batchresultaten ophalen via spec-endpoints](S-1-batchresultaten-spec-endpoints.md)
2. [S-2 status PARTIAL ondersteunen](S-2-status-partial.md)
3. [S-4 Idempotency-Key bij vernietiging respecteren](S-4-idempotency-key.md)
4. [S-8 sequence-test aanpassen aan gewijzigde endpoints](S-8-sequence-test-spec-endpoints.md)
5. [S-5 scenario-configuratie voor foutpaden](S-5-scenario-configuratie.md)
6. [S-6 tweede configuratie of instantie](S-6-tweede-configuratie-of-instantie.md)
7. [S-7 Dockerfile, runtime-volume en health-info](S-7-docker-health-runtime.md)
8. [S-3 optionele JWT-validatie](S-3-optionele-jwt-validatie.md)

S-3 kan technisch eerder, maar is afhankelijk van Keycloak/F0-keuzes voor een volledige end-to-end-test.
