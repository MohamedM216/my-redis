import { getEntry, hasKey, setEntry } from './store.js'

// stream_key : {id: "", key1: "", ...}
// args = (key-value pairs)

export function setStream(streamArr) {
  const key = streamArr[0];
  let objectToAdd = new Object();
  objectToAdd.id = streamArr[1];
  for (let i = 2; i < streamArr.length && i + 1 < streamArr.length; i += 2) {
    objectToAdd[streamArr[i]] = streamArr[i + 1];
  }

  let entry = getEntry(key);
  if (!entry || entry === undefined) {
    setEntry(key, 'stream', objectToAdd);
  } else {
    const currentObject = entry.value;
    setEntry(key, 'stream', { ...currentObject, ...objectToAdd });
  }
  return objectToAdd.id;
}

export function getStream(key) {
  return getEntry(key).value;
}

export function hasStream(key) {
  return hasKey(key) && getEntry(key).type === 'stream';
}