import net from "net";
import { cacheSet, cacheGet, increment } from "./cache.js";
import { getRange, pop, push, getListLength } from "./list.js"
import { setStream, getStreamRange, getStreamXRead } from "./stream.js"
import { getType } from "./store.js";
import { parseResp, ASTERISK, CRLF } from "./parser.js"
import { toBuffer, encodeBulkString, encodeArray, encodeBlpopResponse, encodeStreamEntries, encodeXReadResponse } from "./encoder.js"
import { Command } from "./commands.js";

export const REDIS_INT_MAX = 9223372036854775807;  // 2^63 - 1 (Redis uses 64-bit signed ints)
export const REDIS_INT_MIN = -9223372036854775808; // -2^63

// Global state for blocking commands
const blockedQueues = new Map(); // Maps list key -> Array of waiting clients
let nextBlockId = 1;

function unblockClient(clientState) {
  if (clientState.timer) {
    clearTimeout(clientState.timer);
    clientState.timer = null;
  }
  const queue = blockedQueues.get(clientState.key);
  if (queue) {
    const idx = queue.findIndex(c => c.id === clientState.id);
    if (idx !== -1) queue.splice(idx, 1);
    if (queue.length === 0) blockedQueues.delete(clientState.key);
  }
  if (clientState.connection) {
    clientState.connection.blockState = null;
  }
}

