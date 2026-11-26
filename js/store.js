const DB = 'odometer';
const STORES = ['kv', 'blobs'];

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function openStore() {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => {
    for (const s of STORES) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
  };
  const db = await req(open);
  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  return {
    get: (store, key) => req(tx(store, 'readonly').get(key)),
    put: (store, key, value) => req(tx(store, 'readwrite').put(value, key)),
    del: (store, key) => req(tx(store, 'readwrite').delete(key)),
    clear: async () => {
      for (const s of STORES) await req(tx(s, 'readwrite').clear());
    },
  };
}

export function memoryStore() {
  const maps = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  const copy = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    maps,
    get: async (store, key) => copy(maps[store].get(key)),
    put: async (store, key, value) => void maps[store].set(key, copy(value)),
    del: async (store, key) => void maps[store].delete(key),
    clear: async () => STORES.forEach((s) => maps[s].clear()),
  };
}
