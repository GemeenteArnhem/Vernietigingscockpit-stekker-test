import http from 'node:http';
import { SelectieNogNietGereedError } from '../application/selectie-service.js';
import { ConflictError, ResourceNotFoundError, ValidationError } from '../application/vernietiging-service.js';

export function createHttpServer({ selectieService, vernietigingService }) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { status: 'ok' });
      }

      if (request.method === 'POST' && url.pathname === '/selecties') {
        const body = await readJsonBody(request);
        const selectie = await selectieService.startSelectie({
          peildatum: body.peildatum
        });

        return sendJson(response, 201, toSelectieResponse(selectie));
      }

      if (request.method === 'POST' && url.pathname === '/vernietigingen') {
        const body = await readJsonBody(request);
        const vernietiging = vernietigingService.startVernietiging({
          selectieId: body.selectieId,
          cockpitTaakId: body.cockpitTaakId,
          besluitReferentie: body.besluitReferentie,
          vernietigingsdossierId: body.vernietigingsdossierId
        });

        return sendJson(response, 201, toVernietigingResponse(vernietiging));
      }

      const vernietigingMatch = url.pathname.match(/^\/vernietigingen\/([^/]+)$/);
      if (request.method === 'GET' && vernietigingMatch) {
        const vernietiging = vernietigingService.getVernietiging(vernietigingMatch[1]);

        if (!vernietiging) {
          return sendJson(response, 404, { code: 'VERNIETIGING_NOT_FOUND', message: 'Vernietiging niet gevonden.' });
        }

        return sendJson(response, 200, toVernietigingResponse(vernietiging));
      }

      const batchMatch = url.pathname.match(/^\/vernietigingen\/([^/]+)\/batches$/);
      if (request.method === 'POST' && batchMatch) {
        const body = await readJsonBody(request);
        const batch = vernietigingService.voegBatchToe(batchMatch[1], {
          batchNummer: body.batchNummer,
          objecten: body.objecten
        });

        return sendJson(response, 202, batch);
      }

      const vrijgevenMatch = url.pathname.match(/^\/vernietigingen\/([^/]+)\/vrijgeven$/);
      if (request.method === 'POST' && vrijgevenMatch) {
        const body = await readJsonBody(request);
        const vernietiging = await vernietigingService.vrijgeven(vrijgevenMatch[1], {
          aantalBatches: body.aantalBatches,
          aantalKandidaten: body.aantalKandidaten
        });

        return sendJson(response, 200, toVernietigingResponse(vernietiging));
      }

      const resultatenMatch = url.pathname.match(/^\/vernietigingen\/([^/]+)\/resultaten$/);
      if (request.method === 'GET' && resultatenMatch) {
        const pagina = vernietigingService.getResultaten(resultatenMatch[1], {
          offset: url.searchParams.get('offset'),
          limit: url.searchParams.get('limit')
        });

        return sendJson(response, 200, pagina);
      }

      const selectieMatch = url.pathname.match(/^\/selecties\/([^/]+)$/);
      if (request.method === 'GET' && selectieMatch) {
        const selectie = selectieService.getSelectie(selectieMatch[1]);

        if (!selectie) {
          return sendJson(response, 404, { code: 'SELECTIE_NOT_FOUND', message: 'Selectie niet gevonden.' });
        }

        return sendJson(response, 200, toSelectieResponse(selectie));
      }

      const objectenMatch = url.pathname.match(/^\/selecties\/([^/]+)\/objecten$/);
      if (request.method === 'GET' && objectenMatch) {
        const pagina = selectieService.getKandidaten(objectenMatch[1], {
          offset: url.searchParams.get('offset'),
          limit: url.searchParams.get('limit')
        });

        if (!pagina) {
          return sendJson(response, 404, { code: 'SELECTIE_NOT_FOUND', message: 'Selectie niet gevonden.' });
        }

        return sendJson(response, 200, pagina);
      }

      return sendJson(response, 404, { code: 'NOT_FOUND', message: 'Endpoint niet gevonden.' });
    } catch (error) {
      if (error instanceof SelectieNogNietGereedError) {
        return sendJson(response, 409, {
          code: 'SELECTIE_NOT_READY',
          message: error.message,
          selectieId: error.selectieId,
          status: error.status
        });
      }

      if (error instanceof ValidationError) {
        return sendJson(response, 400, {
          code: error.code,
          message: error.message
        });
      }

      if (error instanceof ResourceNotFoundError) {
        return sendJson(response, 404, {
          code: error.code,
          message: error.message
        });
      }

      if (error instanceof ConflictError) {
        return sendJson(response, 409, {
          code: error.code,
          message: error.message
        });
      }

      return sendJson(response, 500, {
        code: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  });
}

function toSelectieResponse(selectie) {
  const { kandidaten, ...metadata } = selectie;
  return metadata;
}

function toVernietigingResponse(vernietiging) {
  const { batches, resultaten, ...metadata } = vernietiging;
  return metadata;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  return rawBody ? JSON.parse(rawBody) : {};
}
