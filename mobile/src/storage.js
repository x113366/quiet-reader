const DB = "quiet-reader-mobile-v1";
let connection;
export async function database() {
  if (connection) return connection;
  connection = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      for (const name of ["accounts", "assets", "meta"])
        r.result.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return connection;
}
export async function transact(store, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let request;
    try {
      request = action(tx.objectStore(store));
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () =>
      reject(tx.error || Error("本机存储失败，请导出未同步的书籍并释放空间"));
  });
}
export const get = (store, key) =>
  transact(store, "readonly", (s) => s.get(key));
export const put = (store, key, value) =>
  transact(store, "readwrite", (s) => s.put(value, key));
export const remove = (store, key) =>
  transact(store, "readwrite", (s) => s.delete(key));
export const assetKey = (account, key) => `${account}:${key}`;
export const empty = () => ({
  entries: {},
  conflicts: {},
  history: [],
  device: crypto.randomUUID().replaceAll("-", ""),
  lastSync: null,
});
export async function load(account) {
  return (await get("accounts", account)) || empty();
}
export const save = (account, state) => put("accounts", account, state);
