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