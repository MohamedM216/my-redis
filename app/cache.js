import { setEntry, getEntry, deleteKey } from './store.js';

// TODO: handle race conditions later e.g. INCR command
export function cacheSet(key, val, PX = Number.MAX_VALUE) {
  setEntry(key, 'string', { value: val, createdAt: Date.now(), px: Number(PX) });
}

export function cacheGet(key) {
  let entry = getEntry(key);
  if (!entry || entry.type !== 'string')
    return undefined;
  const { value, createdAt, px } = entry.value
  if (px !== Number.MAX_VALUE && (Date.now() - (createdAt + px)) > 0) {
    deleteKey(key);
    return undefined;
  }
  return value;
}
