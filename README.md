# Vernietigingscockpit stekker test

Deze repository bevat de teststekker voor de Vernietigingscockpit. De architectuur en API-afspraken worden gelezen uit de naastliggende repository `Vernietigingscockpit`; deze repository werkt die architectuur niet bij.

## Stekker API v2 (MDTO)

De teststekker implementeert **Stekker API v2.0.0** (`spec/stekker-openapi-spec-v2.0.0.yaml`, kopie van `designrules/api/stekker-openapi-spec.yaml` uit de architectuurrepo). MDTO is leidend voor benaming en structuur (ADR-0005). Belangrijkste verschillen met v1:

- alle endpoints staan onder `/v2` (behalve `GET /health`); elke response heeft de header `API-Version: 2.0.0`;
- `Idempotency-Key` is verplicht op elke `POST`, ook `POST /selecties` (ADR-0004). Zonder key volgt `400 IDEMPOTENCY_KEY_MISSING`, met dezelfde key en andere inhoud `409 IDEMPOTENCY_KEY_REUSED`;
- kandidaten volgen het MDTO-profiel: `identificatie` (technische sleutel en zaaknummer, elk met `identificatieBron`), `naam`, `aggregatieniveau`, `classificatie`, `dekkingInTijd`, `waardering` (B/V/N), `bewaartermijn` (trigger, startdatum, looptijd, einddatum), `informatiecategorie`, `gerelateerdInformatieobject`, `activiteit`;
- `GET /v2/selecties/{selectieId}/vernietigingskandidaten` vervangt `/objecten`;
- een batch bevat `vernietigingskandidaten` met `vernietigingskandidaatId` + `identificatie` (letterlijk zoals geselecteerd) in plaats van `objecten` met `bronId`;
- een resultaat `SUCCESS` draagt het MDTO-event `Vernietigen` met `eventTijd`; een uitvoering vanaf `RUNNING` de `vernietigingsmethode` en `vernietigingsmethodeToelichting`;
- nieuw: `GET /v2/vernietigingen/{vernietigingId}/specificaties/{vernietigingskandidaatId}` levert een MDTO-XML-document (MDTO-XML 1.0.1) van een vernietigde kandidaat, met een `bevatOnderdeel` per onderliggend informatieobject. De CSV-bron kent alleen het aantal onderliggende objecten; de teststekker maakt daarvoor fictieve kenmerken (`<zaaknummer>-D001` …). De tests valideren de XML tegen `spec/mdto/MDTO-XML1.0.1.xsd` (als Python met `lxml` beschikbaar is).

De CSV-bron zelf houdt zijn eigen kolommen; de stekker zet ze bij selectie om naar MDTO (`src/domain/vernietigingskandidaat.js`). Een optionele kolom `aggregatieniveau` (Archief, Serie, Dossier, Archiefstuk) is toegestaan; zonder die kolom is elke zaak een `Dossier`. De bewaartermijn start de dag na `einddatum` (trigger *Afgehandeld*).

> Runtime-gegevens van een v1-stekker (`runtime/`, of het runtime-volume in Docker) zijn niet bruikbaar met v2. Begin met een lege runtime-map of een nieuw volume.

## Testdata

De eerste testset staat in:

- `data/sociaal-domein-zaken.csv`

De CSV bevat 200 fictieve zaken uit het sociaal domein van een gemeente, verdeeld over:

- bestaanszekerheid
- Wmo
- jeugd

De zaken gebruiken `ZTC` als classificatieschema. De kolommen sluiten aan op het kandidaatmodel uit de Stekker API, met onder andere `vernietigingskandidaatId`, `bronId`, `bronIdNaam`, classificatievelden, selectielijstvelden, bewaartermijn, waardering en vernietigingsdatum.

## Selectielijstmapping

De testset gebruikt de volgende mapping van zaakjaar naar selectielijstjaar:

| Zaakjaar | Selectielijstjaar |
| --- | --- |
| 1996-2016 | 2012 |
| 2017-2019 | 2017 |
| 2020-heden | 2020 |

Alle records hebben `waardering` = `VERNIETIGEN` en `statusVernietigingskandidaat` = `SELECTED`, zodat de eerste stekkerstap zich kan richten op inlezen, valideren, selecteren en mappen.

### Extra datasets

