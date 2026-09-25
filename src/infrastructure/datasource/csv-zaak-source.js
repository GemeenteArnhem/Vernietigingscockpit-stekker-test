import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv, stringifyCsv } from './csv-parser.js';

export class CsvZaakSource {
  constructor(csvPath) {
    this.csvPath = csvPath;
  }

  async findAll() {
    const text = await fs.readFile(this.csvPath, 'utf8');
    return parseCsv(text);
  }

  async copyTo(snapshotPath) {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.copyFile(this.csvPath, snapshotPath);
    return snapshotPath;
  }

  async findAllFrom(snapshotPath) {
    const text = await fs.readFile(snapshotPath, 'utf8');
    return parseCsv(text);
  }

  async saveAllTo(snapshotPath, records) {
    await fs.writeFile(snapshotPath, stringifyCsv(records), 'utf8');
  }
}
