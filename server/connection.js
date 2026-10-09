import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_PATH, MYME_TYPES } from "./config.js";

export function createHttpServer(request, response) {
    const requestUrl = (request.url === "/" ? "/index.html" : request.url);
    if (request.method !== "GET" || (requestUrl !== "/index.html" && requestUrl !== "/script.js" && requestUrl !== "/style.css" && requestUrl !== "/images/favicon.ico")) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("404 Not Found");
        return;
    }
    const extension = path.extname(requestUrl);
    const filePath = path.join(DEFAULT_PATH, "public", requestUrl);
    fs.readFile(filePath, (error, fileData) => {
        if (error) {
            console.log("Could Not Read File. filePath: " + filePath);
            response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("Could Not Read File. filePath: " + filePath);
            return;
        }
        response.writeHead(200, { "Content-Type": MYME_TYPES[extension] || "application/octet-stream" });
        response.end(fileData);
    });
}
export function serverOnUpgrade(request, socket, head) {
    const webSocketKey = request.headers["sec-websocket-key"];
    if (!webSocketKey) {
        socket.destroy();
        return;
    }
    const magicString = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const acceptKey = crypto
        .createHash("sha1")
        .update(webSocketKey + magicString)
        .digest("base64");
    const response = (
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
        "\r\n"
    );
    socket.write(response);
}
