class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true
  })
}

if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true
  })
}

if (typeof globalThis.FileReader === 'undefined') {
  class MockFileReader {
    result: string | null = null
    onloadend: (() => void) | null = null
    onerror: (() => void) | null = null

    readAsDataURL(blob: Blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          const base64 = Buffer.from(buf).toString('base64')
          this.result = `data:${blob.type || 'image/jpeg'};base64,${base64}`
          this.onloadend?.()
        })
        .catch(() => {
          this.onerror?.()
        })
    }
  }
  Object.defineProperty(globalThis, 'FileReader', {
    value: MockFileReader,
    writable: true,
    configurable: true
  })
}

// In-memory IndexedDB polyfill for jsdom test environment
if (typeof globalThis.indexedDB === 'undefined') {
  interface StoreMeta {
    keyPath: string | null
    data: Map<string, any>
  }

  const databases = new Map<string, Map<string, StoreMeta>>()

  function createIdbPolyfill() {
    return {
      open(dbName: string, _version = 1) {
        const req: any = {
          result: null,
          error: null,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null
        }

        queueMicrotask(() => {
          try {
            let isNew = false
            if (!databases.has(dbName)) {
              databases.set(dbName, new Map<string, StoreMeta>())
              isNew = true
            }
            const dbStores = databases.get(dbName)!

            const dbInstance: any = {
              name: dbName,
              objectStoreNames: {
                contains: (name: string) => dbStores.has(name)
              },
              createObjectStore: (name: string, opts?: { keyPath?: string }) => {
                const meta: StoreMeta = {
                  keyPath: opts?.keyPath || null,
                  data: new Map<string, any>()
                }
                dbStores.set(name, meta)
                return {
                  createIndex: () => ({})
                }
              },
              transaction: (storeName: string, _mode: 'readonly' | 'readwrite' = 'readonly') => {
                const storeMeta = dbStores.get(storeName) || {
                  keyPath: 'id',
                  data: new Map<string, any>()
                }
                dbStores.set(storeName, storeMeta)

                const tx: any = {
                  error: null,
                  oncomplete: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                  onabort: null as (() => void) | null,
                  objectStore: () => ({
                    put: (value: any, explicitKey?: string) => {
                      const opReq: any = { result: null, error: null, onsuccess: null, onerror: null }
                      queueMicrotask(() => {
                        const key =
                          explicitKey ||
                          (storeMeta.keyPath && value ? String(value[storeMeta.keyPath]) : 'default')
                        storeMeta.data.set(key, value)
                        opReq.result = key
                        opReq.onsuccess?.()
                        tx.oncomplete?.()
                      })
                      return opReq
                    },
                    get: (key: string) => {
                      const opReq: any = { result: undefined, error: null, onsuccess: null, onerror: null }
                      queueMicrotask(() => {
                        opReq.result = storeMeta.data.get(String(key))
                        opReq.onsuccess?.()
                        tx.oncomplete?.()
                      })
                      return opReq
                    },
                    getAll: () => {
                      const opReq: any = { result: [], error: null, onsuccess: null, onerror: null }
                      queueMicrotask(() => {
                        opReq.result = Array.from(storeMeta.data.values())
                        opReq.onsuccess?.()
                        tx.oncomplete?.()
                      })
                      return opReq
                    },
                    delete: (key: string) => {
                      const opReq: any = { result: undefined, error: null, onsuccess: null, onerror: null }
                      queueMicrotask(() => {
                        storeMeta.data.delete(String(key))
                        opReq.onsuccess?.()
                        tx.oncomplete?.()
                      })
                      return opReq
                    },
                    clear: () => {
                      const opReq: any = { result: undefined, error: null, onsuccess: null, onerror: null }
                      queueMicrotask(() => {
                        storeMeta.data.clear()
                        opReq.onsuccess?.()
                        tx.oncomplete?.()
                      })
                      return opReq
                    }
                  })
                }
                return tx
              },
              close: () => {}
            }

            req.result = dbInstance
            if (isNew && typeof req.onupgradeneeded === 'function') {
              req.onupgradeneeded()
            }
            req.onsuccess?.()
          } catch (err) {
            req.error = err
            req.onerror?.()
          }
        })

        return req
      }
    }
  }

  Object.defineProperty(globalThis, 'indexedDB', {
    value: createIdbPolyfill(),
    writable: true,
    configurable: true
  })
}
