import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHttpServer } from '../src/api/http-server.js';
import { SelectieService } from '../src/application/selectie-service.js';
import { VernietigingService } from '../src/application/vernietiging-service.js';
import { stekkerConfig } from '../src/config/stekker-config.js';
import { CsvZaakSource } from '../src/infrastructure/datasource/csv-zaak-source.js';
import { InMemorySelectieRepository } from '../src/infrastructure/repositories/in-memory-selectie-repository.js';
import { InMemoryVernietigingRepository } from '../src/infrastructure/repositories/in-memory-vernietiging-repository.js';

const sequenceConfig = {
  peildatum: '2026-09-25',
  batchSize: Number.parseInt(process.env.SEQUENCE_BATCH_SIZE || '10', 10),
  selectieDelayMs: Number.parseInt(process.env.SEQUENCE_SELECTIE_DELAY_MS || '100', 10),
  pollIntervalMs: 50,
  pollTimeoutMs: 5000
};

const server = await startTestServer();

try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  logStep(`Stekker gestart op ${baseUrl}`);

  const health = await httpJson(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  logStep('Healthcheck OK');

  const selectieStart = await httpJson(`${baseUrl}/selecties`, {
    method: 'POST',
    body: { peildatum: sequenceConfig.peildatum }
  });
  assert.equal(selectieStart.status, 201);
  assert.equal(selectieStart.body.selectiestatus, 'RUNNING');
  logStep(`Selectie gestart: ${selectieStart.body.selectieId}`);

  const earlyObjects = await httpJson(`${baseUrl}/selecties/${selectieStart.body.selectieId}/objecten?offset=0&limit=1`, {
    expectedStatuses: [409]
  });
  assert.equal(earlyObjects.body.code, 'SELECTIE_NOT_READY');
  logStep('Vroege objectopvraag geeft SELECTIE_NOT_READY');

  const selectie = await waitForReadySelection(baseUrl, selectieStart.body.selectieId);
  assert.equal(selectie.selectiestatus, 'READY');
  assert.equal(selectie.totaalKandidaten, 142);
  logStep(`Selectie READY met ${selectie.totaalKandidaten} kandidaten`);

  const kandidatenPagina = await httpJson(
    `${baseUrl}/selecties/${selectie.selectieId}/objecten?offset=0&limit=${sequenceConfig.batchSize}`
  );
  assert.equal(kandidatenPagina.status, 200);
  assert.equal(kandidatenPagina.body.objecten.length, sequenceConfig.batchSize);
  logStep(`${kandidatenPagina.body.objecten.length} kandidaten opgehaald voor batch`);

  const vernietigingStart = await httpJson(`${baseUrl}/vernietigingen`, {
    method: 'POST',
    body: {
      selectieId: selectie.selectieId,
      cockpitTaakId: 'cockpit-sequence-taak-001',
      besluitReferentie: 'cockpit-sequence-besluit-001',
      vernietigingsdossierId: 'cockpit-sequence-dossier-001'
    }
  });
  assert.equal(vernietigingStart.status, 201);
  assert.equal(vernietigingStart.body.status, 'IDLE');
  logStep(`Vernietiging aangemaakt: ${vernietigingStart.body.vernietigingId}`);

  const batchObjecten = kandidatenPagina.body.objecten.map((kandidaat) => ({
    vernietigingskandidaatId: kandidaat.vernietigingskandidaatId,
    bronId: kandidaat.bronId
  }));

  const batch = await httpJson(`${baseUrl}/vernietigingen/${vernietigingStart.body.vernietigingId}/batches`, {
    method: 'POST',
    body: {
      batchNummer: 1,
      objecten: batchObjecten
    }
  });
  assert.equal(batch.status, 202);
  assert.equal(batch.body.objecten.length, sequenceConfig.batchSize);
  logStep('Batch 1 aangeleverd');

  const vrijgave = await httpJson(`${baseUrl}/vernietigingen/${vernietigingStart.body.vernietigingId}/vrijgeven`, {
    method: 'POST',
    body: {
      aantalBatches: 1,
      aantalKandidaten: sequenceConfig.batchSize
    }
  });
  assert.equal(vrijgave.status, 200);
  assert.equal(vrijgave.body.status, 'COMPLETED');
  assert.equal(vrijgave.body.succesvolVernietigd, sequenceConfig.batchSize);
  assert.equal(vrijgave.body.nietGevonden, 0);
  logStep(`Vernietiging COMPLETED met ${vrijgave.body.succesvolVernietigd} SUCCESS resultaten`);

  const resultaten = await httpJson(
    `${baseUrl}/vernietigingen/${vernietigingStart.body.vernietigingId}/resultaten?offset=0&limit=100`
  );
  assert.equal(resultaten.status, 200);
  assert.equal(resultaten.body.resultaten.length, sequenceConfig.batchSize);
  assert.equal(resultaten.body.resultaten.every((resultaat) => resultaat.resultaat === 'SUCCESS'), true);
  logStep('Resultaten opgehaald en gevalideerd');

  const tweedeVernietiging = await httpJson(`${baseUrl}/vernietigingen`, {
    method: 'POST',
    body: {
      selectieId: selectie.selectieId,
      cockpitTaakId: 'cockpit-sequence-taak-002',
      besluitReferentie: 'cockpit-sequence-besluit-002'
    }
  });
  await httpJson(`${baseUrl}/vernietigingen/${tweedeVernietiging.body.vernietigingId}/batches`, {
    method: 'POST',
    body: {
      batchNummer: 1,
      objecten: [batchObjecten[0]]
    }
  });
  const tweedeVrijgave = await httpJson(`${baseUrl}/vernietigingen/${tweedeVernietiging.body.vernietigingId}/vrijgeven`, {
    method: 'POST',
    body: {
      aantalBatches: 1,
      aantalKandidaten: 1
    }
  });
  assert.equal(tweedeVrijgave.body.nietGevonden, 1);
  logStep('Tweede poging op hetzelfde snapshotrecord geeft NOT_FOUND');

  console.log('\nCockpit sequence succesvol afgerond.');
} finally {
  await closeServer(server);
}

