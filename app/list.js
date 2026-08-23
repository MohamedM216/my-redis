let list = new Map();

// push one element or list of elements
export function push(key, elements, lpush = false) {
  let value = list.get(key);
  if (lpush)
    elements.reverse();
  if (value === undefined) {
    // create new list
    list.set(key, elements);
  } else {
    if (lpush)
      // prepend
      value.unshift(...elements);
    else
      // append
      value.push(...elements);
    list.set(key, value);
  }
  return list.get(key).length;
}

export function getRange(key, start, end) {
  const data = list.get(key);
  if (data === undefined || data.length === 0) return undefined;

  const len = data.length;
  if (start < 0) start = Math.max(start + len, 0);
  if (end < 0) end = end + len;
  if (start >= len || start >= end) undefined;

  return data.slice(start, end + 1);
}

export function pop(key, count = 1) {
  const data = list.get(key);
  if (data === undefined || data.length === 0) return undefined;
  let ret = [];
  count = Math.min(count, data.length);
  for (let i = 0; i < count; ++i)
    ret.push(data.shift());
  return ret;
}