| Bestand | Inhoud | Gebruik |
| --- | --- | --- |
| `data/sociaal-domein-zaken.csv` | 200 records, 142 kandidaten (standaard) | Ongewijzigd; bestaande tests en Cockpit-verwachtingen leunen hierop |
| `data/sociaal-domein-varianten.csv` | 60 records met alle randgevallen: `BEWAREN`, bronstatus `GEWIJZIGD` (levert `CHANGED`), ongeldige rij, afwijkend selectielijstjaar, nog niet vernietigbaar, en `relatieType` `ZAAK`/`DOSSIER`/`DOCUMENT` | Foutpaden en waarschuwingen in de Cockpit; 36 kandidaten, 12 waarschuwingen |
| `data/wmo-zaken.csv` | 120 Wmo-records met eigen id-reeks (`vk-wmo-…`) | Tweede stekkerinstantie, voor een taak met meerdere stekkers |

Een dataset kies je met `STEKKER_CSV_PATH`, bijvoorbeeld een tweede instantie:

```dotenv
STEKKER_NAAM=CSV teststekker Wmo
STEKKER_CONFIGURATIEVERSIE=csv-wmo-2026-10-01
STEKKER_DATASOURCE_NAME=wmo-zaken
STEKKER_CSV_PATH=data/wmo-zaken.csv
```

### Grote datasets genereren

`npm run data:genereer` maakt fictieve datasets voor paginering en belastingtests. De uitvoer is deterministisch (vaste seed) en komt standaard in `runtime/data/` (niet in git):

```powershell
npm run data:genereer -- --aantal 100000
npm run data:genereer -- --aantal 10000 --domein wmo --uit runtime/data/wmo-10k.csv
npm run data:genereer -- --varianten --aantal 1000 --seed 42
```

De twee extra datasets in `data/` zijn met deze generator gemaakt (`--varianten --aantal 60` en `--domein wmo --aantal 120 --seed 20261001`); een test bewaakt dat ze daarmee overeenkomen. In de container staat de generator in `/app/scripts`; genereer daar naar het runtime-volume en wijs `STEKKER_CSV_PATH` ernaar.

Indicatie van de doorlooptijd (bestandsopslag, zonder verwerkingsvertraging): 10.000 records (6.786 kandidaten) een volledige cyclus in enkele seconden; 100.000 records (67.208 kandidaten) selecteren ~1 s, alle pagina's ophalen < 1 s, 135 batches aanleveren ~6 s, vernietigen ~20 seconden.

## Architectuuropzet

De teststekker is opgezet in lagen die aansluiten op de Stekker-architectuur:

```text
src/
  api/                  HTTP API-adapter en response-mapping
  application/          use-cases en orchestratie
  config/               stekker- en bronconfiguratie
  domain/               domeinregels, statussen en kandidaatmapping
  infrastructure/
    datasource/         CSV-bronadapter
    repositories/       opslag van bevroren selecties
test/                   geautomatiseerde tests
```

De eerste werkende flow is:

1. `POST /v2/selecties` kopieert de default CSV-bron naar een selectie-snapshot onder `runtime/selecties/{selectieId}/bron-snapshot.csv`.
2. De selectie blijft tijdelijk op `RUNNING`, zodat asynchroon bron- en selectiewerk gesimuleerd wordt.
3. Na de ingestelde verwerkingstijd wordt de snapshot verwerkt en gaat de selectie naar `READY`.
4. `GET /v2/selecties/{selectieId}` geeft de selectiestatus en metadata terug.
5. `GET /v2/selecties/{selectieId}/vernietigingskandidaten?offset=0&limit=100` levert vernietigingskandidaten gepagineerd op zodra de selectie `READY` is. Elke pagina met meer resultaten bevat een opake `nextCursor`; de volgende pagina haal je op met `?cursor={nextCursor}` (niet samen met `offset`). Een ongeldige cursor of een cursor van een andere selectie geeft `400`.

De selectie gebruikt standaard peildatum `2026-09-25`. Alleen records met `waardering = VERNIETIGEN` (MDTO: `V`, Tijdelijk te bewaren), `statusVernietigingskandidaat = SELECTED` en een `vernietigingsdatum` (MDTO: `bewaartermijn.termijnEinddatum`) op of voor de peildatum worden opgenomen als vernietigingskandidaat.

