import { getEntry, getStoreClone, hasKey, setEntry } from './store.js'

let stream_time, stream_seq;

// stream_key : {id: "", key1: "", ...}
// args = (key-value pairs)

export function setStream(streamArr) {
  const key = streamArr[0];
  let objectToAdd = new Object();
  
  const valid_ret = validateStreamEntryId(streamArr[1]);
  if (valid_ret === -1) // invalid
    return -1;
  if (valid_ret === 1) {
    objectToAdd.id = doPartialAutoIdGeneration(streamArr[1]);
  } else if (valid_ret === 2) {
    objectToAdd.id = doFullAutoIdGeneration();
  } else {
    objectToAdd.id = streamArr[1];
  }

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

function getLastStreamEntry() {
  const store = getStoreClone();
  const entries = Array.from(store.values());
  let last_entry;
  for (let i = entries.length - 1; i >= 0; --i) {
    if (entries[i].type === 'stream') {
      last_entry = entries[i];
      return last_entry;
    }
  }
  return undefined; // empty stream
}

// -1: invalid, 0: default, 1: partial auto-generation, 2: full
function validateStreamEntryId(id) {
  if (id === "*")
    return 2;
  if (id === "0-0")
    return -1;
  if (id.indexOf('-') === -1)
    return -1;
  
  const id_time = Number(id.split('-')[0]);
  const id_seq = id.split('-')[1];
  
  const last_entry = getLastStreamEntry();
  if (last_entry === undefined) {
    if (id_seq === '*')
      return 1;
    return 0;
  }
  const idToCompare = last_entry.value.id;
  const last_entry_id_time = Number(idToCompare.split('-')[0]);
  const last_entry_id_seq = Number(idToCompare.split('-')[1]);
  if (id_time < last_entry_id_time)
    return -1;
  if (id_seq === '*') // partial auto-generated id
    return 1;
  if (id_time === last_entry_id_time) {
    if (!(Number(id_seq) > last_entry_id_seq))
      return -1;
  }
  return 0;
}

// return string (full id)
function doPartialAutoIdGeneration(id) { // O(1) time
  const id_time = id.split('-')[0];
  const last_entry = getLastStreamEntry();
  if (last_entry === undefined) { // empty stream
    return Number(id_time) === 0 ? id_time + "-1" : id_time + "-0";
  }
  if (Number(id_time) === Number(last_entry.value.id.split('-')[0])) {
    return id_time + "-" + String(Number(last_entry.value.id.split('-')[1]) + 1);
  }
  return Number(id_time) === 0 ? id_time + "-1" : id_time + "-0";
}

function doFullAutoIdGeneration() { // O(1) time
  const last_entry = getLastStreamEntry();
  if (last_entry === undefined) { // empty stream
    return String(Date.now()) + "-0";
  }
  const time_now = Date.now();
  if (time_now === Number(last_entry.value.id.split('-')[0])) {
    return String(time_now) + "-" + String(Number(last_entry.value.id.split('-')[1]) + 1);
  }
  return String(time_now) + "-0";
}