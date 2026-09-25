# Vernietigingscockpit stekker test

Deze repository bevat de teststekker voor de Vernietigingscockpit. De architectuur en API-afspraken worden gelezen uit de naastliggende repository `Vernietigingscockpit`; deze repository werkt die architectuur niet bij.

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

1. `POST /selecties` kopieert de default CSV-bron naar een selectie-snapshot onder `runtime/selecties/{selectieId}/bron-snapshot.csv`.
2. De selectie blijft tijdelijk op `RUNNING`, zodat asynchroon bron- en selectiewerk gesimuleerd wordt.
3. Na de ingestelde verwerkingstijd wordt de snapshot verwerkt en gaat de selectie naar `READY`.
4. `GET /selecties/{selectieId}` geeft de selectiestatus en metadata terug.
5. `GET /selecties/{selectieId}/objecten?offset=0&limit=100` levert vernietigingskandidaten gepagineerd op zodra de selectie `READY` is.

De selectie gebruikt standaard peildatum `2026-09-25`. Alleen records met `waardering = VERNIETIGEN`, `statusVernietigingskandidaat = SELECTED` en een `vernietigingsdatum` op of voor de peildatum worden opgenomen als vernietigingskandidaat.

De default testset in `data/sociaal-domein-zaken.csv` wordt niet aangepast. Vernietiging kan straks plaatsvinden op de selectie-snapshot, zodat dezelfde bronset opnieuw gebruikt kan worden voor nieuwe selecties.

De simulatievertraging is instelbaar met:

```powershell
$env:SELECTIE_PROCESSING_DELAY_MS = "3000"
```

## Vernietigingsflow

Vernietiging werkt op de selectie-snapshot, niet op de default testset.

1. `POST /vernietigingen` maakt een vernietigingsuitvoering voor een `selectieId`.
2. `POST /vernietigingen/{vernietigingId}/batches` levert vrijgegeven kandidaten aan.
3. `POST /vernietigingen/{vernietigingId}/vrijgeven` controleert de aantallen en start de technische verwerking.
4. `GET /vernietigingen/{vernietigingId}` geeft de uitvoeringstatus en tellingen terug.
5. `GET /vernietigingen/{vernietigingId}/resultaten?offset=0&limit=100` levert resultaten per kandidaat.

Bij succesvolle vernietiging worden de betreffende records in `runtime/selecties/{selectieId}/bron-snapshot.csv` gemarkeerd met `bronstatus = VERNIETIGD` en `statusVernietigingskandidaat = VERNIETIGD`. Een tweede vernietigingspoging op hetzelfde snapshotrecord levert daardoor `NOT_FOUND` op.

## Lokaal draaien

```powershell
npm test
npm run test:sequence
npm start
```

De API luistert standaard op `http://localhost:3000`.

`npm run test:sequence` simuleert een minimale Cockpit via HTTP. Het script start zelf een tijdelijke stekker, voert de volledige sequence uit en sluit de stekker daarna weer:

1. healthcheck
2. selectie starten
3. wachten tot selectie `READY` is
4. kandidaten ophalen
5. vernietiging aanmaken
6. batch aanleveren
7. vrijgeven
8. resultaten controleren
9. tweede poging op hetzelfde snapshotrecord controleren als `NOT_FOUND`

De batchgrootte en selectie-wachttijd zijn instelbaar:

```powershell
$env:SEQUENCE_BATCH_SIZE = "10"
$env:SEQUENCE_SELECTIE_DELAY_MS = "100"
npm run test:sequence
```
