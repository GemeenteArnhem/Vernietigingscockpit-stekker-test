import { JsonFileStore } from './json-file-store.js';

// Selecties staan naast hun snapshot: <selectiesPath>/<selectieId>/selectie.json.
export class FileSelectieRepository {
  #store;

  constructor(selectiesPath) {
    this.#store = new JsonFileStore(selectiesPath, (id) => `${id}/selectie.json`);
  }

  save(selectie) {
    this.#store.save(selectie.selectieId, selectie);
    return selectie;
  }

  findById(selectieId) {
    return this.#store.findById(selectieId);
  }

  findAll() {
    return this.#store.findAll();
  }
}
