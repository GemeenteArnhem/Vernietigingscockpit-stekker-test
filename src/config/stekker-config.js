import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnvFile(path.join(rootDir, '.env'));

export const stekkerConfig = {
  naam: process.env.STEKKER_NAAM || 'CSV teststekker sociaal domein',
  omschrijving: process.env.STEKKER_OMSCHRIJVING || 'Teststekker voor fictieve sociaal-domein-zaken uit een CSV-bron.',
  versie: process.env.STEKKER_VERSIE || '0.1.0',
  apiVersie: process.env.STEKKER_API_VERSIE || '1.0.0',
  configuratieversie: process.env.STEKKER_CONFIGURATIEVERSIE || 'csv-sociaal-domein-2026-09-25',
  defaultPeildatum: process.env.STEKKER_DEFAULT_PEILDATUM || '2026-09-25',
  selectieProcessingDelayMs: Number.parseInt(process.env.SELECTIE_PROCESSING_DELAY_MS || '3000', 10),
  runtime: {
    selectiesPath: resolveFromRoot(process.env.STEKKER_RUNTIME_SELECTIES_PATH || path.join('runtime', 'selecties'))
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

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const envText = fs.readFileSync(envPath, 'utf8');

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
