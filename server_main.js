const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sockets = new Set();
const players = new Map();
const playerIds = new Map();
const bullets = new Set();

const map = [
    "########################################",
    "#...#...........................#......#",
    "###.#.##...............................#",
    "#...#.##...............................#",
    "#.###.##..####################..####...#",
    "#...............................####...#",
    "#.#.##..........................####...#",
    "#.#.#...........................####...#",
    "#.#.#..................................#",
    "#...#...#..........##..............#...#",
    "#..##....#.........##......#.#.....#...#",
    "#...#.....#........##.......#......#...#",
    "##..#......#.......##......#.#.....#...#",
    "#...#.......#......##..................#",
    "#.#.#........#.............#.#.#.#.#...#",
    "#...#.....#............................#",
    "#...#.....#.................#.#.#.#....#",
    "#...#...#########......................#",
    "#......................................#",
    "#................#....#................#",
    "#..................##..................#",
    "#......................................#",
    "#......................#########...#...#",
    "#....#.#.#.#.................#.....#...#",
    "#............................#.....#...#",
    "#...#.#.#.#.#.............#........#.#.#",
    "#..................##......#.......#...#",
    "#...#.....#.#......##.......#......#..##",
    "#...#......#.......##........#.....#...#",
    "#...#.....#.#......##.........#....##..#",
    "#...#..............##..........#...#...#",
    "#..................................#.#.#",
    "#...####...........................#.#.#",
    "#...####..........................##.#.#",
    "#...####...............................#",
    "#...####..####################..##.###.#",
    "#...............................##.#...#",
    "#...............................##.#.###",
    "#......#...........................#...#",
    "########################################",
];

function checkPlayerCollision(nx, ny) {
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] !== "#") continue;
            const px = Math.max(Math.min(x + 1, nx + 0.25), x);
            const py = Math.max(Math.min(y + 1, ny + 0.25), y);

            const dx = nx + 0.25 - px;
            const dy = ny + 0.25 - py;

            const distance = (dx * dx) + (dy * dy);
            if (distance < 0.25 * 0.25) {
                return true;
            }
        }
    }
    return false;
}

function cbulletcw(nx, ny) {
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] !== "#") continue;
            const px = Math.max(Math.min(x + 1, nx), x);
            const py = Math.max(Math.min(y + 1, ny), y);

            const dx = nx - px;
            const dy = ny - py;

            const distance = (dx * dx) + (dy * dy);
            if (distance < 0.0675 * 0.0675) {
                return true;
            }
        }
    }
    return false;
}

function cbulletcp(nx, ny) {
    for (const p of players.keys()) {
        const dx = players.get(p).x - nx;
        const dy = players.get(p).y - ny;
        const distance = (dx * dx) + (dy * dy);
        if (distance < 0.0675 + 0.25) {
            return p;
        }
    }
    return null;
}

function broadcast(all, socket, message) {
    const text = JSON.stringify(message);

    for (const client of sockets) {
        if (all || client !== socket) {
            sendTextFrame(client, text);
        }
    }
}

function cleanupSocket(socket) {
    sockets.delete(socket);
    const playerId = playerIds.get(socket);
    if (!playerId) {
        return undefined;
    }
    playerIds.delete(socket);
    players.delete(playerId);
    broadcast(false, socket, { type: "playerLeft", id: playerId });
}

//
//
//

function sendTextFrame(socket, text) {
    const payload = Buffer.from(text, "utf8");
    if (payload.length <= 125) {
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81;
        frame[1] = payload.length;
        payload.copy(frame, 2);
        socket.write(frame);
    } else if (payload.length <= 65535) {
        const frame = Buffer.alloc(4 + payload.length);
        frame[0] = 0x81;
        frame[1] = 126;
        frame.writeUInt16BE(payload.length, 2);
        payload.copy(frame, 4);
        socket.write(frame);
    } else {
        return undefined;
    }
}

function sendCloseFrame(socket, statusCode = 1000, reason = "") {
    const reasonBuffer = Buffer.from(reason, "utf8");
    if (reasonBuffer.length > 123) {
        console.error("closeフレームのreasonが123バイトを超えています。");
    } else {
        const payload = Buffer.alloc(reasonBuffer.length + 2);
        payload.writeUInt16BE(statusCode, 0);
        reasonBuffer.copy(payload, 2);
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x88;
        frame[1] = payload.length;
        payload.copy(frame, 2);
        socket.write(frame);
    }
}

