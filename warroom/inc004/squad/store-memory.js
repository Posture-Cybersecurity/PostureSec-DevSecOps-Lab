/**
 * In-memory squad store (tests, and a single-process control plane). update() is an atomic
 * read-modify-write: the mutator runs synchronously on a private copy, which is only stored
 * if it returns without throwing.
 */
function memoryStore(initial) {
  let doc = JSON.stringify(initial);
  return {
    load: async () => JSON.parse(doc),
    update: async (mutator) => {
      const next = mutator(JSON.parse(doc));
      doc = JSON.stringify(next);
      return JSON.parse(doc);
    },
  };
}

module.exports = { memoryStore };
