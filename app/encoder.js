export function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return Buffer.alloc(0);
  }

  return Buffer.from(String(value));
}

export function encodeBulkString(value) {
  const data = toBuffer(value);

  return Buffer.concat([
    Buffer.from(`$${data.length}\r\n`),
    data,
    CRLF,
  ]);
}

// @param arr[]: array of strings
// return array of bulk string
export function encodeArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return Buffer.from("*0\r\n");
  }

  let respString = `*${arr.length}\r\n`;
  for (const item of arr) {
    const str = String(item);
    // Use Buffer.byteLength to correctly count bytes for multi-byte UTF-8 characters
    const byteLength = Buffer.byteLength(str, 'utf8');
    respString += `$${byteLength}\r\n${str}\r\n`;
  }

  return Buffer.from(respString, 'utf8');
}

export function encodeBlpopResponse(key, element) {
  const keyStr = String(key);
  const elStr = String(element);
  const keyLen = Buffer.byteLength(keyStr, 'utf8');
  const elLen = Buffer.byteLength(elStr, 'utf8');
  const resp = `*2\r\n$${keyLen}\r\n${keyStr}\r\n$${elLen}\r\n${elStr}\r\n`;
  return resp;
}

export function encodeStreamEntries(entries) {
  if (!entries || entries.length === 0) {
    return Buffer.from("*0\r\n");
  }

  let resp = `*${entries.length}\r\n`;

  for (const entry of entries) {
    const id = String(entry[0]);
    const fields = entry[1]; // Array of strings
    
    // Each entry is an inner array of exactly 2 elements: [ID, [fields...]]
    resp += `*2\r\n`;
    
    // 1. Encode ID as a Bulk String
    resp += `$${Buffer.byteLength(id, 'utf8')}\r\n${id}\r\n`;
    
    // 2. Encode fields as an Array of Bulk Strings
    resp += `*${fields.length}\r\n`;
    for (const field of fields) {
      const fStr = String(field);
      resp += `$${Buffer.byteLength(fStr, 'utf8')}\r\n${fStr}\r\n`;
    }
  }
  
  return Buffer.from(resp, 'utf8');
}

export function encodeXReadResponse(streamResults) {
  // streamResults is an array of [key, entries] pairs
  let resp = `*${streamResults.length}\r\n`;
  
  for (const [key, entries] of streamResults) {
    // Each stream result is a 2-element array: [stream_key, entries_array]
    resp += `*2\r\n`;
    
    // 1. Encode the stream key as a Bulk String
    const keyStr = String(key);
    resp += `$${Buffer.byteLength(keyStr, 'utf8')}\r\n${keyStr}\r\n`;
    
    // 2. Encode the entries array
    resp += `*${entries.length}\r\n`;
    for (const entry of entries) {
      const id = String(entry[0]);
      const fields = entry[1]; 
      
      // Each entry is a 2-element array: [id, fields_array]
      resp += `*2\r\n`;
      resp += `$${Buffer.byteLength(id, 'utf8')}\r\n${id}\r\n`;
      
      resp += `*${fields.length}\r\n`;
      for (const field of fields) {
        const fStr = String(field);
        resp += `$${Buffer.byteLength(fStr, 'utf8')}\r\n${fStr}\r\n`;
      }
    }
  }
  
  return Buffer.from(resp, 'utf8');
}
