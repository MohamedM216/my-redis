let cache = new Map();

export function cacheSet(key, val) {
  cache.set(key, val);
}

export function cacheGet(key) {
  return cache.get(key);
}