import { getEntry, hasKey, setEntry } from './store.js'

// stream_key : [["id", ["key a", "val a", "key b", "val b",...]], ["id", []], ["id", []],...]

export function setStream(streamArr) {
  const key = streamArr[0];
  let entry = [];
  
  const valid_ret = validateStreamEntryId(key, streamArr[1]);
  if (valid_ret === -1) // invalid
    return -1;
  if (valid_ret === 1) {
    entry.push(doPartialAutoIdGeneration(key, streamArr[1]));
  } else if (valid_ret === 2) {
    entry.push(doFullAutoIdGeneration(key));
  } else {
    entry.push(streamArr[1]);
  }

  let keyValuePairs = [];
  for (let i = 2; i < streamArr.length; i++) {
    keyValuePairs.push(streamArr[i]);
  }
  entry.push(keyValuePairs);

  let streamBlock = getEntry(key);
  if (!streamBlock || streamBlock === undefined) {
    setEntry(key, 'stream', [entry]);
  } else {
    streamBlock.value.push(entry);
  }
  return entry[0];
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
  const idToCompare = entries[entries.length - 1][0];
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
  let lastId = entries[entries.length - 1][0];
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
  let lastId = entries[entries.length - 1][0];
  const time_now = Date.now();
  if (time_now === Number(lastId.split('-')[0])) {
    return String(time_now) + "-" + String(Number(lastId.split('-')[1]) + 1);
  }
  return String(time_now) + "-0";
}

export function getStreamRange(key, startId, endId) {
  const streamBlock = getEntry(key);
  if (!streamBlock || streamBlock === undefined || streamBlock.type !== "stream") {
    return undefined;
  }
  const entries = streamBlock.value;
  startId = startId === "-" ? entries[0][0] : startId;
  endId = endId === "+" ? entries[entries.length - 1][0] : endId;
  let inRange = false;
  let result = [];  // [["id", ["key a", "val a", "key b", "val b",...]], ["id", []], ["id", []],...]
  for (const entry of entries) {
    if (entry[0] === startId) {
      result.push(entry);
      inRange = true;
      continue;
    }
    if (inRange) {
      result.push(entry);
    }
    if (entry[0] === endId) {
      break;
    }
  }
  return result;
}

export function getStreamXRead(key, id) {
  const streamBlock = getEntry(key);
  if (!streamBlock || streamBlock === undefined || streamBlock.type !== "stream") {
    return [];
  }
  const entries = streamBlock.value;
  let inRange = false;
  let result = [];  // [["id", ["key a", "val a", "key b", "val b",...]], ["id", []], ["id", []],...]
  for (const entry of entries) {
    if (entry[0] === id) {
      inRange = true;
      continue;
    }
    if (inRange) {
      result.push(entry);
    }
  }
  return result;
}