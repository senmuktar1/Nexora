import { isEncryptedVault, type EncryptedVault } from "./crypto";

/**
 * IndexedDB persistence for the encrypted wallet vault. Only ciphertext and
 * public metadata are ever written here — never plaintext secrets.
 */

export const WALLET_DB_NAME = "nexora-wallet";
const STORE = "vault";
const RECORDS = "records";
const PRIMARY = "primary";

function idb(): IDBFactory {
  if (typeof indexedDB === "undefined") throw new Error("storage_unavailable");
  return indexedDB;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb().open(WALLET_DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains(RECORDS)) request.result.createObjectStore(RECORDS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("storage_unavailable"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(new Error("storage_failed"));
      tx.onabort = () => reject(new Error("storage_failed"));
    });
  } finally {
    db.close();
  }
}

export async function loadVault(): Promise<EncryptedVault | null> {
  const value = await withStore<unknown>("readonly", store => store.get(PRIMARY));
  return isEncryptedVault(value) ? value : null;
}

export async function saveVault(vault: EncryptedVault): Promise<void> {
  if (!isEncryptedVault(vault)) throw new Error("invalid_vault");
  await withStore("readwrite", store => store.put(vault, PRIMARY));
}

/** Removes the vault record and then the whole database. */
export async function destroyVault(): Promise<void> {
  try {
    await withStore("readwrite", store => store.delete(PRIMARY));
  } catch {
    // Fall through to deleting the database outright.
  }
  await new Promise<void>((resolve, reject) => {
    const request = idb().deleteDatabase(WALLET_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("storage_failed"));
    request.onblocked = () => resolve();
  });
}

/** Encrypted per-wallet records (e.g. created voucher links). Values must already be sealed. */
export async function putRecord(key: string, sealed: string): Promise<void> {
  await withStore("readwrite", store => store.put(sealed, key), RECORDS);
}

export async function listRecords(prefix: string): Promise<{ key: string; sealed: string }[]> {
  const keys = await withStore<IDBValidKey[]>("readonly", store => store.getAllKeys(), RECORDS);
  const wanted = keys.map(String).filter(k => k.startsWith(prefix));
  const out: { key: string; sealed: string }[] = [];
  for (const key of wanted) {
    const value = await withStore<unknown>("readonly", store => store.get(key), RECORDS);
    if (typeof value === "string") out.push({ key, sealed: value });
  }
  return out;
}
