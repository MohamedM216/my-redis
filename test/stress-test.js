import net from 'net';

const PORT = 6380;
const HOST = '127.0.0.1';
const CONCURRENT_REQUESTS = 10000;

// send a raw RESP command
function sendCommand(commandString) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(PORT, HOST, () => client.write(commandString));
    client.on('data', (data) => { client.destroy(); resolve(data.toString()); });
    client.on('error', reject);
  });
}

async function runStressTest() {
  console.log(`Firing ${CONCURRENT_REQUESTS} concurrent SET requests...`);
  
  // Create an array of 10000 promises that all try to set the same key
  const promises = [];
  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    // RESP format for: SET counter i
    const resp = `*3\r\n$3\r\nSET\r\n$7\r\ncounter\r\n$${i.toString().length}\r\n${i}\r\n`;
    promises.push(sendCommand(resp));
  }
  await Promise.all(promises);

  const getResp = `*2\r\n$3\r\nGET\r\n$7\r\ncounter\r\n`;
  const finalResult = await sendCommand(getResp);
  console.log("Final Result from Server:", finalResult.trim());
}

runStressTest();