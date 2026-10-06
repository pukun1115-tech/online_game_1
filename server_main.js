const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PORT = process.env.PORT || 3000;
const MAX_BUFFER_SIZE = 512 * 512;

const PLAYER_MAX_HP = 100;
const PLAYER_HP_COOLDOWN = 60;
const PLAYER_RECOVER_HP = 1;
const TILE_SIZE = 1;
const PLAYER_RADIUS = 0.25;
const BULLET_RADIUS = 0.0625;
const ENEMY_TEAM = { R: "B", B: "R" };
const SHOOT_COOLDOWN = 200;
const BULLET_SPEED = 0.8;
const BULLET_DAMAGE = 5;

const sockets = new Set();
const players = new Map();
const playerIds = new Map();
const bullets = new Set();
const playerCount = { R: 0, B: 0 };
const teamPoint = { R: 0, B: 0 };
let time = 0;
setInterval(() => {
    time++;
}, (1000 / 60));

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

function checkCircleRectCollision(circle, rect) {
    const px = Math.max(Math.min(circle.x, rect.right), rect.left);
    const py = Math.max(Math.min(circle.y, rect.down), rect.up)

    const dx = Math.abs(circle.x - px);
    const dy = Math.abs(circle.y - py);

    const distance = (dx * dx) + (dy * dy);
    return (distance < circle.r * circle.r);
}

function checkCircleCircleCollision(circle1, circle2) {
    const dx = circle1.x - circle2.x;
    const dy = circle1.y - circle2.y;
    const distance = (dx * dx) + (dy * dy);
    return (distance < (circle1.r + circle2.r) * (circle1.r + circle2.r));
}

function checkPlayerCollision(nx, ny) {
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] !== "#") continue;
            if (checkCircleRectCollision({ x: (nx + 0.25), y: (ny + 0.25), r: 0.25 }, { left: x, right: (x + 1), up: y, down: (y + 1) })) {
                return true;
            }
        }
    }
    return false;
}

function checkBulletWallCollision(nx, ny) {
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] !== "#") continue;
            if (checkCircleRectCollision({ x: nx, y: ny, r: 0.0625 }, { left: x, right: (x + 1), up: y, down: (y + 1) })) {
                return true;
            }
        }
    }
    return false;
}

function checkBulletPlayerCollision(b) {
    for (const p of players.keys()) {
        if (players.get(p).team === b.bulletTeam) {
            continue;
        }
        if (checkCircleCircleCollision({ x: b.x, y: b.y, r: 0.0625 }, { x: (players.get(p).x + 0.25), y: (players.get(p).y + 0.25), r: 0.25 })) {
            return p;
        }
    }
    return null;
}

function getPlayerMoveSpeed(player, tileX, tileY) {
    return (map[tileY][tileX] === ".") ? 0.06 : ((map[tileY][tileX] === player.team) ? 0.08 : 0.04);
}

//
//
//

function cleanupSocket(socket) {
    sockets.delete(socket);
    const playerId = playerIds.get(socket);
    if (!playerId) {
        return;
    }
    playerCount[players.get(playerId).team] -= 1;
    playerIds.delete(socket);
    players.delete(playerId);
    broadcast(false, socket, { type: "playerLeft", playerId: playerId });
}

function broadcast(all, socket, message) {
    const text = JSON.stringify(message);

    for (const client of sockets) {
        if (all || client !== socket) {
            sendTextFrame(client, text);
        }
    }
}

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
        return;
    }
}

function sendCloseFrame(socket, statusCode = 1000, reason = "") {
    const reasonBuffer = Buffer.from(reason, "utf8");
    if (reasonBuffer.length > 123) {
        console.log("closeフレームのreasonが123バイトを超えています。");
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
        } else if (obj.type === "state") {
            handleStateMessage(socket, playerId, obj.state);
        } else if (obj.type === "chat") {
            broadcast(true, null, { type: "chat", message: `${playerId}: ${obj.message}` });
        }
    } catch (error) {
        socket.destroy();
    }
}

function handleStateMessage(socket, playerId, state) {
    const player = players.get(playerId);
    if (!player || !state) {
        socket.destroy();
        return;
    }
    updatePlayerMovement(player, state);
    updatePlayerDirection(player, state);
    recoverPlayerHp(player);
    updatePlayerShooting(player, state);
    broadcast(true, null, { type: "playerUpdate", playerId: playerId, player: player });

    updatePlayerPainting(player, state);
}

