let store = new Map(); // The unified cache store

// Each entry: { type: 'string' | 'list' | 'stream', value: <data> }

export function getEntry(key) {
  return store.get(key);
}

export function setEntry(key, type, value) {
  store.set(key, { type: type, value: value });
}

export function deleteKey(key) {
  return store.delete(key);
}

export function hasKey(key) {
  return store.has(key);
}

export function getType(key) {
  const entry = store.get(key);
  if (!entry) return 'none';
  return entry.type;
}
