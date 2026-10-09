import http from "node:http";
import { PORT, DEFAULT_PATH, isLocal } from "./config.js";
import { createHttpSeever, serverOnUpgrade } from "./connection.js";

const server = http.createServer((request, response) => {
    createHttpServer(request, response);
});

server.on("upgrade", (request, socket, head) => {
    serverOnUpgrade(request, socket, head);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("サーバーが起動しました。");
    if (isLocal) {
        console.log("http://localhost:" + PORT + "/\r\n");
    }
});
