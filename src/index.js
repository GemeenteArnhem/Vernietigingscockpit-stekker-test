import { createHttpServer } from './api/http-server.js';
import { SelectieService } from './application/selectie-service.js';
import { VernietigingService } from './application/vernietiging-service.js';
import { stekkerConfig } from './config/stekker-config.js';
import { CsvZaakSource } from './infrastructure/datasource/csv-zaak-source.js';
import { InMemorySelectieRepository } from './infrastructure/repositories/in-memory-selectie-repository.js';
import { InMemoryVernietigingRepository } from './infrastructure/repositories/in-memory-vernietiging-repository.js';

const port = Number.parseInt(process.env.PORT || '3000', 10);

const zaakSource = new CsvZaakSource(stekkerConfig.dataSource.path);
const selectieService = new SelectieService({
  zaakSource,
  selectieRepository: new InMemorySelectieRepository()
});

const vernietigingService = new VernietigingService({
  zaakSource,
  selectieService,
  vernietigingRepository: new InMemoryVernietigingRepository()
});

const server = createHttpServer({ selectieService, vernietigingService });

server.listen(port, () => {
  console.log(`CSV teststekker luistert op http://localhost:${port}`);
});
