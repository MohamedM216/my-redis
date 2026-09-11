import { getEntry, hasKey, setEntry } from './store.js'

// stream_key : [ {id: "", key1: val1, ...}, {id: "", key1: val1, key2: val2, ...}, ...]

export function setStream(streamArr) {
  const key = streamArr[0];
  let entry = new Object();
  
  const valid_ret = validateStreamEntryId(key, streamArr[1]);
  if (valid_ret === -1) // invalid
    return -1;
  if (valid_ret === 1) {
    entry.id = doPartialAutoIdGeneration(key, streamArr[1]);
  } else if (valid_ret === 2) {
    entry.id = doFullAutoIdGeneration(key);
  } else {
    entry.id = streamArr[1];
  }

  for (let i = 2; i < streamArr.length && i + 1 < streamArr.length; i += 2) {
    entry[streamArr[i]] = streamArr[i + 1];
  }

  let streamBlock = getEntry(key);
  if (!streamBlock || streamBlock === undefined) {
    setEntry(key, 'stream', [entry]);
  } else {
    streamBlock.value.push(entry);
  }
  return entry.id;
}

export function getStream(key) {
  return getEntry(key).value;
}

export function hasStream(key) {
  return hasKey(key) && getEntry(key).type === 'stream';
}

// -1: invalid, 0: default, 1: partial auto-generation, 2: full
function validateStreamEntryId(key, id) {
  if (id === "*")
    return 2;
  if (id === "0-0")
    return -1;
  if (id.indexOf('-') === -1)
    return -1;
  
  const id_time = Number(id.split('-')[0]);
  const id_seq = id.split('-')[1];
  
  const streamBlock = getEntry(key);
  if (!streamBlock || streamBlock === undefined) {
    if (id_seq === '*')
      return 1;
    return 0;
  }
  const entries = streamBlock.value;
  const idToCompare = entries[entries.length - 1].id;
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
function doPartialAutoIdGeneration(key, id) { // O(1) time
  const id_time = id.split('-')[0];
  const streamBlock = getEntry(key);
  if (!streamBlock || streamBlock === undefined) {  // empty stream
    return Number(id_time) === 0 ? id_time + "-1" : id_time + "-0";
  }
  const entries = streamBlock.value;
  let lastId = entries[entries.length - 1].id;
  if (Number(id_time) === Number(lastId.split('-')[0])) {
    return id_time + "-" + String(Number(lastId.split('-')[1]) + 1);
  }
  return Number(id_time) === 0 ? id_time + "-1" : id_time + "-0";
}

function doFullAutoIdGeneration(key) { // O(1) time
  const streamBlock = getEntry(key);
  if (!streamBlock || streamBlock === undefined) {  // empty stream
    return String(Date.now()) + "-0";
  }
  const entries = streamBlock.value;
  let lastId = entries[entries.length - 1].id;
  const time_now = Date.now();
  if (time_now === Number(lastId.split('-')[0])) {
    return String(time_now) + "-" + String(Number(lastId.split('-')[1]) + 1);
  }
  return String(time_now) + "-0";
}