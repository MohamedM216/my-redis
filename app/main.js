const net = require("net");

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

function executeCommand(rawCommand, connection) {
  if (rawCommand === null || rawCommand === undefined) {
    connection.write("-ERR invalid command\r\n");
    return;
  }

  const args = Array.isArray(rawCommand) ? rawCommand : [rawCommand];

  if (args.length === 0) {
    connection.write("-ERR empty command\r\n");
    return;
  }

  const commandArg = toBuffer(args[0]);
  const commandName = commandArg.toString("utf8").toUpperCase();

  if (commandName === "PING") {
    if (args.length === 1) {
      connection.write("+PONG\r\n");
    } else {
      // Redis allows PING with a message.
      connection.write(encodeBulkString(args[1]));
    }
  } else if (commandName === "ECHO") {
    if (args.length !== 2) {
      connection.write("-ERR wrong number of arguments for 'echo' command\r\n");
      return;
    }

    connection.write(encodeBulkString(args[1]));
  } else {
    connection.write(
      `-ERR unknown command '${commandArg.toString("utf8")}'\r\n`
    );
  }
}

const server = net.createServer((connection) => {
  let buffer = Buffer.alloc(0);

  connection.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length > 0) {
      // Inline commands are useful for manual testing with telnet/netcat.
      // RESP commands from redis-cli start with "*".
      if (buffer[0] !== ASTERISK) {
        const crlfIndex = buffer.indexOf(CRLF);

        if (crlfIndex === -1) {
          break;
        }

        const line = buffer.toString("utf8", 0, crlfIndex).trim();
        buffer = buffer.subarray(crlfIndex + 2);

        if (line.length === 0) {
          continue;
        }

        const args = line.split(/\s+/).map((part) => Buffer.from(part));
        executeCommand(args, connection);
        continue;
      }

      const parsed = parseResp(buffer, 0);

      if (parsed === null) {
        // Incomplete command. Wait for more data.
        break;
      }

      if (parsed.error) {
        connection.write(`-ERR ${parsed.error}\r\n`);
        connection.end();
        return;
      }

      buffer = buffer.subarray(parsed.nextOffset);
      executeCommand(parsed.value, connection);
    }
  });

  connection.on("error", (error) => {
    console.error("Connection error:", error.message);
  });
});

server.listen(6380, "127.0.0.1");