De default testset in `data/sociaal-domein-zaken.csv` wordt niet aangepast. Vernietiging kan straks plaatsvinden op de selectie-snapshot, zodat dezelfde bronset opnieuw gebruikt kan worden voor nieuwe selecties.

De simulatievertraging en stekkermetadata zijn instelbaar via omgevingsvariabelen of een lokale `.env`.
Begin bijvoorbeeld met:

```powershell
Copy-Item .env.example .env
$env:SELECTIE_PROCESSING_DELAY_MS = "3000"
```

Ondersteunde configuratie:

| Variabele | Standaard |
| --- | --- |
| `PORT` | `3000` |
| `STEKKER_NAAM` | `CSV teststekker sociaal domein` |
| `STEKKER_OMSCHRIJVING` | `Teststekker voor fictieve sociaal-domein-zaken uit een CSV-bron.` |
| `STEKKER_CONFIGURATIEVERSIE` | `csv-sociaal-domein-2026-09-25` |
| `STEKKER_DATASOURCE_NAME` | `sociaal-domein-zaken` |
| `STEKKER_CSV_PATH` | `data/sociaal-domein-zaken.csv` |
| `STEKKER_RUNTIME_SELECTIES_PATH` | `runtime/selecties` |
| `STEKKER_RUNTIME_VERNIETIGINGEN_PATH` | `runtime/vernietigingen` |
| `STEKKER_RUNTIME_IDEMPOTENCY_PATH` | `runtime/idempotency` |
| `STEKKER_RUNTIME_LOCK_PATH` | `runtime/instance.lock` (op hetzelfde volume als de overige runtime-paden) |
| `SELECTIE_PROCESSING_DELAY_MS` | `3000` |
| `VERNIETIGING_PROCESSING_DELAY_MS` | `1000` (pauze vóór elke batch; `0` = synchroon, alleen voor tests) |
| `MAX_BODY_BYTES` | `1048576` (grotere requests geven `400 REQUEST_TOO_LARGE`) |
| `LOG_REQUESTS` | `true` (één JSON-logregel per request: methode, pad, status, duur, correlatieId; nooit bodies) |
| `STEKKER_ARCHIEFVORMER` | `Gemeente Voorbeeld` (MDTO `archiefvormer` in de specificatie) |
| `STEKKER_IDENTIFICATIEBRON_TECHNISCH` | `CSV-bron sociaal domein (technische sleutel)` (`identificatieBron` van `bronId`) |
| `STEKKER_IDENTIFICATIEBRON_KENMERK` | `Zaaknummering gemeente Voorbeeld` (`identificatieBron` van het zaaknummer) |
| `STEKKER_VERNIETIGINGSMETHODE` | `Overig` (label uit Cockpit-vernietigingsmethoden) |
| `STEKKER_VERNIETIGINGSMETHODE_TOELICHTING` | toelichting over het vernietigingslog, zonder back-ups |

## Vernietigingsflow

Vernietiging werkt op de selectie-snapshot, niet op de default testset.

1. `POST /v2/vernietigingen` maakt een vernietigingsuitvoering voor een `selectieId`.
2. `POST /v2/vernietigingen/{vernietigingId}/batches` levert vrijgegeven kandidaten aan (`vernietigingskandidaten`). Elke kandidaat wordt bij aanlevering gecontroleerd:
   - de kandidaat moet in de selectie voorkomen, met precies de `identificatie` die de stekker voor die kandidaat heeft geleverd (anders `400 VALIDATION_ERROR`);
   - een kandidaat mag maar één keer in een batch staan (anders `400 VALIDATION_ERROR`);
   - een kandidaat die al in een andere batch is aangeleverd, geeft `409 KANDIDAAT_AL_AANGELEVERD`;
   - dezelfde batch opnieuw aanleveren met dezelfde inhoud is toegestaan; met andere inhoud geeft `409 BATCH_CONFLICT`.

   Als vangnet controleert de stekker de technische sleutel (`bronId`, uit de `identificatie`) bij uitvoering opnieuw. Een object waarvan de sleutel niet bij de kandidaat hoort, wordt nooit vernietigd en krijgt resultaat `FAILED` met foutcode `BRONID_MISMATCH`.