function decodeTextFrame(frame) {
    const secondByte = frame[1];
    const lengthCode = secondByte & 0x7f;
    let payloadLength;
    let payloadStartIndex;
    if (lengthCode < 126) {
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

function extractFrame(buffer) {
    if (buffer.length < 2) {
        return { frame: null, rest: buffer };
    }
    const firstByte = buffer[0];
    const secondByte = buffer[1];

    const fin = (firstByte >> 7) === 1;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte >> 7) === 1;
    const lengthCode = secondByte & 0x7f;

    if (!fin || (opcode !== 0x08 && opcode !== 0x01) || !masked) {
        console.log("不正なWebSocketフレームを受信しました。");
        return null;
    }

    let lengthBytes;

    if (lengthCode <= 125) {
        lengthBytes = 0;
    } else if (lengthCode === 126) {
        lengthBytes = 2;
    } else if (lengthCode === 127) {
        return null;
    }

    const headerLength = 2 + lengthBytes + 4;
    if (buffer.length < headerLength) {
        return { frame: null, rest: buffer };
    }
    const payloadLength = (lengthCode < 126) ? lengthCode : buffer.readUInt16BE(2);
    const frameLength = headerLength + payloadLength;
    if (buffer.length < frameLength) {
        return { frame: null, rest: buffer };
    }
    return {
        frame: buffer.subarray(0, frameLength),
        rest: buffer.subarray(frameLength)
    };
}

//繰り返す
//受信バッファからフレームを取り出して処理する
function processReceivedData(socket, receiveBuffer) {
    while (receiveBuffer.length > 0) {
        const result = extractFrame(receiveBuffer);
        if (result === null) {
            socket.destroy();
            return null;
        }

        const { frame, rest } = result;
        receiveBuffer = rest;
        if (frame === null) {
            return receiveBuffer;
        }

        const opcode = frame[0] & 0x0f;
        if (opcode === 0x8) {
            console.log("ブラウザからcloseフレームを受信しました。");
            sendCloseFrame(socket, 1000, "正常終了");
            socket.end();
            return null;
        }
        if (opcode === 0x1) {
            const text = decodeTextFrame(frame);

            if (text === null) {
                console.log("データのデコードに失敗しました。");
                socket.destroy();
                return null;
            }
            processPlayerState(socket, playerIds.get(socket), text);
        }
    }
    return receiveBuffer;
}

//
//
//

function processPlayerState(socket, playerId, text) {
    try {
        const obj = JSON.parse(text);
        if (!obj.type) {
            socket.destroy();
            return undefined;
        } else if (obj.type === "state") {
            const player = players.get(playerId);
            if (!player || !obj.state) {
                socket.destroy();
                return null;
            }
            const moveSpeed = 0.1;
            const moveX = Number(obj.state.right === true) - Number(obj.state.left === true);
            const moveY = Number(obj.state.down === true) - Number(obj.state.up === true);
            const moveLength = Math.hypot(moveX, moveY);
            if (moveLength > 0) {
                const normalizedMoveX = moveX / moveLength;
                const normalizedMoveY = moveY / moveLength;
                for (let i = 0; i < 5; i++) {
                    const nextX = player.x + (normalizedMoveX * moveSpeed) / 5;
                    const nextY = player.y + (normalizedMoveY * moveSpeed) / 5;
                    if (!checkPlayerCollision(nextX, player.y)) {
                        player.x = nextX;
                    }
                    if (!checkPlayerCollision(player.x, nextY)) {
                        player.y = nextY;
                    }
                }
            }
            if (!Number.isNaN(obj.state.directionX) && !Number.isNaN(obj.state.directionY)) {
                player.directionX = obj.state.directionX;
                player.directionY = obj.state.directionY;
            }
            broadcast(true, socket, { type: "playerMove", playerId: playerId, player: player });
            if (obj.state.isPainting) {
                const paintingX = Math.floor(player.x + 0.25);
                const paintingY = Math.floor(player.y + 0.25);

                const newChar = player.team;
                if (map[paintingY][paintingX] !== newChar) {
                    const str = map[paintingY].slice(0, paintingX) + newChar + map[paintingY].slice(paintingX + 1);
                    map[paintingY] = str;
                    broadcast(true, socket, { type: "paint", paintedY: paintingY, str: str });
                }
            }
            if (obj.state.isShooting) {
                if (!player.canShoot) {
                    return undefined;
                }
                const bullet = {
                    playerId: playerId,
                    bulletId: crypto.randomUUID(),
                    bulletTeam: player.team,
                    x: player.x + 0.25,
                    y: player.y + 0.25,
                    directionX: player.directionX,
                    directionY: player.directionY,
                    hitPlayers: []
                };
                bullets.add(bullet);
                broadcast(true, socket, { type: "addBullet", bullet: bullet });
                const shootCooldown = 200;
                const bulletSpeed = 0.5;
                player.canShoot = false;
                setTimeout(() => {
                    player.canShoot = true;
                }, shootCooldown);
                function updateBullet() {
                    for (let i = 0; i < 100; i++) {
                        bullet.x += bullet.directionX * bulletSpeed / 100;
                        bullet.y += bullet.directionY * bulletSpeed / 100;
                        if (
                            (bullet.x < 0 || bullet.x >= 40 || bullet.y < 0 || bullet.y >= 40) ||
                            (cbulletcw(bullet.x, bullet.y))
                        ) {
                            bullets.delete(bullet);
                            broadcast(true, socket, { type: "deleteBullet", bullet: bullet });
                            return undefined;
                        }
                        if (cbulletcp(bullet.x, bullet.y)) {
                            const pId = cbulletcp(bullet.x, bullet.y);
                            if (players.get(pId).team === bullet.bulletTeam) {
                                continue;
                            }
                            const hitPlayer = players.get(pId);
                            if (hitPlayer) {
                                hitPlayer.hp -= 1;
                            }
                            bullets.delete(bullet);
                            broadcast(true, socket, { type: "deleteBullet", bullet: bullet });
                            broadcast(true, socket, { type: "playerHp", id: pId, player: players.get(pId) });
                            return undefined;
                        }
                    }
                    broadcast(true, socket, { type: "updateBullet", bullet: bullet });
                    setTimeout(() => updateBullet(), 20);
                }
                setTimeout(() => updateBullet(), 20);
            }
        } else if (obj.type === "chat") {
            broadcast(true, socket, { type: "chat", message: `${playerId}: ${obj.message}` });
        }
    } catch (error) {
        socket.destroy();
    }
}

//サーバーを作る
const server = http.createServer((request, response) => {
    if (!(request.method === "GET" && (request.url === "/" || request.url === "/index.html"))) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("404 Not Found");
        return undefined;
    }
    const filePath = path.join(__dirname, "public", "index.html");
    fs.readFile(filePath, (error, fileData) => {
        if (error) {
            response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("index.htmlを読み込めませんでした。");
            return undefined;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(fileData);
    });
});

server.on("upgrade", (request, socket, head) => {
    const websocketKey = request.headers["sec-websocket-key"];
    if (!websocketKey) {
        socket.destroy();
        return undefined;
    }
    const magicString = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const acceptKey = crypto
        .createHash("sha1")
        .update(websocketKey + magicString)
        .digest("base64");
    const response = (
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
        "\r\n"
    );
    socket.write(response);
    
    sockets.add(socket);
    function createPlayerId() {
        const f = Math.random().toString(36).substring(2, 2 + 6);
        return f.charAt(0).toUpperCase() + f.slice(1);
    }
    const playerId = createPlayerId();
    const playerTeam = (Math.random() > 0.5) ? "R" : "B";
    const newPlayer = {
        id: playerId,
        hp: 100,
        x: (playerTeam === "R") ? 1.25 : 38.25,
        y: (playerTeam === "R") ? 1.25 : 38.25,
        team: playerTeam,
        directionX: 1,
        directionY: 0,
        canShoot: true,
    }
    players.set(playerId, newPlayer);
    playerIds.set(socket, playerId);
    sendTextFrame(socket, JSON.stringify({ type: "init", id: playerId, map: map, players: Array.from(players.values()) }));
    broadcast(false, socket, { type: "playerJoined", player: newPlayer });

    const MAX_BUFFER_SIZE = 512 * 512;
    let receiveBuffer = Buffer.alloc(0);
    socket.on("data", (data) => {
        if (receiveBuffer === null) {
            return undefined;
        }
        receiveBuffer = Buffer.concat([receiveBuffer, data]);
        if (receiveBuffer.length > MAX_BUFFER_SIZE) {
            socket.destroy();
            return undefined;
        }
        receiveBuffer = processReceivedData(socket, receiveBuffer);
    });
    if (head && head.length > 0) {
        if (receiveBuffer === null) {
            return undefined;
        }
        receiveBuffer = Buffer.concat([receiveBuffer, head]);
        if (receiveBuffer.length > MAX_BUFFER_SIZE) {
            socket.destroy();
            return undefined;
        }
        receiveBuffer = processReceivedData(socket, receiveBuffer);
    }

    socket.on("end", () => {
        console.log("websocket接続が終了しました。");
        cleanupSocket(socket);
    });

    socket.on("close", () => {
        console.log("接続が閉じられました。");
        cleanupSocket(socket);
    });

    socket.on("error", (error) => {
        console.log("websocketエラー:", error.message);
        cleanupSocket(socket);
    });
});

server.listen(3000, () => {
    console.log("サーバーが起動しました。");
    console.log("http://localhost:3000\r\n");
});
