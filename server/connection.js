import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_PATH, MYME_TYPES, TEXT_OPCODE, CLOSE_OPCODE } from "./config.js";

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
            throw new Error("Could Not Read File. filePath: " + filePath);
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

export function sendTextFrame(socket, text) {
    const payload = Buffer.from(text, "utf8");
    const FIN = 0b10000000;
    if (payload.length <= 125) {
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = FIN | TEXT_OPCODE;
        frame[1] = payload.length;
        payload.copy(frame, 2);
        socket.write(frame);
    } else {
        const frame = Buffer.alloc(4 + payload.length);
        frame[0] = FIN | TEXT_OPCODE;
        frame[1] = 126;
        frame.writeUInt16BE(payload.length, 2);
        payload.copy(frame, 4);
        socket.write(frame);
    } else {
        return;
    }
}

export function sendCloseFrame(socket, statusCode = 1000, reason = "") {
    const reasonBuffer = Buffer.from(reason, "utf8");
    if (reasonBuffer.length > 123) {
        throw new Error("the close reason must not be more than 123bytes");
    }
    const payload = Buffer.alloc(reasonBuffer.length + 2);
    const FIN = 0b10000000;
    payload.writeUInt16BE(statusCode, 0);
    reasonBuffer.copy(payload, 2);
    const frame = Buffer.alloc(payload.length + 2);
    frame[0] = FIN | CLOSE_OPCODE;
    frame[1] = payload.length;
    payload.copy(frame, 2);
    socket.write(frame);
}