3. `POST /v2/vernietigingen/{vernietigingId}/vrijgeven` controleert de aantallen en start de technische verwerking. De stekker antwoordt direct met `202` en status `RUNNING`, en verwerkt daarna de batches één voor één (in volgorde van batchnummer), met `VERNIETIGING_PROCESSING_DELAY_MS` pauze vóór elke batch. Na elke batch zijn de resultaten en tellingen bijgewerkt.
4. `GET /v2/vernietigingen/{vernietigingId}` geeft de uitvoeringstatus, tellingen (met `verwerkteBatches`) en vernietigingsmethode terug. Poll tot de status `COMPLETED`, `PARTIAL` of `FAILED` is. `FAILED` betekent dat de verwerking als geheel is mislukt (bijvoorbeeld doordat de snapshot niet leesbaar is).
5. `GET /v2/vernietigingen/{vernietigingId}/batches` levert de resultaten van alle batches; `GET /v2/vernietigingen/{vernietigingId}/batches/{batchNummer}` die van één batch. Zolang een batch niet is verwerkt, is `resultaten` leeg. Bij `SUCCESS` bevat het resultaat het `event` *Vernietigen* met het tijdstip uit het vernietigingslog (ook na een hervatting).
6. `GET /v2/vernietigingen/{vernietigingId}/specificaties/{vernietigingskandidaatId}` levert de MDTO-XML-specificatie van een vernietigde kandidaat. Zonder `SUCCESS` volgt `409 SPECIFICATIE_NIET_BESCHIKBAAR`, voor een niet-aangeboden kandidaat `404 KANDIDAAT_NOT_FOUND`.

### Idempotency-Key

Elke `POST` (`/selecties`, `/vernietigingen`, `…/batches`, `…/vrijgeven`) vereist de header `Idempotency-Key` (maximaal 200 tekens), zodat de Cockpit na een crash of time-out veilig opnieuw kan proberen:

- dezelfde key met dezelfde inhoud levert dezelfde resource op, in de actuele stand (bijvoorbeeld een vernietiging die inmiddels `RUNNING` of `COMPLETED` is). Dit werkt ook na vrijgeven, dus ook voor het herhalen van een batch;
- dezelfde key met een andere inhoud geeft `409 IDEMPOTENCY_KEY_REUSED`;
- een key geldt per endpoint (en per vernietiging): dezelfde key op een ander endpoint telt als een andere key;
- zonder key volgt `400 IDEMPOTENCY_KEY_MISSING`.

Keys worden op het runtime-volume bewaard en overleven een herstart van de stekker.

De eindstatus is `COMPLETED` als alle resultaten `SUCCESS` zijn, en `PARTIAL` zodra minstens één resultaat `FAILED`, `SKIPPED`, `NOT_FOUND` of `CHANGED` is.

De snapshot `runtime/selecties/{selectieId}/bron-snapshot.csv` blijft onveranderd (de bevroren bronset). Elk vernietigd record wordt vastgelegd in een append-only log ernaast, `runtime/selecties/{selectieId}/vernietigd.log` (één JSON-regel per record: `bronId`, `vernietigingId`, `tijdstip`). Een tweede vernietigingspoging binnen dezelfde selectie op hetzelfde record levert daardoor `NOT_FOUND` op.

**Uitvoeringsscope (ADR-0007, DR-04).** De snapshot legt per kandidaat de onderdelen vast: bij een archief, serie of dossier `aantalObjecten` onderdelen met de kenmerken `<zaaknummer>-D001` …; een archiefstuk heeft er geen. Bij uitvoering vergelijkt de stekker die met de bron-CSV zoals die op dat moment is:

- staat het record niet meer in de bron: `NOT_FOUND` (`Bronrecord bestaat niet meer in de bron.`);
- zijn er onderdelen bijgekomen of verdwenen, bijvoorbeeld doordat `aantalObjecten` in de bron is veranderd: `CHANGED` met foutcode `ONDERDELEN_GEWIJZIGD` voor de **hele kandidaat**; er wordt niets van vernietigd;
- de specificatie van een vernietigde kandidaat bevat precies de onderdelen uit de snapshot.

Om dit handmatig te testen: start een selectie, pas daarna `aantalObjecten` van een record in de bron-CSV aan (of verwijder de rij), en vernietig de kandidaat. Omdat de bron alleen een aantal kent, kan de teststekker het verwisselen van een onderdeel (één weg, één erbij) niet nabootsen.

