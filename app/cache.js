import { REDIS_INT_MAX, REDIS_INT_MIN } from './main.js';
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

export function increment(key) {
  let entry = getEntry(key);
  if (entry === undefined) {
    setEntry(key, 'string', { value: "1", createdAt: Date.now(), px: Number.MAX_VALUE });
    return 1;
  }
  const valStr = entry.value.value;
  const val = Number(valStr);

  if (!Number.isInteger(val) || valStr.includes('.'))
    return undefined;

  const newVal = val + 1;
  if (newVal >= REDIS_INT_MAX || newVal <= REDIS_INT_MIN)
    return undefined;

  entry.value.value = String(newVal);
  setEntry(key, 'string', entry.value);
  return newVal;
}
