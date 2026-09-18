import net from "net";
import { cacheSet, cacheGet, increment } from "./cache.js";
import { getRange, pop, push, getListLength } from "./list.js"
import { setStream, getStreamRange, getStreamXRead } from "./stream.js"
import { getType } from "./store.js";
import { parseResp, ASTERISK, CRLF } from "./parser.js"
import { toBuffer, encodeBulkString, encodeArray, encodeBlpopResponse, encodeStreamEntries, encodeXReadResponse } from "./encoder.js"

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
    let elementsToAdd = [...elements];

    const key = args[1].toString('utf8');
    let queue = blockedQueues.get(key);

    if (queue && queue.length > 0) {
      while (queue.length > 0 && elementsToAdd.length > 0) {
        const clientState = queue.shift(); 
        const element = elementsToAdd.shift();
        
        unblockClient(clientState); // removes them from ALL queues and clears timer
        console.log(`[-->][${clientState.clientInfo}] BLPOP unblocked with element: ${element}`);
        connection.write(encodeBlpopResponse(key, element));
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
  } else if (commandName === "BLPOP") {
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
        connection.write("*-1\r\n"); // Null array on timeout
        console.log(`[-->][${clientInfo}] BLPOP timeout reached`);
      }, timeout * 1000);
    }
    
    // Add client to the queue for the requested key
    if (!blockedQueues.has(key)) blockedQueues.set(key, []);
    blockedQueues.get(key).push(clientState);
    
    // Attach state to connection so we can clean up if they disconnect
    connection.blockState = clientState;
    console.log(`[-->][${clientInfo}] BLPOP blocking on keys: ${key} with timeout ${timeout}`);
  } else if (commandName === "TYPE") {
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
  } else if (commandName === "XADD") {
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
  } else if (commandName === "XRANGE") {
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
  } else if (commandName === "XREAD") {
    // find the STREAMS keyword dynamically
    let streamsIndex = -1;
    for (let i = 1; i < args.length; i++) {
      if (args[i].toString('utf8').toUpperCase() === 'STREAMS') {
        streamsIndex = i;
        break;
      }
    }
    if (streamsIndex === -1) {
      connection.write("-ERR syntax error\r\n");
      return;
    }

    const streamArgs = args.slice(streamsIndex + 1).map(x => x.toString('utf8'));
    if (streamArgs.length === 0 || streamArgs.length % 2 !== 0) {
      connection.write("-ERR Unbalanced 'xread' list of streams: for each stream key an ID must be specified\r\n");
      return;
    }
    
    const half = streamArgs.length / 2;
    const keys = streamArgs.slice(0, half);
    const ids = streamArgs.slice(half);
    
    if (args[1].toString('utf8').toUpperCase() !== "BLOCK") {
      if (keys.length > 1) {
        connection.write("-ERR More than one key with BLOCK option\r\n");
        return;
      }
      const key = keys[0];
      const entry = getStreamXRead(key, ids[0]); // In case of "BLOCK", it is only one key and one id
      if (entry && entry.length > 0) {
        console.log(`[-->][${clientInfo}] Response: XREAD Array of Streams`);
        connection.write(encodeXReadResponse([key, entry]));
        return;
      } else {
        const timeout = Number(args[2].toString('utf8')); 
        if (isNaN(timeout) || timeout < 0) {
          connection.write("-ERR timeout is not a float or out of range\r\n");
          return;
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
            connection.write("*-1\r\n"); // Null array on timeout
            console.log(`[-->][${clientInfo}] XREAD timeout reached`);
          }, timeout * 1000);
        }
        
        // Add client to the queue for the requested key
        if (!blockedQueues.has(key)) blockedQueues.set(key, []);
        blockedQueues.get(key).push(clientState);
        
        // Attach state to connection so we can clean up if they disconnect
        connection.blockState = clientState;
        console.log(`[-->][${clientInfo}] XREAD blocking on keys: ${key} with timeout ${timeout}`);
        return;
      }
    }

    let finalResult = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const id = ids[i];
      const entries = getStreamXRead(key, id);
      if (entries && entries.length > 0) {
        finalResult.push([key, entries]);
      }
    }

    if (finalResult.length === 0 && args[1].toString('utf8') !== "BLOCK") {
      connection.write("*-1\r\n");
      return;
    }
    console.log(`[-->][${clientInfo}] Response: XREAD Array of Streams`);
    connection.write(encodeXReadResponse(finalResult));
  } else if (commandName === "INCR") {
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