Een volgende `POST /selecties` kopieert opnieuw de ingestelde bron-CSV naar een nieuwe interne snapshot. De bron-CSV zelf wordt niet aangepast, dus kandidaten die in een eerdere selectie-snapshot zijn vernietigd, komen in een nieuwe selectie opnieuw uit de bron als die bron nog `SELECTED`/`ONVERANDERD` bevat.

## Authenticatie (OAuth2)

De spec beveiligt alle endpoints met OAuth2 client credentials en scopes. De teststekker controleert het bearer-token van de Cockpit tegen de JWKS van de identity provider (bijvoorbeeld Keycloak), zonder extra dependencies.

| Variabele | Standaard | Toelichting |
| --- | --- | --- |
| `AUTH_ENABLED` | `false` bij `npm start`, `true` in `compose.yaml` | Met `true` is een geldig token verplicht. Zonder `AUTH_ISSUER` of `AUTH_JWKS_URL` weigert de stekker dan te starten |
| `AUTH_ISSUER` | – | Verwachte `iss`, bijv. `https://auth.example.test/realms/vernietigingscockpit` |
| `AUTH_JWKS_URL` | – | Bijv. `https://auth.example.test/realms/vernietigingscockpit/protocol/openid-connect/certs` |
| `AUTH_AUDIENCE` | – | Optioneel: verwachte `aud` |

Controles: handtekening (alleen `RS256` en `ES256`; `none` en HMAC worden altijd geweigerd), `iss`, `exp`, `nbf` (30 s speling) en, als ingesteld, `aud`. Scopes komen uit de claim `scope` (spatiegescheiden, zoals Keycloak) of `scp`:

| Endpoint | Scope |
| --- | --- |
| `POST /selecties` | `selectie.write` |
| `GET /selecties/…` | `selectie.read` |
| `POST /vernietigingen`, `…/batches`, `…/vrijgeven` | `vernietiging.write` |
| `GET /vernietigingen/…` (ook `…/specificaties/…`) | `vernietiging.read` |

Zonder of met een ongeldig token volgt `401 UNAUTHORIZED`, bij een ontbrekende scope `403 FORBIDDEN`, beide met een `WWW-Authenticate`-header. `GET /health` blijft openbaar. De JWKS wordt gecachet; een token met een onbekende `kid` (sleutelrotatie) leidt tot opnieuw ophalen, maar hooguit eens per 30 seconden. Het ophalen heeft een time-out van 5 seconden en gelijktijdige requests delen één opvraging, zodat een hangende identity provider requests niet laat hangen (die krijgen dan `401`).

`.env` wordt alleen ingelezen door `src/index.js` (het opstartpunt), niet door de tests.

## Scenario's voor foutpaden

Standaard gedraagt de stekker zich 'gezond'. Voor het testen van foutpaden in de Cockpit kun je per stekkerinstantie een scenario instellen via env. Alle scenario's zijn deterministisch, zodat tests reproduceerbaar zijn. Een ongeldige waarde laat de stekker bij het opstarten falen.

**Kandidaatresultaten en selectie**

| Variabele | Standaard | Effect |
| --- | --- | --- |
| `SCENARIO_FAILED_PERCENTAGE` | `0` | Dit percentage van de kandidaten krijgt resultaat `FAILED` |
| `SCENARIO_CHANGED_PERCENTAGE` | `0` | Idem, `CHANGED` |
| `SCENARIO_NOT_FOUND_PERCENTAGE` | `0` | Idem, `NOT_FOUND` |
| `SCENARIO_SKIPPED_PERCENTAGE` | `0` | Idem, `SKIPPED` |
| `SCENARIO_SELECTIE_FAIL` | `false` | Met `true` eindigt elke selectie op `FAILED` (`aantalFouten = 1`) |
| `SCENARIO_LEVER_NIET_V` | `false` | Met `true` levert de stekker ook records met waardering `BEWAREN` (MDTO `B`) als kandidaat, om de automatische uitsluiting in de Cockpit te testen (ADR-0005, B-M1). De variantendataset bevat zulke records |

Welke kandidaat welk resultaat krijgt, hangt af van een hash van het kandidaat-id; dezelfde kandidaat krijgt dus altijd hetzelfde resultaat. De percentages samen zijn maximaal 100. Een kandidaat met een afwijkend resultaat wordt niet vernietigd; de foutcode is `SCENARIO_<RESULTAAT>`.

