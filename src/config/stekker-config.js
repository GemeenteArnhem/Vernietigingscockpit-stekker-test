import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const stekkerConfig = {
  naam: 'CSV teststekker sociaal domein',
  omschrijving: 'Teststekker voor fictieve sociaal-domein-zaken uit een CSV-bron.',
  versie: '0.1.0',
  apiVersie: '1.0.0',
  configuratieversie: 'csv-sociaal-domein-2026-09-25',
  defaultPeildatum: '2026-09-25',
  selectieProcessingDelayMs: Number.parseInt(process.env.SELECTIE_PROCESSING_DELAY_MS || '3000', 10),
  runtime: {
    selectiesPath: path.join(rootDir, 'runtime', 'selecties')
  },
  dataSource: {
    type: 'csv',
    name: 'sociaal-domein-zaken',
    path: path.join(rootDir, 'data', 'sociaal-domein-zaken.csv')
  }
};
