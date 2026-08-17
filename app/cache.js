let cache = new Map();

// TODO: handle race condition
export function cacheSet(key, val, PX = Number.MAX_VALUE) {
  cache.set(key, [val, Date.now(), Number(PX)]);
}

export function cacheGet(key) {
  let val = cache.get(key);
  if (val === undefined)
    return val;
  if ((Date.now() - (val[1] + val[2])) > 0)
    return undefined;
  return val[0];
}