async function startTestServer() {
  const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
  const selectieService = new SelectieService({
    zaakSource,
    selectieRepository: new InMemorySelectieRepository(),
    processingDelayMs: sequenceConfig.selectieDelayMs
  });
  const vernietigingService = new VernietigingService({
    zaakSource,
    selectieService,
    vernietigingRepository: new InMemoryVernietigingRepository()
  });
  const testServer = createHttpServer({ selectieService, vernietigingService });

  testServer.listen(0, '127.0.0.1');
  await once(testServer, 'listening');
  return testServer;
}

async function waitForReadySelection(baseUrl, selectieId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < sequenceConfig.pollTimeoutMs) {
    const response = await httpJson(`${baseUrl}/selecties/${selectieId}`);

    if (response.body.selectiestatus === 'READY') {
      return response.body;
    }

    if (response.body.selectiestatus === 'FAILED') {
      throw new Error(`Selectie ${selectieId} is FAILED.`);
    }

    await sleep(sequenceConfig.pollIntervalMs);
  }

  throw new Error(`Selectie ${selectieId} werd niet READY binnen ${sequenceConfig.pollTimeoutMs}ms.`);
}

async function httpJson(url, { method = 'GET', body, expectedStatuses } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const responseBody = await response.json();
  const allowedStatuses = expectedStatuses ?? Array.from({ length: 100 }, (_, index) => 200 + index);

  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`Onverwachte HTTP-status ${response.status} voor ${method} ${url}: ${JSON.stringify(responseBody)}`);
  }

  return {
    status: response.status,
    body: responseBody
  };
}

async function closeServer(testServer) {
  if (!testServer.listening) {
    return;
  }

  testServer.close();
  await once(testServer, 'close');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logStep(message) {
  console.log(`[sequence] ${message}`);
}
