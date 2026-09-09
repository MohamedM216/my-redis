import { setEntry, getEntry, deleteKey } from './store.js'

// push one element or list of elements
export function push(key, elements, lpush = false) {
  let entry = getEntry(key);
  if (lpush)
    elements.reverse();

  let len = 0;
  if (!entry || entry === undefined) {
    // create new list
    len = elements.length;
    setEntry(key, 'list', elements);
  } else {
    let data = entry ? entry.value : [];
    if (lpush)
      // prepend
      data.unshift(...elements);
    else
      // append
      data.push(...elements);
    setEntry(key, 'list', data);
    len = data.length;
  }
  return len;
}

export function getRange(key, start, end) {
  const entry = getEntry(key);
  if (!entry || entry.type !== 'list') return undefined;

  const data = entry.value;
  const len = data.length;
  if (start < 0) start = Math.max(start + len, 0);
  if (end < 0) end = end + len;
  if (start >= len || start >= end) undefined;

  return data.slice(start, end + 1);
}

export function pop(key, count = 1) {
  const entry = getEntry(key);
  if (!entry || entry.type !== 'list' || entry.value.length === 0) return undefined;
  let ret = [];
  const data = entry.value;
  count = Math.min(count, data.length);
  for (let i = 0; i < count; ++i)
    ret.push(data.shift());

  if (data.length === 0)
    deleteKey(key);
  return ret;
}

export function getListLength(key) {
  const entry = getEntry(key);
  if (!entry || entry.type !== 'list') return 0;
  return entry.value.length;
}
