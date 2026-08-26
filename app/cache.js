let cache = new Map();

// TODO: handle race conditions later e.g. INCR command
// return to this later https://chat.qwen.ai/s/t_100dbeea-1c8d-42fc-97e3-dee9ab3c5a6a?fev=0.2.86
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

export function hasKey(key) {
  return cacheGet(key) === undefined ? false : true;
}