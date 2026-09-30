# S-7 – Dockerfile, runtime-volume en health-info

## Doel

Maak de teststekker geschikt voor docker-compose en CI.

## Context

F0 vereist lokale cockpit en lokale teststekker tegen gedeelde services. De teststekker heeft al `/health`, maar nog geen Dockerfile/runtime-afspraken.

## Scope

- Voeg `Dockerfile` toe.
- Zorg dat runtime-state buiten de image staat, bijvoorbeeld via `/app/runtime`.
- Maak runtimepad configureerbaar als dat nog niet is.
- Breid `/health` uit met versie-info.
- Documenteer docker-run en compose-gebruik.

## Health-response

Minimaal:

```json
{
  "status": "ok",
  "naam": "CSV teststekker",
  "versie": "0.1.0",
  "configuratieversie": "..."
}
```

## Acceptatiecriteria

- Image bouwt zonder extra handmatige stappen.
- Container start met alleen env-config en volume.
- `/health` geeft 200 met versie- en configuratie-info.
- Runtimebestanden worden in het volume geschreven, niet in broncode.

## Raakt

- `Dockerfile`
- `.dockerignore`
- `src/api/http-server.js`
- `src/config/stekker-config.js`
- `README.md`
