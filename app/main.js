const net = require("net");

console.log("Logs from your program will appear here!");

const server = net.createServer((connection) => {
    connection.on("data", (data) => {
        connection.write("+PONG\r\n");
        console.log(data.toString().split("\n"));
    });
});
/*
 * run: redis-cli -h 127.0.0.1 -p 6380 ping
 * or: nc 127.0.0.1 6380
 * or: printf "PING\r\n" | nc -w 1 127.0.0.1 6380
 * or: telnet 127.0.0.1 6380
 */
server.listen(6380, "127.0.0.1");
