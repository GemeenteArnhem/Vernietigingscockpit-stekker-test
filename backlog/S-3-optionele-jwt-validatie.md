# S-3 – Optionele JWT-validatie

## Doel

Ondersteun OAuth2/JWT-validatie optioneel, zodat de teststekker met Keycloak kan worden getest zonder lokaal ontwikkelgemak te verliezen.

## Context

De stekker-specificatie gebruikt OAuth2. Voor F0/F2 moet de cockpit kunnen testen met service credentials. In lokale unit- en sequence-tests moet authenticatie uit kunnen staan.

## Configuratie

- `AUTH_ENABLED=true|false`
- `AUTH_JWKS_URL`
- `AUTH_ISSUER`
- optioneel: `AUTH_AUDIENCE`

## Scope

- Voeg middleware/helper toe in de HTTP-server.
- Valideer bij `AUTH_ENABLED=true`:
  - Bearer-token aanwezig.
  - JWT-signature via JWKS.
  - `iss` gelijk aan `AUTH_ISSUER`.
  - `aud` gelijk aan `AUTH_AUDIENCE` als gezet.
  - scopes per endpoint.
- Laat bij `AUTH_ENABLED=false` bestaand gedrag intact.

## Scopecontrole

- Selectie lezen: `selectie.read`
- Selectie starten: `selectie.write`
- Vernietiging lezen: `vernietiging.read`
- Vernietiging starten/batches/vrijgeven: `vernietiging.write`

## Acceptatiecriteria

- Zonder `AUTH_ENABLED=true` werken bestaande tests onveranderd.
- Met `AUTH_ENABLED=true` geeft ontbrekend token 401.
- Ongeldige scope geeft 403.
- Geldig token met juiste scope geeft toegang.
- README beschrijft lokale configuratie.

## Raakt

- `src/api/http-server.js`
- `src/config/stekker-config.js`
- `README.md`
- nieuwe auth-tests
