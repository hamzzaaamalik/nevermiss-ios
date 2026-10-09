// The book catalog kept on the iPad (Build 40). IndexedDB, not
// localStorage: picture books made the catalog far bigger than
// localStorage allows, so it was never saved and every launch started
// from an old list (Rick, Oct 8: new books took minutes to show up in
// search). Each book is kept with its updatedAt, so a launch downloads
// only the books that are new or changed.
import type { CatalogBook } from "./api";

const DB_NAME = "nm-catalog";
const STORE = "books";
const ORDER_KEY = "__order";

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise(resolve => {
      try {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "id" }); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise(resolve => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** The books kept on this iPad, in the server's order. */
export async function loadCatalog(): Promise<CatalogBook[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result ?? []) as Array<CatalogBook | { id: string; ids: string[] }>;
        const order = (rows.find(r => r.id === ORDER_KEY) as { ids?: string[] } | undefined)?.ids ?? [];
        const books = rows.filter((r): r is CatalogBook => r.id !== ORDER_KEY);
        const pos = new Map(order.map((id, i) => [id, i]));
        books.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
        resolve(books);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Keep these books (replacing older copies) and the catalog's order. */
export async function saveCatalog(books: CatalogBook[], order: string[], remove: string[] = []): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const b of books) store.put(b);
    for (const id of remove) store.delete(id);
    store.put({ id: ORDER_KEY, ids: order });
    await done(tx);
  } catch {
    /* storage full or unavailable: the next launch downloads again */
  }
}