function updatePlayerMovement(player, state) {
    const moveX = Number(state.right === true) - Number(state.left === true);
    const moveY = Number(state.down === true) - Number(state.up === true);
    const moveLength = Math.hypot(moveX, moveY);
    if (moveLength === 0) {
        return;
    }
    const normalizedMoveX = moveX / moveLength;
    const normalizedMoveY = moveY / moveLength;

    const tileX = Math.floor(player.x + 0.25);
    const tileY = Math.floor(player.y + 0.25);
    const moveSpeed = getPlayerMoveSpeed(player, tileX, tileY);

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

function updatePlayerDirection(player, state) {
    if (Number.isNaN(state.directionX) || Number.isNaN(state.directionY)) {
        return;
    }
    if (Math.hypot(state.directionX, state.directionY) < 0.99 || Math.hypot(state.directionX, state.directionY) > 1.01) {
        player.directionX = 1;
        player.directionY = 0;
        return;
    }
    player.directionX = state.directionX;
    player.directionY = state.directionY;
}

function recoverPlayerHp(player) {
    if (player.hpTime + PLAYER_HP_COOLDOWN > time) {
        return;
    }

    if (player.hp < PLAYER_MAX_HP) {
        player.hp = Math.min(player.hp + PLAYER_RECOVER_HP, PLAYER_MAX_HP);
        player.hpTime = time;
    }
}

function updatePlayerPainting(player, state) {
    if (state.isPainting !== true) {
        return;
    }
    const tileX = Math.floor(player.x + 0.25);
    const tileY = Math.floor(player.y + 0.25);
    const currentTile = map[tileY][tileX];
    updateTeamPoint(player.team, currentTile);
    paintTile(player.team, tileX, tileY);
}

function updateTeamPoint(team, currentTile) {
    if (currentTile === ".") {
        teamPoint[team] += 1;
    } else if (currentTile === ENEMY_TEAM[team]) {
        teamPoint[ENEMY_TEAM[team]] -= 1;
        teamPoint[team] += 1;
    }
    broadcast(true, null, { type: "updateTeamPoint", teamPoint: teamPoint });
}

function paintTile(team, tileX, tileY) {
    if (map[tileY][tileX] === team) {
        return;
    }
    const newStr = map[tileY].slice(0, tileX) + team + map[tileY].slice(tileX + 1);
    map[tileY] = newStr;
    broadcast(true, null, { type: "paint", paintedY: tileY, str: newStr });
}

function updatePlayerShooting(player, state) {
    player.isShooting = (state.isShooting === true);
    if (!player.isShooting || !player.canShoot) {
        return;
    }
    const bullet = createBullet(player);
    bullets.add(bullet);
    broadcast(true, null, { type: "addBullet", bullet: bullet });
    startShootCooldown(player);
    startBulletMovement(bullet);
}

function startShootCooldown(player) {
    player.canShoot = false;
    setTimeout(() => {
        player.canShoot = true;
    }, SHOOT_COOLDOWN);

    player.shooted = true;
    setTimeout(() => {
        player.shooted = false;
    }, SHOOT_COOLDOWN / 3);
}

function startBulletMovement(bullet) {
    setTimeout(() => {
        const shouldContinue = updateBullet(bullet);
        if (shouldContinue) {
            startBulletMovement(bullet);
        }
    }, (1000 / 60));
}

function updateBullet(bullet) {
    function isBulletOutsideMap(bullet) {
        return (bullet.x < 0 || bullet.x >= 40 || bullet.y < 0 || bullet.y >= 40);
    }
    
    for (let i = 0; i < 50; i++) {
        bullet.x += bullet.directionX * BULLET_SPEED / 50;
        bullet.y += bullet.directionY * BULLET_SPEED / 50;
        if (isBulletOutsideMap(bullet) || checkBulletWallCollision(bullet.x, bullet.y)) {
            broadcast(true, null, { type: "updateBullet", bullet: bullet });
            deleteBullet(bullet);
            return false;
        }
        const hitPlayerId = checkBulletPlayerCollision(bullet);

        if (hitPlayerId !== null) {
            handleBulletHit(bullet, hitPlayerId);
            return false;
        }
    }
    broadcast(true, null, { type: "updateBullet", bullet: bullet });
    return true;
}

function handleBulletHit(bullet, hitPlayerId) {
    const hitPlayer = players.get(hitPlayerId);
    if (!hitPlayer) {
        return;
    }
    hitPlayer.hp -= BULLET_DAMAGE;
    if (hitPlayer.hp <= 0) {
        broadcast(true, null, { type: "playerDied", died: hitPlayerId, kill: bullet.playerId });
        hitPlayer.hp = PLAYER_MAX_HP;
        hitPlayer.x = (hitPlayer.team === "R") ? 1.25 : 38.25;
        hitPlayer.y = (hitPlayer.team === "R") ? 1.25 : 38.25;
        broadcast(true, null, { type: "playerSpawn", player: hitPlayer });
    }
    broadcast(true, null, { type: "updateBullet", bullet: bullet });
    deleteBullet(bullet);
    broadcast(true, null, { type: "playerUpdate", playerId: hitPlayerId, player: hitPlayer });
    return;
}

function deleteBullet(bullet) {
    bullets.delete(bullet);
    broadcast(true, null, { type: "deleteBullet", bullet: bullet });
}

function createBullet(player) {
    return {
        playerId: player.id,
        bulletId: crypto.randomUUID(),
        bulletTeam: player.team,
        x: player.x + 0.25,
        y: player.y + 0.25,
        directionX: player.directionX,
        directionY: player.directionY,
    };
}

const server = http.createServer((request, response) => {
    if (!(request.method === "GET" && (request.url === "/" || request.url === "/index.html"))) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("404 Not Found");
        return;
    }
    const filePath = path.join(__dirname, "public", "index.html");
    fs.readFile(filePath, (error, fileData) => {
        if (error) {
            response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("index.htmlを読み込めませんでした。");
            return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(fileData);
    });
});

server.on("upgrade", (request, socket, head) => {
    const websocketKey = request.headers["sec-websocket-key"];
    if (!websocketKey) {
        socket.destroy();
        return;
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
    let playerTeam;
    if (playerCount["R"] === playerCount["B"]) {
        playerTeam = (Math.random() > 0.5) ? "R" : "B";
    } else {
        playerTeam = (playerCount["B"] > playerCount["R"]) ? "R" : "B";
    }
    const newPlayer = {
        id: playerId,
        hp: PLAYER_MAX_HP,
        hpTime: PLAYER_HP_COOLDOWN,
        x: (playerTeam === "R") ? 1.25 : 38.25,
        y: (playerTeam === "R") ? 1.25 : 38.25,
        team: playerTeam,
        directionX: 1,
        directionY: 0,
        canShoot: true,
        isShooting: false,
        shooted: false,
    }
    players.set(playerId, newPlayer);
    playerIds.set(socket, playerId);
    playerCount[playerTeam] += 1;
    sendTextFrame(socket, JSON.stringify({ type: "init", playerId: playerId, map: map, players: Array.from(players.values()), bullets: Array.from(bullets), teamPoint: teamPoint }));
    broadcast(false, socket, { type: "playerSpawn", player: newPlayer });
    broadcast(false, socket, { type: "chat", message: `${playerId} joined the game.` });

    let receiveBuffer = Buffer.alloc(0);
    socket.on("data", (data) => {
        if (receiveBuffer === null) {
            return;
        }
        receiveBuffer = Buffer.concat([receiveBuffer, data]);
        if (receiveBuffer.length > MAX_BUFFER_SIZE) {
            socket.destroy();
            return;
        }
        receiveBuffer = processReceivedData(socket, receiveBuffer);
    });
    if (head && head.length > 0) {
        if (receiveBuffer === null) {
            return;
        }
        receiveBuffer = Buffer.concat([receiveBuffer, head]);
        if (receiveBuffer.length > MAX_BUFFER_SIZE) {
            socket.destroy();
            return;
        }
        receiveBuffer = processReceivedData(socket, receiveBuffer);
    }

    socket.on("end", () => {
        cleanupSocket(socket);
    });

    socket.on("close", () => {
        cleanupSocket(socket);
    });

    socket.on("error", (error) => {
        console.log("WebSocketエラー:", error.message);
        cleanupSocket(socket);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("サーバーが起動しました。");
    if (!process.env.PORT) {
        console.log("http://localhost:3000\r\n");
    }
});
