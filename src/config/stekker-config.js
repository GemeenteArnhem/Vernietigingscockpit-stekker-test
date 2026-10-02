import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAuthConfig } from './auth-config.js';
import { parseScenario } from './scenario-config.js';

// .env wordt alleen door het opstartpunt (src/index.js) ingelezen, zodat tests
// nooit afhangen van een lokale .env.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const stekkerConfig = {
  naam: process.env.STEKKER_NAAM || 'CSV teststekker sociaal domein',
  omschrijving: process.env.STEKKER_OMSCHRIJVING || 'Teststekker voor fictieve sociaal-domein-zaken uit een CSV-bron.',
  versie: process.env.STEKKER_VERSIE || '0.1.0',
  apiVersie: process.env.STEKKER_API_VERSIE || '1.0.0',
  configuratieversie: process.env.STEKKER_CONFIGURATIEVERSIE || 'csv-sociaal-domein-2026-09-25',
  defaultPeildatum: process.env.STEKKER_DEFAULT_PEILDATUM || '2026-09-25',
  selectieProcessingDelayMs: Number.parseInt(process.env.SELECTIE_PROCESSING_DELAY_MS || '3000', 10),
  vernietigingProcessingDelayMs: Number.parseInt(process.env.VERNIETIGING_PROCESSING_DELAY_MS || '1000', 10),
  idempotencyKeyRequired: process.env.IDEMPOTENCY_KEY_REQUIRED === 'true',
  maxBodyBytes: Number.parseInt(process.env.MAX_BODY_BYTES || '1048576', 10),
  logRequests: process.env.LOG_REQUESTS !== 'false',
  scenario: parseScenario(process.env),
  auth: parseAuthConfig(process.env),
  runtime: {
    selectiesPath: resolveFromRoot(process.env.STEKKER_RUNTIME_SELECTIES_PATH || path.join('runtime', 'selecties')),
    vernietigingenPath: resolveFromRoot(process.env.STEKKER_RUNTIME_VERNIETIGINGEN_PATH || path.join('runtime', 'vernietigingen')),
    idempotencyPath: resolveFromRoot(process.env.STEKKER_RUNTIME_IDEMPOTENCY_PATH || path.join('runtime', 'idempotency')),
    lockPath: resolveFromRoot(process.env.STEKKER_RUNTIME_LOCK_PATH || path.join('runtime', 'instance.lock'))
  },
  dataSource: {
    type: 'csv',
    name: process.env.STEKKER_DATASOURCE_NAME || 'sociaal-domein-zaken',
    path: resolveFromRoot(process.env.STEKKER_CSV_PATH || path.join('data', 'sociaal-domein-zaken.csv'))
  }
};

export const serverConfig = {
  port: Number.parseInt(process.env.PORT || '3000', 10)
};

function resolveFromRoot(configuredPath) {
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(rootDir, configuredPath);
}
