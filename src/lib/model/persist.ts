const DB = "yujian-models"
const STORE = "files"
const KEY = "current"

export type StoredModelFile = { name: string; buffer: ArrayBuffer }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** 模型原文件存 IndexedDB（几十 MB 的 STEP 放不进 localStorage），刷新后重新解析。 */
export async function saveModelFile(file: StoredModelFile): Promise<void> {
  if (typeof indexedDB === "undefined") return
  await withStore("readwrite", (s) => s.put(file, KEY))
}

export async function loadModelFile(): Promise<StoredModelFile | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    return ((await withStore("readonly", (s) => s.get(KEY))) as StoredModelFile | undefined) ?? null
  } catch {
    return null
  }
}

export async function clearModelFile(): Promise<void> {
  if (typeof indexedDB === "undefined") return
  await withStore("readwrite", (s) => s.delete(KEY))
}
