import http from "node:http";
import { PORT, isLocal } from "./config.js";
import { createHttpServer, serverOnUpgrade } from "./connection.js";
import { Game } from "./game.js";

const game = new Game();

const server = http.createServer((request, response) => {
    createHttpServer(request, response);
});

server.on("upgrade", (request, socket, head) => {
    serverOnUpgrade(request, socket, head, game);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("サーバーが起動しました。");
    if (isLocal) {
        console.log("http://localhost:" + PORT + "/\r\n");
    }
});

setInterval(() => {
    game.update();
}, 1000 / 60);