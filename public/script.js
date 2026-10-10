(() => {
    const canvas = document.getElementById("gamecanvas");
    const ctx = canvas.getContext("2d");
    const websocketProtocol = ((location.protocol === "https:") ? "wss:" : "ws:");
    const socket = new WebSocket(`${websocketProtocol}//${location.host}`);

    const messageInput = document.getElementById("messageInput");
    const sendButton = document.getElementById("sendButton");
    const messages = document.getElementById("messages");
    function addMessage(message) {
        const messageElement = document.createElement("div");
        messageElement.textContent = message;
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
    }
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message !== "" && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "chat", message: message }));
            messageInput.value = "";
        }
    }
    sendButton.addEventListener("click", sendMessage);
    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            sendMessage();
        }
    });

    const inputState = {
        up: false,
        down: false,
        left: false,
        right: false,
        isPainting: false,
        isShooting: false,
        pointerX: 0,
        pointerY: 0,
    };
    const keys = {};
    window.addEventListener("keydown", (event) => {
        keys[event.code] = true;
        if (event.key === "Enter" && !event.isComposing) {
            if (document.activeElement === messageInput) {
                event.preventDefault();
                messageInput.blur();
            } else {
                event.preventDefault();
                messageInput.focus();
            }
        }
    });
    window.addEventListener("keyup", (event) => {
        keys[event.code] = false;
    });

    let players = new Map();
    let bullets = new Set();
    let playerId = null;
    let map = [];
    let teamPoint = null;
    window.addEventListener("beforeunload", () => {
        socket.close();
    });

    canvas.addEventListener("pointermove", (event) => {
        const rect = canvas.getBoundingClientRect();
        inputState.pointerX = event.clientX - rect.left;
        inputState.pointerY = event.clientY - rect.top;
    });
    canvas.addEventListener("pointerdown", (event) => {
        const rect = canvas.getBoundingClientRect();
        inputState.pointerX = event.clientX - rect.left;
        inputState.pointerY = event.clientY - rect.top;
        inputState.isShooting = true;
    });
    canvas.addEventListener("pointerup", (event) => {
        const rect = canvas.getBoundingClientRect();
        inputState.pointerX = event.clientX - rect.left;
        inputState.pointerY = event.clientY - rect.top;
        inputState.isShooting = false;
    });
    canvas.addEventListener("pointercancel", () => {
        inputState.isShooting = false;
    });

    socket.addEventListener("message", (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "init") {
                playerId = data.playerId;
                map = data.map;
                bullets = new Set(data.bullets);
                teamPoint = data.teamPoint;
                for (const p of data.players) {
                    players.set(p.id, p);
                }
                addMessage("Connected to the server.");
                addMessage("Your ID: " + playerId);
                addMessage("Your team: " + (players.get(playerId).team === "R" ? "Red" : "Blue"));
            } else if (data.type === "playerLeft") {
                players.delete(data.playerId);
                addMessage(data.playerId + " left the game.");
            } else if (data.type === "playerUpdate") {
                players.set(data.playerId, data.player);
            } else if (data.type === "playerDied") {
                addMessage(data.died + " was killed by " + data.kill + ".");
            } else if (data.type === "playerSpawn") {
                players.set(data.player.id, data.player);
            } else if (data.type === "updateTeamPoint") {
                teamPoint = data.teamPoint;
            } else if (data.type === "chat") {
                addMessage(data.message);
            } else if (data.type === "paint") {
                map[data.paintedY] = data.str;
            } else if (data.type === "addBullet") {
                bullets.add(data.bullet);
            } else if (data.type === "deleteBullet") {
                for (const b of bullets) {
                    if (b.bulletId === data.bullet.bulletId) {
                        bullets.delete(b);
                        break;
                    }
                }
            } else if (data.type === "updateBullet") {
                for (const b of bullets) {
                    if (b.bulletId === data.bullet.bulletId) {
                        b.x = data.bullet.x;
                        b.y = data.bullet.y;
                        break;
                    }
                }
            }
        } catch (error) {
            console.log("受信エラー");
            console.log(error);
        }
    });
    socket.addEventListener("close", (event) => {
        addMessage("Disconnected from the server.");
        addMessage("Code: " + event.code);
        if (event.reason && event.reason !== "") {
            addMessage("Reason: " + event.reason);
        }
    });
    socket.addEventListener("error", (event) => {
        console.log("WebSocketエラー: ", event);
        addMessage("An error has occurred in the WebSocket connection.");
    });

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", () => {
        setTimeout(() => { resizeCanvas(); }, 50);
    });
    resizeCanvas();
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const you = players.get(playerId);
        if (!you) {
            return;
        }
        for (let y = 0; y < map.length; y++) {
            for (let x = 0; x < map[y].length; x++) {
                if (map[y][x] === ".") {
                    ctx.fillStyle = "rgba(0, 0, 0, 1)";
                } else if (map[y][x] === "#") {
                    ctx.fillStyle = "rgba(127, 127, 127, 1)";
                } else if (map[y][x] === "R") {
                    ctx.fillStyle = "rgba(127, 0, 0, 1)";
                } else if (map[y][x] === "G") {
                    ctx.fillStyle = "rgba(0, 127, 0, 1)";
                } else if (map[y][x] === "B") {
                    ctx.fillStyle = "rgba(0, 0, 127, 1)";
                }
                ctx.fillRect((x - you.x) * 64 + centerX - 1, (y - you.y) * 64 + centerY - 1, 64 + 1, 64 + 1);
            }
        }
        for (const b of bullets) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = b.bulletTeam === "R" ? "rgba(255, 0, 0, 1)" : "rgba(0, 0, 255, 1)";
            ctx.beginPath();
            ctx.arc((b.x - you.x) * 64 + centerX, (b.y - you.y) * 64 + centerY, 4, 0, Math.PI * 2);
            ctx.stroke();
        }
        for (const p of players.keys()) {
            if (players.get(p).team === "B") {
                ctx.strokeStyle = "rgba(0, 0, 255, 1)";
            } else {
                ctx.strokeStyle = "rgba(255, 0, 0, 1)";
            }
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc((players.get(p).x - you.x) * 64 + centerX + 16, (players.get(p).y - you.y) * 64 + centerY + 16, 16, 0, Math.PI * 2);
            ctx.stroke();
            if (players.get(p).isShooting) {
                ctx.lineWidth = 6;
            }
            ctx.beginPath();
            ctx.moveTo((players.get(p).x - you.x) * 64 + centerX + 16, (players.get(p).y - you.y) * 64 + centerY + 16);
            ctx.lineTo((players.get(p).x - you.x) * 64 + centerX + 16 + players.get(p).directionX * 16, (players.get(p).y - you.y) * 64 + centerY + 16 + players.get(p).directionY * 16);
            ctx.stroke();
            if (players.get(p).shooted) {
                ctx.fillStyle = "rgba(255, 127, 0, 1)";
                ctx.beginPath();
                ctx.arc((players.get(p).x - you.x) * 64 + centerX + 16 + players.get(p).directionX * 16, (players.get(p).y - you.y) * 64 + centerY + 16 + players.get(p).directionY * 16, 6, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.strokeStyle = "rgba(255, 255, 255, 1)";
            ctx.lineWidth = 1;
            ctx.strokeRect((players.get(p).x - you.x) * 64 + centerX, (players.get(p).y - you.y) * 64 + centerY - 16, 32, 8);
            if (players.get(p).hp >= 80) {
                ctx.fillStyle = "rgba(0, 255, 0, 0.5)";
            } else if (players.get(p).hp >= 30) {
                ctx.fillStyle = "rgba(255, 255, 0, 0.5)";
            } else {
                ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
            }
            const hpWidth = Math.max(0, Math.min(32, (players.get(p).hp / 100) * 32));
            ctx.fillRect((players.get(p).x - you.x) * 64 + centerX, (players.get(p).y - you.y) * 64 + centerY - 16, hpWidth, 8);
        }
        ctx.font = "24px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "rgba(255, 0, 0, 1)";
        ctx.fillRect(centerX - 56, 12, 48, 24);
        ctx.fillStyle = "rgba(0, 0, 255, 1)";
        ctx.fillRect(centerX + 8, 12, 48, 24);

        ctx.fillStyle = "rgba(255, 255, 255, 1)";
        ctx.fillText(teamPoint.R, centerX - 32, 24);
        ctx.fillText(teamPoint.B, centerX + 32, 24);
    }
    function keysInput() {
        if (document.activeElement !== messageInput) {
            inputState.up = (keys["KeyW"] || keys["KeyI"] || keys["ArrowUp"]);
            inputState.down = (keys["KeyS"] || keys["KeyK"] || keys["ArrowDown"]);
            inputState.left = (keys["KeyA"] || keys["KeyJ"] || keys["ArrowLeft"]);
            inputState.right = (keys["KeyD"] || keys["KeyL"] || keys["ArrowRight"]);
            inputState.isPainting = (keys["ShiftLeft"] || keys["KeyG"] || keys["Space"]);
        }
    }
    function sendState() {
        if (socket.readyState === WebSocket.OPEN) {
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const dx = inputState.pointerX - (centerX + 16);
            const dy = inputState.pointerY - (centerY + 16);
            const length = Math.hypot(dx, dy);
            const directionX = dx / length;
            const directionY = dy / length;
            socket.send(JSON.stringify({
                type: "state", state: {
                    up: inputState.up,
                    down: inputState.down,
                    left: inputState.left,
                    right: inputState.right,
                    isPainting: inputState.isPainting,
                    isShooting: inputState.isShooting,
                    directionX: directionX,
                    directionY: directionY
                }
            }));
        }
    }
    function mainLoop() {
        draw();
        keysInput();
        sendState();
        setTimeout(mainLoop, 1000 / 60);
    }
    mainLoop();
})();