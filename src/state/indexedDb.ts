/**
 * The browser's database, in promises.
 *
 * Everything raw about IndexedDB lives in here and nowhere else: the request
 * objects, the transactions, the version bump, the request-to-Promise
 * translation. The rest of the game — the persistence module, the store, the UI
 * — talks to this as ordinary async functions and never sees an
 * `IDBRequest`.
 *
 * It is a wrapper rather than a library on purpose. There is no existing
 * IndexedDB dependency in the project, and adding a framework for what is
 * fundamentally "open a database, put a record in one store, read it back" would
 * be a larger thing to reason about than the thing it replaced. This is the
 * whole surface the game needs, and it is about two hundred lines.
 *
 * Two things it is careful about, because both have bitten this codebase before:
 *
 *  - **Transactions are closed by their event loop, not by their callback.**
 *    Awaiting anything that is not an IDB request inside a transaction
 *    silently ends the transaction, and the write that follows fails with a
 *    `TransactionInactiveError` that looks nothing like its cause. Every helper
 *    here therefore does its IDB work in one turn of the event loop and nothing
 *    else; where several steps are needed, the caller opens one transaction and
 *    uses `putAll`/`getAll` on it.
 *
 *  - **A rejected transaction does not reject the request.** `request.onerror`
 *    fires first and then `transaction.onerror`, and an operation whose failure
 *    is only caught at the transaction level reports `AbortError` rather than
 *    the quota error that actually happened. So the promise for a request is
 *    built from that request's own error.
 */

/**
 * The schema version of the browser database.
 *
 * This is *not* the save format. `GAME_STATE_VERSION` in the domain layer is the
 * version of a career's contents and moves whenever the simulation changes; this
 * is the version of the shape of the database and moves only when this file
 * changes. They are different facts about different things, and using one for
 * both would mean a simulation change appearing to require a database upgrade.
 */
export const DB_VERSION = 1;

export const DB_NAME = 'se27';

export const SAVES = 'saves';
export const METADATA = 'metadata';

/**
 * Raised when the browser will not give us a database at all.
 *
 * This is deliberately a distinct type from "the save is broken". A missing or
 * refused database is the storage system failing; a save that will not parse is
 * the data being wrong. The manager is told different things about the two,
 * because only one of them is his to fix.
 */
export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

/** A generic key/value record, used for the metadata store. */
export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}

/** True when this environment has a database to open. */
export function isAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    // Some privacy modes throw on the mere mention of the global.
    return false;
  }
}

let database: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;

/**
 * Open the database, or hand back the one already open.
 *
 * Concurrent callers share a single `open` request. Two tabs racing to create
 * the same database is a normal thing for browsers to do, and letting the
 * second one wait for the first is both cheaper and less likely to deadlock than
 * opening it twice.
 */
export function open(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  if (opening) return opening;

  if (!isAvailable()) {
    return Promise.reject(
      new StorageUnavailableError('This browser has no database available for storing careers.'),
    );
  }

  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new StorageUnavailableError('The browser refused to open its storage.', { cause: error }));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      // The key paths are the whole schema. A save is addressed by its slot and
      // metadata by its name, so neither needs an index to be looked up.
      if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES, { keyPath: 'slot' });
      if (!db.objectStoreNames.contains(METADATA)) db.createObjectStore(METADATA, { keyPath: 'key' });
    };

    request.onsuccess = () => {
      database = request.result;
      // If another tab deletes or upgrades the database out from under us, the
      // handle we are holding is dead. Dropping it means the next call opens a
      // fresh one rather than failing forever against a closed connection.
      database.onclose = () => {
        database = null;
        opening = null;
      };
      database.onversionchange = () => {
        database?.close();
        database = null;
        opening = null;
      };
      resolve(database);
    };

    request.onerror = () => {
      opening = null;
      reject(
        new StorageUnavailableError('The browser would not open its storage for this game.', {
          cause: request.error,
        }),
      );
    };

    request.onblocked = () => {
      // Another tab is holding an older version open. We do not tear anything
      // down to force it — that tab may be mid-career — but we stop waiting and
      // report rather than hanging on a promise that may never settle.
      reject(new StorageUnavailableError('Another tab is holding this game’s storage open.'));
    };
  });

  try {
    return opening;
  } catch (error) {
    opening = null;
    return Promise.reject(new StorageUnavailableError('The browser refused to open its storage.', { cause: error }));
  }
}

/**
 * Forget the open database.
 *
 * Only for tests: `fake-indexeddb` is rebuilt between cases, and a cached handle
 * onto a database that no longer exists would make every later test lie.
 */
export function resetForTests(): void {
  try {
    database?.close();
  } catch {
    // Already closed, or never opened.
  }
  database = null;
  opening = null;
}

