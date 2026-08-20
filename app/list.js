let list = new Map();

// push one element or list of elements
export function push(keyList, elements) {
  let value = list.get(keyList);
  if (value === undefined) {
    // create new list
    list.set(keyList, elements);
  } else {
    // append
    value.push(...elements);
    list.set(keyList, value);
  }
  return list.get(keyList).length;
}

export function getRange(keyList, start, end) {
  const data = list.get(keyList);
  if (data === undefined) return undefined;

  const len = data.length;
  if (start < 0) start = Math.max(start + len, 0);
  if (end < 0) end = end + len;
  if (start >= len || start >= end) undefined;

  return data.slice(start, end + 1);
}