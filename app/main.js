const net = require("net");

console.log("Logs from your program will appear here!");

const server = net.createServer((connection) => {
    connection.on("data", (data) => {
        connection.write("+PING\r\n");
    });
});

server.listen(6380, "127.0.0.1");
