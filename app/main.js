import net from "net";
import { cacheSet, cacheGet } from "./cache.js";
import { getRange, pop, push } from "./list.js"

const CRLF = Buffer.from("\r\n");
const CR = 13;
const LF = 10;
const ASTERISK = 42; // "*"

function parseNumber(buffer, start, end) {
  const text = buffer.toString("ascii", start, end);

  if (!/^-?\d+$/.test(text)) {
    return null;
  }

  return Number(text);
}

function parseResp(buffer, offset = 0) {
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

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return Buffer.alloc(0);
  }

  return Buffer.from(String(value));
}

function encodeBulkString(value) {
  const data = toBuffer(value);

  return Buffer.concat([
    Buffer.from(`$${data.length}\r\n`),
    data,
    CRLF,
  ]);
}

// @param arr[]: array of strings
// return array of bulk string
function encodeArray(arr) {
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

function executeCommand(rawCommand, connection, clientInfo) {
  if (rawCommand === null || rawCommand === undefined) {
    console.log(`[EXEC][${clientInfo}] Error: invalid command`);
    connection.write("-ERR invalid command\r\n");
    return;
  }

  const args = Array.isArray(rawCommand) ? rawCommand : [rawCommand];

  if (args.length === 0) {
    console.log(`[EXEC][${clientInfo}] Error: empty command`);
    connection.write("-ERR empty command\r\n");
    return;
  }

  const commandArg = toBuffer(args[0]);
  const commandName = commandArg.toString("utf8").toUpperCase();
  console.log(`[EXEC][${clientInfo}] Command: ${commandName} | Args: ${args.length - 1}`);

  if (commandName === "PING") {
    if (args.length === 1) {
      console.log(`[-->][${clientInfo}] Response: +PONG`);
      connection.write("+PONG\r\n");
    } else {
      // Redis allows PING with a message.
      console.log(`[-->][${clientInfo}] Response: Bulk string (PING with message)`);
      connection.write(encodeBulkString(args[1]));
    }
  } else if (commandName === "ECHO") {
    if (args.length !== 2) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'echo' command\r\n");
      return;
    }
    const echoVal = args[1].toString('utf8');
    console.log(`[-->][${clientInfo}] Response: Bulk string ("${echoVal.substring(0, 20)}${echoVal.length > 20 ? '...' : ''}")`);
    connection.write(encodeBulkString(args[1]));
  } else if (commandName === "SET") {
    if (!(args.length === 3 || args.length === 5)) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'set' command\r\n");
      return;
    }
    cacheSet(args[1].toString('utf8'), args[2].toString('utf8'), args.length === 5 ? Number(args[4].toString('utf8')) : Number.MAX_VALUE);
    console.log(`[-->][${clientInfo}] SET key: ${args[1].toString('utf8')} to value: ${args[2].toString('utf8')} with PX: ${args.length === 5 ? Number(args[4].toString('utf8')) : null}`);
    console.log(`[-->][${clientInfo}] Response: +OK`);
    connection.write("+OK\r\n");
  } else if (commandName === "GET") {
    if (args.length != 2) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'get' command\r\n");
      return;
    }
    let value = cacheGet(args[1].toString('utf8'));
    if (value === undefined) {
      console.log(`[-->][${clientInfo}] Response: NULL Bulk String, no value associated with key ${args[1].toString('utf8')}`);
      connection.write("$-1\r\n");
      return;
    }
    console.log(`[-->][${clientInfo}] Response: Bulk String, return value: ${value.toString('utf8')})`);
    connection.write(encodeBulkString(value));
  } else if (commandName === "RPUSH") {
    if (args.length < 3) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'rpush' command\r\n");
      return;
    }
    let elements = args.slice(2).map(x => x.toString('utf8'));
    elements = elements.length === 1 ? [elements] : elements;
    let ret = push(args[1].toString('utf8'), elements);
    console.log(`[-->][${clientInfo}] RPUSH: push elements ${elements}`);
    console.log(`[-->][${clientInfo}] Response: RESP Integer, length of list: ${ret})`);
    connection.write(`:${ret}\r\n`);
  } else if (commandName === "LRANGE") {
    if (args.length !== 4) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'lrange' command\r\n");
      return;
    }
    const key = args[1].toString('utf8');
    const start = Number(args[2].toString('utf8'));
    const end = Number(args[3].toString('utf8'));

    const ret = getRange(key, start, end);
    console.log(`[-->][${clientInfo}] LRANGE: key ${key} in range ${start}, ${end}`);
    if (ret === undefined) {
      console.log(`[-->][${clientInfo}] Response: RESP Empty Array`);
      connection.write("*0\r\n");
      return;
    }
    console.log(`[-->][${clientInfo}] Response: RESP Array`);
    connection.write(encodeArray(ret));
  } else if (commandName === "LPUSH") {
    if (args.length < 3) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'lpush' command\r\n");
      return;
    }
    let elements = args.slice(2).map(x => x.toString('utf8'));
    elements = elements.length === 1 ? [elements] : elements;
    let ret = push(args[1].toString('utf8'), elements, true);
    console.log(`[-->][${clientInfo}] LPUSH: push elements ${elements}`);
    console.log(`[-->][${clientInfo}] Response: RESP Integer, length of list: ${ret})`);
    connection.write(`:${ret}\r\n`);
  } else if (commandName === "LPOP") {
    if (args.length < 2) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'lpop' command\r\n");
      return;
    }
    let count = 1;
    if (args.length === 3)
      count = Number(args[2].toString('utf8'));
    const ret = pop(args[1].toString('utf8'), count);
    if (ret === undefined) {
      console.log(`[-->][${clientInfo}] Response: NULL Bulk String, no value associated with key ${args[1].toString('utf8')}`);
      connection.write("$-1\r\n");
      return;
    }
    console.log(`[-->][${clientInfo}] LPOP: pop first ${count} elements`);
    console.log(`[-->][${clientInfo}] Response: RESP Array`);
    connection.write(encodeArray(ret));
  } else {
    console.log(`[-->][${clientInfo}] Response: Error (unknown command)`);
    connection.write(
      `-ERR unknown command '${commandArg.toString("utf8")}'\r\n`
    );
  }
}

