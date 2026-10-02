import { createHttpServer } from './api/http-server.js';
import { SelectieService } from './application/selectie-service.js';
import { VernietigingService } from './application/vernietiging-service.js';
import { serverConfig, stekkerConfig } from './config/stekker-config.js';
import { CsvZaakSource } from './infrastructure/datasource/csv-zaak-source.js';
import { FileIdempotencyRepository } from './infrastructure/repositories/file-idempotency-repository.js';
import { FileSelectieRepository } from './infrastructure/repositories/file-selectie-repository.js';
import { FileVernietigingRepository } from './infrastructure/repositories/file-vernietiging-repository.js';
import { RuntimeLock } from './infrastructure/runtime-lock.js';

const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
const selectieService = new SelectieService({
  zaakSource,
  selectieRepository: new FileSelectieRepository(stekkerConfig.runtime.selectiesPath)
});

const vernietigingService = new VernietigingService({
  zaakSource,
  selectieService,
  vernietigingRepository: new FileVernietigingRepository(stekkerConfig.runtime.vernietigingenPath),
  idempotencyRepository: new FileIdempotencyRepository(stekkerConfig.runtime.idempotencyPath)
});

// Eén instantie per runtime-map: eerst de lock, pas daarna hervatten en requests aannemen.
const runtimeLock = new RuntimeLock({
  lockPath: stekkerConfig.runtime.lockPath,
  onVerloren: (eigenaar) => {
    console.error(`Runtime-lock is overgenomen door ${eigenaar?.hostname ?? 'onbekend'} (pid ${eigenaar?.pid ?? '?'}); deze instantie stopt.`);
    process.exit(1);
  }
});
await runtimeLock.verkrijg();

// Toestand staat op het runtime-volume; werk dat bij een vorige stop onderbroken is, gaat verder.
const hervatteSelecties = await selectieService.hervatOnderbrokenSelecties();
const hervatteVernietigingen = vernietigingService.hervatOnderbrokenVerwerkingen();

if (hervatteSelecties.length > 0 || hervatteVernietigingen.length > 0) {
  console.log(`Hervat na herstart: ${hervatteSelecties.length} selectie(s), ${hervatteVernietigingen.length} vernietiging(en).`);
}

const server = createHttpServer({ selectieService, vernietigingService });

server.listen(serverConfig.port, () => {
  console.log(`${stekkerConfig.naam} luistert op http://localhost:${serverConfig.port}`);
});

const AFSLUIT_TIMEOUT_MS = 10000;

// Bij stoppen (docker stop, Ctrl+C): geen nieuwe requests meer aannemen en lopende
// batchverwerking afmaken, zodat een snapshot niet halverwege wordt weggeschreven.
async function sluitAf(signaal) {
  console.log(`${signaal} ontvangen, stekker sluit af.`);
  server.close();
  const timeout = new Promise((resolve) => setTimeout(resolve, AFSLUIT_TIMEOUT_MS).unref());
  await Promise.race([
    Promise.allSettled([...vernietigingService.lopendeVerwerkingen.values()]),
    timeout
  ]);
  runtimeLock.vrijgeven();
  process.exit(0);
}

process.once('SIGTERM', () => sluitAf('SIGTERM'));
process.once('SIGINT', () => sluitAf('SIGINT'));
