const net = require("net");

// net.Server is event-driven and non-blocking, so it can handle 
// multiple connections at the same time at least in the mean time :)
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

server.listen(6380, "127.0.0.1");