// A fake connection that captures writes instead of sending them
function createResponseCapture() {
  const responses = [];
  return {
    responses,
    write(data) {
      responses.push(data);
    },
    end() {},
    destroy() {},
    blockState: null
  };
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

  if (connection.inTransaction && commandName !== "MULTI" && commandName !== "EXEC" && commandName !== "DISCARD") {
    connection.queuedCommands.push(args);
    console.log(`[-->][${clientInfo}] QUEUED command: ${commandName} (queue size: ${connection.queuedCommands.length})`);
    connection.write("+QUEUED\r\n");
    return;
  }

  console.log(`[EXEC][${clientInfo}] Command: ${commandName} | Args: ${args.length - 1}`);

  if (commandName === Command.PING) {
    if (args.length === 1) {
      console.log(`[-->][${clientInfo}] Response: +PONG`);
      connection.write("+PONG\r\n");
    } else {
      // Redis allows PING with a message.
      console.log(`[-->][${clientInfo}] Response: Bulk string (PING with message)`);
      connection.write(encodeBulkString(args[1]));
    }
  } else if (commandName === Command.ECHO) {
    if (args.length !== 2) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'echo' command\r\n");
      return;
    }
    const echoVal = args[1].toString('utf8');
    console.log(`[-->][${clientInfo}] Response: Bulk string ("${echoVal.substring(0, 20)}${echoVal.length > 20 ? '...' : ''}")`);
    connection.write(encodeBulkString(args[1]));
  } else if (commandName === Command.SET) {
    if (!(args.length === 3 || args.length === 5)) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'set' command\r\n");
      return;
    }
    cacheSet(args[1].toString('utf8'), args[2].toString('utf8'), args.length === 5 ? Number(args[4].toString('utf8')) : Number.MAX_VALUE);
    console.log(`[-->][${clientInfo}] SET key: ${args[1].toString('utf8')} to value: ${args[2].toString('utf8')} with PX: ${args.length === 5 ? Number(args[4].toString('utf8')) : null}`);
    console.log(`[-->][${clientInfo}] Response: +OK`);
    connection.write("+OK\r\n");
  } else if (commandName === Command.GET) {
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
  } else if (commandName === Command.RPUSH) {
    if (args.length < 3) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'rpush' command\r\n");
      return;
    }
    let elements = args.slice(2).map(x => x.toString('utf8'));
    elements = elements.length === 1 ? [elements] : elements;
    let elementsToAdd = [...elements];

    const key = args[1].toString('utf8');
    let queue = blockedQueues.get(key);

    if (queue && queue.length > 0) {
      while (queue.length > 0 && elementsToAdd.length > 0) {
        const clientState = queue.shift(); 
        const element = elementsToAdd.shift();
        
        unblockClient(clientState); // removes them from ALL queues and clears timer
        console.log(`[-->][${clientState.clientInfo}] BLPOP unblocked with element: ${element}`);
        clientState.connection.write(encodeBlpopResponse(key, element));
      }
    }
    if (elementsToAdd.length > 0) {
      let ret = push(args[1].toString('utf8'), elementsToAdd);
      console.log(`[-->][${clientInfo}] RPUSH: push elements [${elementsToAdd.join(', ')}]`);
      console.log(`[-->][${clientInfo}] Response: RESP Integer, length of list: ${ret})`);
      connection.write(`:${ret}\r\n`);
    } else {
      console.log(`[-->][${clientInfo}] RPUSH: all elements consumed by blocked clients`);
      connection.write(`:0\r\n`);
    }
  } else if (commandName === Command.LRANGE) {
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
  } else if (commandName === Command.LPUSH) {
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
  } else if (commandName === Command.LPOP) {
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
  } else if (commandName === Command.BLPOP) {
    if (args.length < 3) {
      connection.write("-ERR wrong number of arguments for 'blpop' command\r\n");
      return;
    }
    
    const timeoutStr = args[args.length - 1].toString('utf8');
    const timeout = Number(timeoutStr);
    if (isNaN(timeout) || timeout < 0) {
      connection.write("-ERR timeout is not a float or out of range\r\n");
      return;
    }
    const key = args[1].toString('utf8');
    const len = getListLength(key);
    if (len > 0) {
      const popped = pop(key);
      if (popped && popped.length > 0) {
        connection.write(encodeBlpopResponse(key, popped[0]));
        return;
      }
    }
    
    // if no elements found, block the client
    const blockId = nextBlockId++;
    const clientState = {
      id: blockId,
      connection,
      clientInfo,
      key,
      timer: null
    };
    
    // Set timeout if > 0. If 0, it blocks indefinitely (no timer set)
    if (timeout > 0) {
      clientState.timer = setTimeout(() => {
        unblockClient(clientState);
        clientState.connection.write("*-1\r\n"); // Null array on timeout
        console.log(`[-->][${clientInfo}] BLPOP timeout reached`);
      }, timeout * 1000);
    }
    
    // Add client to the queue for the requested key
    if (!blockedQueues.has(key)) blockedQueues.set(key, []);
    blockedQueues.get(key).push(clientState);
    
    // Attach state to connection so we can clean up if they disconnect
    connection.blockState = clientState;
    console.log(`[-->][${clientInfo}] BLPOP blocking on keys: ${key} with timeout ${timeout}`);
  } else if (commandName === Command.TYPE) {
    if (args.length !== 2) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'type' command\r\n");
      return;
    }
    const key = args[1].toString('utf8');
    console.log(`[-->][${clientInfo}] TYPE of value of key ${key}`);
    const type = getType(key);
    console.log(`[-->][${clientInfo}] Response: Simple String '${type}'`);
    connection.write(`+${type}\r\n`);
  } else if (commandName === Command.XADD) {
    if (args.length < 5) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'stream' command\r\n");
      return;
    }
    const stream = args.slice(1).map(x => x.toString('utf8'));
    const id = setStream(stream);
    if (id === -1) {
      console.log(`[-->][${clientInfo}] Response: Error invalid ID '${id}'`);
      connection.write("-ERR The ID specified in XADD is equal or smaller than the target stream top item\r\n");
      return;
    }
    console.log(`[-->][${clientInfo}] Response: Bulk String '${id}'`);
    connection.write(encodeBulkString(id));
  } else if (commandName === Command.XRANGE) {
    if (args.length !== 4) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'xrange' command\r\n");
      return;
    }
    const range = getStreamRange(args[1].toString('utf8'), args[2].toString('utf8'), args[3].toString('utf8'));
    if (range === undefined) {
      console.log(`[-->][${clientInfo}] Response: NULL Array, no value associated with key ${args[1].toString('utf8')}`);
      connection.write("*-1\r\n");
      return;
    }
    console.log(`[-->][${clientInfo}] Response: RESP array of arrays.`);
    connection.write(encodeStreamEntries(range));
  } else if (commandName === Command.XREAD) {
    // find the STREAMS and BLOCK keywords dynamically
    let streamsIndex = -1;
    let blockIndex = -1;
    let timeout = 0;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i].toString('utf8').toUpperCase();
      if (arg === 'STREAMS') {
        streamsIndex = i;
      } else if (arg === 'BLOCK') {
        blockIndex = i;
      }
    }
    if (streamsIndex === -1) {
      connection.write("-ERR syntax error\r\n");
      return;
    }

    if (blockIndex !== -1) {
      if (blockIndex + 1 >= streamsIndex) {
        connection.write("-ERR syntax error\r\n");
        return;
      }
      timeout = Number(args[blockIndex + 1].toString('utf8'));
      if (isNaN(timeout) || timeout < 0) {
        connection.write("-ERR timeout is not a float or out of range\r\n");
        return;
      }
    }

    const streamArgs = args.slice(streamsIndex + 1).map(x => x.toString('utf8'));
    if (streamArgs.length === 0 || streamArgs.length % 2 !== 0) {
      connection.write("-ERR Unbalanced 'xread' list of streams: for each stream key an ID must be specified\r\n");
      return;
    }
    
    const half = streamArgs.length / 2;
    const keys = streamArgs.slice(0, half);
    const ids = streamArgs.slice(half);
    
    let finalResult = [];
    for (let i = 0; i < keys.length; i++) {
      const entries = getStreamXRead(keys[i], ids[i]);
      if (entries && entries.length > 0) {
        finalResult.push([keys[i], entries]);
      }
    }

    if (finalResult.length > 0) {
      connection.write(encodeXReadResponse(finalResult));
      return;
    }

    if (blockIndex === -1) {
      connection.write("*-1\r\n");
      return;
    }
     
    // BLOCK the client
    const key = keys[0];
    const blockId = nextBlockId++;
    const clientState = {
      id: blockId,
      connection,
      clientInfo,
      key,
      timer: null
    };
    
    if (timeout > 0) {
      clientState.timer = setTimeout(() => {
        unblockClient(clientState);
        clientState.connection.write("*-1\r\n");
        console.log(`[-->][${clientInfo}] XREAD timeout reached`);
      }, timeout * 1000);
    }
    
    if (!blockedQueues.has(key)) blockedQueues.set(key, []);
    blockedQueues.get(key).push(clientState);
    connection.blockState = clientState;
    console.log(`[-->][${clientInfo}] XREAD blocking on key: ${key} with timeout ${timeout}`);
  } else if (commandName === Command.INCR) {
    if (args.length !== 2) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'incr' command\r\n");
      return;
    }
    const key = args[1].toString('utf8');
    const ret = increment(key);
    if (ret === undefined) {
      connection.write("-ERR value is not an integer or out of range\r\n");
      return;
    }
    console.log(`[-->][${clientInfo}] Response: RESP Integer, value of key: ${key})`);
    connection.write(`:${ret}\r\n`);
  } else if (commandName === Command.MULTI) {
    // MULTI must make the connection open
    // then close it with EXEC
    if (args.length !== 1) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'multi' command\r\n");
      return;
    }
    if (connection.inTransaction) {
      console.log(`[-->][${clientInfo}] Response: Error (MULTI calls can not be nested)`);
      connection.write("-ERR MULTI calls can not be nested\r\n");
      return;
    }
    connection.inTransaction = true;
    connection.queuedCommands = [];
    console.log(`[-->][${clientInfo}] Response: simple string (MULTI started)`);
    connection.write("+OK\r\n");
  } else if (commandName === Command.EXEC) {
    if (args.length !== 1) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'exec' command\r\n");
      return;
    }
    if (!connection.inTransaction) {
      console.log(`[-->][${clientInfo}] Response: Error (EXEC without MULTI)`);
      connection.write("-ERR EXEC without MULTI\r\n");
      return;
    }
    const queued = connection.queuedCommands;
    connection.inTransaction = false; // to prevent queuing commands when executed in EXEC
    if (queued.length === 0) {
      console.log(`[-->][${clientInfo}] Response: Empty array`);
      connection.write("*0\r\n");
      return;
    }

    const capturedResponses = [];
    for (const queuedArgs of queued) {
      const mock = createResponseCapture();
      executeCommand(queuedArgs, mock, clientInfo);
      // Each command should have produced exactly one write
      if (mock.responses.length > 0) {
        capturedResponses.push(mock.responses[0]);
      }
    }

    let resp = `*${capturedResponses.length}\r\n`;
    for (const r of capturedResponses) {
      resp += r.toString();
    }

    console.log(`[-->][${clientInfo}] Response: EXEC RESP Array with ${capturedResponses.length} results`);
    connection.write(resp);
  } else if (commandName === Command.DISCARD) {
    if (args.length !== 1) {
      console.log(`[-->][${clientInfo}] Response: Error (wrong number of args)`);
      connection.write("-ERR wrong number of arguments for 'discard' command\r\n");
      return;
    }
    if (!connection.inTransaction) {
      console.log(`[-->][${clientInfo}] Response: Error (DISCARD without MULTI)`);
      connection.write("-ERR DISCARD without MULTI\r\n");
      return;
    }
    connection.inTransaction = false;
    connection.queuedCommands = [];
    console.log(`[-->][${clientInfo}] Response: simple string (transaction aborted)`);
    connection.write("+OK\r\n");
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

  // Per-connection transaction state so no cross-contamination
  connection.inTransaction = false;
  connection.queuedCommands = [];

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
    if (connection.blockState) unblockClient(connection.blockState);
  });

  connection.on("error", (error) => {
    console.error("Connection error:", error.message);
    if (connection.blockState) unblockClient(connection.blockState);
  });
});

server.listen(6380, "127.0.0.1", () => {
  console.log("[*] Server listening on 127.0.0.1:6380");
});
