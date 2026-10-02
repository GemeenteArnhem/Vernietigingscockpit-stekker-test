import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './csv-parser.js';

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

  // De snapshot zelf blijft ongewijzigd (bevroren bronset). Vernietigde records staan
  // in een append-only log ernaast: één JSON-regel per vernietigd bronrecord.
  // Geeft een Map bronId → vernietigingId.
  async leesVernietigd(snapshotPath) {
    let tekst;

    try {
      tekst = await fs.readFile(vernietigingslogPad(snapshotPath), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return new Map();
      }

      throw error;
    }

    const vernietigd = new Map();

    for (const regel of tekst.split('\n')) {
      if (!regel.trim()) {
        continue;
      }

      try {
        const { bronId, vernietigingId } = JSON.parse(regel);
        vernietigd.set(bronId, vernietigingId);
      } catch {
        // Een half geschreven laatste regel na een crash telt niet mee.
      }
    }

    return vernietigd;
  }

  // Voegt regels toe en wacht tot ze op schijf staan (datasync), zodat een vernietiging
  // nooit wordt gemeld zonder dat ze is vastgelegd.
  async registreerVernietigd(snapshotPath, regels) {
    if (regels.length === 0) {
      return;
    }

    const handle = await fs.open(vernietigingslogPad(snapshotPath), 'a+');

    try {
      const { size } = await handle.stat();
      let voorvoegsel = '';

      // Eindigt het log op een half geschreven regel (crash), begin dan op een nieuwe regel.
      if (size > 0) {
        const laatste = Buffer.alloc(1);
        await handle.read(laatste, 0, 1, size - 1);
        voorvoegsel = laatste.toString() === '\n' ? '' : '\n';
      }

      await handle.appendFile(voorvoegsel + regels.map((regel) => `${JSON.stringify(regel)}\n`).join(''), 'utf8');
      await handle.datasync();
    } finally {
      await handle.close();
    }
  }
}

export function vernietigingslogPad(snapshotPath) {
  return path.join(path.dirname(snapshotPath), 'vernietigd.log');
}
