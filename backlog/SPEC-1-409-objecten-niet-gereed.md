# SPEC-1 – 409 voor kandidaten van een selectie die nog niet gereed is

Type: voorstel voor de Stekker-OpenAPI-spec (architectuurrepo `Vernietigingscockpit`, `designrules/api/stekker-openapi-spec.yaml`). Deze repo past de spec niet zelf aan; dit voorstel loopt via een issue of ADR in de architectuurrepo.

## Probleem

`GET /selecties/{selectieId}/objecten` documenteert de responses 200, 400, 401, 403 en 404. Er is geen response voor het geval dat de selectie bestaat maar nog niet `READY` is (`IDLE`, `RUNNING` of `FAILED`).

De teststekker geeft in dat geval `409 SELECTIE_NOT_READY` met een `Fout`-body. Dat valt buiten de spec.

## Waarom geen 200 of 404

- **200 met een lege pagina** is niet te onderscheiden van een selectie zonder kandidaten. De cockpit zou dan een onvolledige selectie als "0 kandidaten" kunnen importeren.
- **404** is semantisch onjuist: de selectie bestaat wel.

## Voorstel

Voeg additief (minor-versie) toe aan `GET /selecties/{selectieId}/objecten`:

```yaml
        '409':
          $ref: '#/components/responses/Conflict'
```

met in het contractdocument de afspraak: foutcode `SELECTIE_NOT_READY`, en `details` met de actuele selectiestatus.

## Gevolg voor de teststekker

Na opname in de spec: de contracttest (`npm run test:contract`) uitbreiden met dit foutpad.