**Transportfouten**

| Variabele | Standaard | Effect |
| --- | --- | --- |
| `SCENARIO_HTTP_FAIL_FIRST_N` | `0` | De eerste N calls per endpoint en resource (methode + pad) falen; daarna slaagt de call |
| `SCENARIO_HTTP_FAIL_STATUS` | `503` | Status van de fout: `401`, `403`, `500`, `502`, `503` of `504` |
| `SCENARIO_HTTP_FAIL_MODE` | `voor` | `voor`: het verzoek wordt niet uitgevoerd. `na`: het verzoek wordt wél uitgevoerd, maar het antwoord 'gaat verloren' (test voor Idempotency-Keys) |
| `SCENARIO_HTTP_FAIL_ENDPOINTS` | alle | Kommagescheiden, bijv. `POST /vernietigingen,POST /vernietigingen/{vernietigingId}/batches` |
| `SCENARIO_HTTP_DELAY_MS` | `0` | Vaste vertraging vóór elk antwoord (voor time-outs aan Cockpit-kant) |

`GET /health` valt nooit onder een transportscenario. Let op: `502`, `503` en `504` staan niet in de spec; ze simuleren een proxy of gateway tussen Cockpit en stekker.

Voorbeeld: een stekker waarbij 30% van de kandidaten `CHANGED` is en de eerste twee batch-aanleveringen een `503` geven:

```dotenv
SCENARIO_CHANGED_PERCENTAGE=30
SCENARIO_HTTP_FAIL_FIRST_N=2
SCENARIO_HTTP_FAIL_ENDPOINTS=POST /vernietigingen/{vernietigingId}/batches
```

## Foutafhandeling

Elke fout heeft de vorm van het `Fout`-schema uit de spec:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "limit moet een geheel getal tussen 1 en 500 zijn.",
  "correlatieId": "taak-42:job-7",
  "logReference": "log-3f0c…"
}
```

- `correlatieId` is de `X-Correlation-ID` die de Cockpit meestuurt; zonder (geldige) header maakt de stekker er zelf een. De waarde komt ook terug als response-header `X-Correlation-ID`.
- `logReference` verwijst naar de logregel die de stekker voor deze fout schrijft (JSON op stdout/stderr, zonder request-body of kandidaatgegevens).
- Bij een `500` krijgt de client alleen een algemene melding; de technische details staan in de log onder de `logReference`.

Invoervalidatie (allemaal `400`): ongeldige JSON (`INVALID_JSON`), een body die geen JSON-object is, een te grote body (`REQUEST_TOO_LARGE`), een `peildatum` die geen geldige datum `JJJJ-MM-DD` is, en `offset`/`limit` buiten het bereik uit de spec (`offset` ≥ 0, `limit` 1–500).

## Lokaal draaien

```powershell
npm install
npm test
npm run test:contract
npm run test:sequence
npm start
```

De API luistert standaard op `http://localhost:3000`.

## Docker

Bouw en start een losse container zonder Traefik:

```powershell
docker build -t vernietigingscockpit-stekker-test:local .
docker run --rm -p 3000:3000 --env-file .env --name stekker-sociaal vernietigingscockpit-stekker-test:local
```

Of gebruik compose via Traefik:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

`compose.yaml` publiceert geen hostpoort. De service wordt via Traefik bereikbaar op `STEKKER_DOMAIN`, op de externe Docker-network `TRAEFIK_NETWORK`. Die network moet dezelfde zijn als waar je bestaande Traefik-container op luistert.

Voor meerdere teststekkers maak je per instantie een eigen env-bestand of map met ten minste een andere containernaam, domein, routernaam, servicenaam, stekkernaam en runtime-volume:

```dotenv
STEKKER_NAAM=CSV teststekker sociaal domein A
STEKKER_CONTAINER_NAME=stekker-sociaal-a
STEKKER_RUNTIME_VOLUME=stekker-sociaal-a-runtime
TRAEFIK_NETWORK=traefik
TRAEFIK_ROUTER_NAME=stekker-sociaal-a
TRAEFIK_SERVICE_NAME=stekker-sociaal-a
STEKKER_DOMAIN=stekker-sociaal-a.example.test
TRAEFIK_ENTRYPOINTS=websecure
TRAEFIK_TLS=true
TRAEFIK_CERTRESOLVER=letsencrypt
```

