import { getEntry, getStoreClone, hasKey, setEntry } from './store.js'

// stream_key : {id: "", key1: "", ...}
// args = (key-value pairs)

export function setStream(streamArr) {
  const key = streamArr[0];
  let objectToAdd = new Object();
  objectToAdd.id = streamArr[1];

  if (!validateStreamEntryId(streamArr[1]))
    return -1;

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

function validateStreamEntryId(id) {
  if (id === "0-0")
    return false;
  const store = getStoreClone();
  if (id.indexOf('-') === -1)
    return false;
  const id_time = id.split('-')[0];
  const id_seq = id.split('-')[1];
  const entries = store.values;
  let last_entry = {};
  for (let i = entries.length - 1; i >= 0; --i) {
    if (entries[i].type === 'stream') {
      last_entry = entries[i];
      break;
    }
  }
  const idToCompare = last_entry.value.id;
  const last_entry_id_time = idToCompare.split('-')[0];
  const last_entry_id_seq = idToCompare.split('-')[1];
  if (id_time < last_entry_id_time)
    return false;
  if (id_time === last_entry_id_time) {
    if (!(id_seq > last_entry_id_seq))
      return false;
  }
  return true;
}