const server = net.createServer((connection) => {
  const clientIp = connection.remoteAddress;
  const clientPort = connection.remotePort;
  const clientInfo = `${clientIp}:${clientPort}`;
  console.log(`\n[+] Client connected: ${clientInfo}`);

  let buffer = Buffer.alloc(0);

  connection.on("data", (chunk) => {
    console.log(`[<--][${clientInfo}] Received ${chunk.length} bytes`);
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length > 0) {
      // Inline commands are useful for manual testing with telnet/netcat.
      // RESP commands from redis-cli start with "*".
      if (buffer[0] !== ASTERISK) {
        const crlfIndex = buffer.indexOf(CRLF);

        if (crlfIndex === -1) {
          console.log(`[...][${clientInfo}] Waiting for more data (inline)...`);
          break;
        }

        const line = buffer.toString("utf8", 0, crlfIndex).trim();
        buffer = buffer.subarray(crlfIndex + 2);

        if (line.length === 0) continue;

        console.log(`[PARSER][${clientInfo}] Parsed inline command: "${line}"`);

        const args = line.split(/\s+/).map((part) => Buffer.from(part));
        executeCommand(args, connection, clientInfo);
        continue;
      }

      const parsed = parseResp(buffer, 0);

      if (parsed === null) {
        console.log(`[...][${clientInfo}] Waiting for more data (RESP incomplete)...`);
        break;
      }

      if (parsed.error) {
        console.log(`[!][${clientInfo}] Parser error: ${parsed.error}`);
        connection.write(`-ERR ${parsed.error}\r\n`);
        connection.end();
        return;
      }
      const readableParsed = Array.isArray(parsed.value) 
        ? parsed.value.map(v => v ? v.toString() : v) 
        : parsed.value;
      console.log(`[PARSER][${clientInfo}] Successfully parsed RESP:`, readableParsed);

      buffer = buffer.subarray(parsed.nextOffset);
      executeCommand(parsed.value, connection, clientInfo);
    }
  });

  connection.on("end", () => {
    console.log(`[-][${clientInfo}] Client disconnected`);
  });

  connection.on("error", (error) => {
    console.error("Connection error:", error.message);
  });
});

server.listen(6380, "127.0.0.1", () => {
  console.log("[*] Server listening on 127.0.0.1:6380");
});