```powershell
docker compose --env-file .env.sociaal-a -p stekker-sociaal-a up --build
docker compose --env-file .env.sociaal-b -p stekker-sociaal-b up --build
```

De container bewaart zijn volledige toestand onder `/app/runtime`. In compose staat daar standaard een named volume onder, zodat elke instantie zijn eigen toestand houdt:

```text
runtime/
  selecties/{selectieId}/bron-snapshot.csv   bevroren bronset van de selectie
  selecties/{selectieId}/selectie.json       selectie en kandidaten
  selecties/{selectieId}/vernietigd.log      append-only log van vernietigde records
  vernietigingen/{vernietigingId}.json       vernietiging, batches en resultaten
  idempotency/{hash}.json                    gebruikte Idempotency-Keys
  instance.lock                              lease-lock: één instantie per runtime-map
```

Bestanden worden atomisch weggeschreven (tijdelijk bestand + hernoemen). Na een herstart gaat de stekker verder waar hij was: een selectie die `RUNNING` was, wordt afgerond, en een vernietiging die `RUNNING` was, verwerkt alleen de batches die nog geen resultaat hebben. Per batch legt de stekker de vernietigde records eerst duurzaam vast in `vernietigd.log` (met `datasync`) en slaat pas daarna de resultaten op. Stopt de stekker precies daartussen, dan herkent de hervatting de records als 'door deze vernietiging vernietigd' en meldt `SUCCESS`, niet ten onrechte `NOT_FOUND`. Een half geschreven laatste logregel na een crash wordt genegeerd.

**Eén instantie per runtime-map.** De stekker houdt locks en caches in het geheugen; twee processen op dezelfde runtime-map zouden elkaars bestanden beschadigen. Bij het starten neemt de stekker daarom een lease-lock (`instance.lock`, heartbeat elke 5 s, lease 15 s):

- een tweede instantie op dezelfde map wacht maximaal 20 s en stopt dan met exitcode 1 en de melding welke instantie de map gebruikt;
- een herstart van dezelfde container (`docker restart`) start direct door;
- een nieuwe container na een `docker kill` of crash neemt de lock over zodra de lease verlopen is (maximaal 15 s);
- ontdekt een instantie dat haar lock is overgenomen, dan stopt ze.

Schaal dus niet met replica's op één volume, maar geef elke instantie een eigen runtime-volume (zoals de compose-voorbeelden met meerdere instanties al doen).

De container draait als gebruiker `node`. Een volume dat eerder door een root-container is aangemaakt, kan bestanden van root bevatten; verwijder dan het volume (`docker volume rm <naam>`) of pas de eigenaar eenmalig aan.

`npm run test:sequence` simuleert de Cockpit via HTTP, volgens de stekker-specificatie. De test start zelf een tijdelijke stekker, voert de volledige sequence uit en sluit de stekker daarna weer. Hij draait ook mee in `npm test`.

1. healthcheck
2. selectie starten (`202`, `RUNNING`) en controleren dat kandidaten nog niet opvraagbaar zijn (`409 SELECTIE_NOT_READY`)
3. wachten tot de selectie `READY` is
4. alle kandidaten ophalen, pagina voor pagina
5. vernietiging aanmaken met een `Idempotency-Key`
6. kandidaten in deterministische volgorde aanleveren in meerdere batches, elk met een eigen key
7. vrijgeven (`202`, `RUNNING`)
8. een herstart van de Cockpit simuleren: alle muterende calls herhalen met dezelfde keys; dat levert dezelfde vernietiging op
9. pollen tot de vernietiging een eindstatus heeft
10. batchresultaten ophalen en de integriteitscontrole doen: elke aangeboden kandidaat heeft precies één resultaat, en de tellingen kloppen
11. tweede poging op hetzelfde snapshotrecord: `NOT_FOUND` met status `PARTIAL`

Aantallen en vertragingen zijn instelbaar:

```powershell
$env:SEQUENCE_AANTAL_KANDIDATEN = "25"
$env:SEQUENCE_BATCH_SIZE = "10"
$env:SEQUENCE_PAGE_SIZE = "50"
$env:SEQUENCE_SELECTIE_DELAY_MS = "100"
$env:SEQUENCE_VERNIETIGING_DELAY_MS = "50"
npm run test:sequence
```
