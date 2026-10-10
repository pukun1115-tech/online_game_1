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
            response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("Could Not Read File. filePath: " + filePath);
            console.error("Could Not Read File. filePath: " + filePath);
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
        if (socket.writable) {
            socket.write(frame);
        }
    } else if (payload.length <= 65535) {
        const frame = Buffer.alloc(4 + payload.length);
        frame[0] = FIN | TEXT_OPCODE;
        frame[1] = 126;
        frame.writeUInt16BE(payload.length, 2);
        payload.copy(frame, 4);
        if (socket.writable) {
            socket.write(frame);
        }
    } else {
        return;
    }
}

export function sendCloseFrame(socket, statusCode = 1000, reason = "") {
    const reasonBuffer = Buffer.from(reason, "utf8");
    if (reasonBuffer.length > 123) {
        console.error("the close reason must not be more than 123bytes");
        return;
    }
    const payload = Buffer.alloc(reasonBuffer.length + 2);
    const FIN = 0b10000000;
    payload.writeUInt16BE(statusCode, 0);
    reasonBuffer.copy(payload, 2);
    const frame = Buffer.alloc(payload.length + 2);
    frame[0] = FIN | CLOSE_OPCODE;
    frame[1] = payload.length;
    payload.copy(frame, 2);
    if (socket.writable) {
        socket.write(frame);
    }
}

export function decodeTextFrame(frame) {
    const secondByte = frame[1];
    const lengthCode = secondByte & 0b01111111;
    let payloadLength;
    let payloadStartIndex;
    if (lengthCode <= 125) {
        payloadLength = lengthCode;
        payloadStartIndex = 6;
    } else if (lengthCode === 126) {
        payloadLength = frame.readUInt16BE(2);
        payloadStartIndex = 8;
    } else {
        return null;
    }
    const maskingKeyStartIndex = payloadStartIndex - 4;
    const maskingKey = frame.subarray(maskingKeyStartIndex, maskingKeyStartIndex + 4);
    const maskedPayload = frame.subarray(payloadStartIndex, payloadStartIndex + payloadLength);
    const decodedPayload = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
        decodedPayload[i] = maskedPayload[i] ^ maskingKey[i % 4];
    }
    return decodedPayload.toString("utf8");
}

export function extractFrame(buffer) {
    if (buffer.length < 2) {
        return { frame: null, rest: buffer };
    }
    const firstByte = buffer[0];
    const secondByte = buffer[1];

    const fin = (firstByte >> 7) === 1;
    const opcode = firstByte & 0b00001111;
    const masked = (secondByte >> 7) === 1;
    const lengthCode = secondeByte & 0b01111111;

    if (!fin || (opcode !== 0b0001 && opcode !== 0b1000) || !masked) {
        console.error("Invalid WebSocket frame");
        return null;
    }

    let lengthBytes;
    if (lengthCode <= 125) {
        lengthBytes = 0;
    } else if (lengthCode === 126) {
        lengthBytes = 2;
    } else {
        return null;
    }
    const headerLength = 2 + lengthBytes + 4;
    if (buffer.length < headerLength) {
        return { frame: null, rest: buffer };
    }
    const payloadLength = (lengthCode <= 125 ? lengthCode : buffer.readUInt16BE(2));
    const frameLength = headerLength + payloadLength;
    if (buffer.length < frameLength) {
        return { frame: null, rest: buffer };
    }

    return {
        frame: buffer.subarray(0, frameLength),
        rest: buffer.subarray(frameLength),
    };
}