// stream_key : {id: "", key1: "", ...}
// args = (key-value pairs)
let stream = new Map();

export function setStream(streamArr) {
  const key = streamArr[0];
  let objectToAdd = new Object();
  objectToAdd.id = streamArr[1];
  for (let i = 2; i < streamArr.length && i + 1 < streamArr.length; i += 2) {
    objectToAdd[streamArr[i]] = streamArr[i + 1];
  }

  if (stream.has(key)) {
    const currentObject = stream.get();
    stream.set(key, { ...currentObject, ...objectToAdd });
  } else {
    stream.set(key, objectToAdd);
  }
  return objectToAdd.id;
}

export function getStream(key) {
  return stream.get(key);
}

export function hasStream(key) {
  return stream.has(key);
}