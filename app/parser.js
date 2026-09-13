export const CRLF = Buffer.from("\r\n");
const CR = 13;
const LF = 10;
export const ASTERISK = 42; // "*"

function parseNumber(buffer, start, end) {
  const text = buffer.toString("ascii", start, end);

  if (!/^-?\d+$/.test(text)) {
    return null;
  }

  return Number(text);
}

export function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) {
    return null;
  }

  const type = String.fromCharCode(buffer[offset]);
  const crlfIndex = buffer.indexOf(CRLF, offset + 1);

  // Simple string: +OK\r\n
  // Simple error: -ERR ...\r\n
  // Integer: :123\r\n
  if (type === "+" || type === "-" || type === ":") {
    if (crlfIndex === -1) {
      return null;
    }

    const text = buffer.toString("utf8", offset + 1, crlfIndex);
    const value = type === ":" ? Number(text) : text;

    return {
      value,
      nextOffset: crlfIndex + 2,
    };
  }

  // Bulk string: $3\r\nhey\r\n
  if (type === "$") {
    if (crlfIndex === -1) {
      return null;
    }

    const length = parseNumber(buffer, offset + 1, crlfIndex);

    if (length === null || length < -1) {
      return {
        error: "invalid bulk string length",
      };
    }

    // Null bulk string: $-1\r\n
    if (length === -1) {
      return {
        value: null,
        nextOffset: crlfIndex + 2,
      };
    }

    const dataStart = crlfIndex + 2;
    const dataEnd = dataStart + length;

    // Need data + final CRLF.
    if (buffer.length < dataEnd + 2) {
      return null;
    }

    if (buffer[dataEnd] !== CR || buffer[dataEnd + 1] !== LF) {
      return {
        error: "missing CRLF after bulk string",
      };
    }

    // Copy the data so it is not tied to the old buffer.
    const data = Buffer.from(buffer.subarray(dataStart, dataEnd));

    return {
      value: data,
      nextOffset: dataEnd + 2,
    };
  }

  // Array: *2\r\n...
  if (type === "*") {
    if (crlfIndex === -1) {
      return null;
    }

    const count = parseNumber(buffer, offset + 1, crlfIndex);

    if (count === null || count < -1) {
      return {
        error: "invalid array length",
      };
    }

    // Null array: *-1\r\n
    if (count === -1) {
      return {
        value: null,
        nextOffset: crlfIndex + 2,
      };
    }

    let nextOffset = crlfIndex + 2;
    const items = [];

    for (let i = 0; i < count; i += 1) {
      const parsed = parseResp(buffer, nextOffset);

      if (parsed === null) {
        return null;
      }

      if (parsed.error) {
        return parsed;
      }

      items.push(parsed.value);
      nextOffset = parsed.nextOffset;
    }

    return {
      value: items,
      nextOffset,
    };
  }

  return {
    error: `unsupported RESP type: ${type}`,
  };
}