/** One store, one operation, resolved when the transaction that owns it commits. */
function withStore<T>(
  storeName: typeof SAVES | typeof METADATA,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(storeName, mode);
        } catch (error) {
          reject(error);
          return;
        }

        let result: T | undefined;
        let failed = false;

        tx.oncomplete = () => {
          if (!failed) resolve(result);
        };
        tx.onerror = () => {
          failed = true;
          // `tx.error` is the transaction-level error, which for a quota failure
          // is the informative one; a request that failed on its own has already
          // rejected with something better via `request.onerror` below.
          reject(tx.error ?? new Error('The storage transaction failed.'));
        };
        tx.onabort = () => {
          if (!failed) {
            failed = true;
            reject(tx.error ?? new Error('The storage transaction was rolled back.'));
          }
        };

        try {
          const request = run(tx.objectStore(storeName));
          if (request) {
            request.onsuccess = () => {
              result = request.result;
            };
            request.onerror = () => {
              // Stop here rather than letting the transaction abort too, so the
              // caller gets the real reason for the failure.
              failed = true;
              reject(request.error ?? new Error('The storage request failed.'));
              try {
                tx.abort();
              } catch {
                // Already finished; the rejection above is what matters.
              }
            };
          }
        } catch (error) {
          failed = true;
          reject(error);
        }
      }),
  );
}

/** Read one record by key. */
export function get<T>(storeName: typeof SAVES | typeof METADATA, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T>(storeName, 'readonly', (store) => store.get(key) as IDBRequest<T>);
}

/** Write one record by key. Resolves once the transaction has committed. */
export function put<T>(storeName: typeof SAVES | typeof METADATA, value: T): Promise<void> {
  return withStore(storeName, 'readwrite', (store) => {
    store.put(value);
  }).then(() => undefined);
}

/**
 * Write several records in a single transaction.
 *
 * Used by the legacy migration, which either wants a manager's whole set of
 * careers moved across or none of it visible halfway.
 */
export function putAll<T>(storeName: typeof SAVES | typeof METADATA, values: readonly T[]): Promise<void> {
  return withStore(storeName, 'readwrite', (store) => {
    for (const value of values) store.put(value);
  }).then(() => undefined);
}

/** Read every record in a store. */
export function getAll<T>(storeName: typeof SAVES | typeof METADATA): Promise<T[]> {
  return withStore<T[]>(storeName, 'readonly', (store) => store.getAll() as IDBRequest<T[]>).then(
    (rows) => rows ?? [],
  );
}

/** Delete every record matching the given keys, in one transaction. */
export function deleteKeys(storeName: typeof SAVES | typeof METADATA, keys: readonly IDBValidKey[]): Promise<void> {
  return withStore(storeName, 'readwrite', (store) => {
    for (const key of keys) store.delete(key);
  }).then(() => undefined);
}

/** Delete a single record. */
export function deleteKey(storeName: typeof SAVES | typeof METADATA, key: IDBValidKey): Promise<void> {
  return deleteKeys(storeName, [key]);
}

/** Whether a record exists, without reading its (large) contents. */
export function has(storeName: typeof SAVES | typeof METADATA, key: IDBValidKey): Promise<boolean> {
  return withStore(storeName, 'readonly', (store) => store.getKey(key)).then((key) => key !== undefined);
}

/**
 * The browser's storage manager, if it has one.
 *
 * Every call is guarded: some privacy modes throw on the mention of
 * `navigator.storage`, and a browser without it is not a problem to report —
 * the game simply cannot ask about keeping its data.
 */
function manager(): StorageManager | null {
  try {
    if (typeof navigator === 'undefined') return null;
    return navigator.storage ?? null;
  } catch {
    return null;
  }
}

/**
 * What the browser will say about making this game's storage persistent.
 *
 * `unsupported` and `unknown` are kept apart from `denied` on purpose: a
 * browser that never had the API has not refused anything, and the difference is
 * the difference between "this can be improved" and "this is as good as it
 * gets". Neither is a guarantee, and neither is treated as one.
 */
export type PersistenceStatus = 'granted' | 'denied' | 'unsupported' | 'unknown';

/** Whether the game's storage is already persistent. */
export async function persisted(): Promise<boolean> {
  const storage = manager();
  if (!storage?.persisted) return false;
  try {
    return await storage.persisted();
  } catch {
    return false;
  }
}

/**
 * Ask the browser to keep this game's storage rather than evict it under
 * pressure.
 *
 * The answer is reported rather than assumed, and a refusal is a normal outcome
 * rather than an error: browsers grant this on their own criteria — how much the
 * site is used, whether it is installed, whether it has been visited often
 * enough — and a game that treated a refusal as a failure would be wrong about
 * every manager whose browser said no and who then kept his career for years.
 */
export async function requestPersistence(): Promise<PersistenceStatus> {
  const storage = manager();
  if (!storage?.persist) return 'unsupported';
  try {
    if (storage.persisted && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

/** How much room the browser says it has, for diagnostics. Never required. */
export async function estimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}