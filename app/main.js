const net = require("net");

const server = net.createServer((connection) => {
    let buffer = "";
    connection.on("data", (data) => {
        buffer += data.toString();
        let index;
        while ((index = buffer.indexOf("\r\n")) != -1) {
            const command = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            console.log("Received command:", command);
            if (command === "PING") {
                connection.write("+PONG\r\n");
            }
        }
        console.log(data.toString().split("\n"));
    });
});

/*
 * run: redis-cli -h 127.0.0.1 -p 6380 ping
 * or: nc 127.0.0.1 6380
 * or: printf "PING\r\n" | nc -w 1 127.0.0.1 6380
 * or: telnet 127.0.0.1 6380
 * I prefere to run: printf "PING\r\nPING\r\n" | nc -w 1 127.0.0.1 6380
 */
server.listen(6380, "127.0.0.1");
