import { map } from "./map.js";

function createInitialGameState() {
    return {
        map: [...map],
        players: new Map(),
        playerStates: new Map(),
        sockets: new Set(),
        playerIdsBySockets: new Map(),
        teamPoint: { "R": 0, "B": 0 },
        playerCount: { "R": 0, "B": 0 },
        time: 0,
    };
}

export class Game {
    constructor() {
        this.state = createInitialGameState();
    }

    update() {
        for (const id of this.state.playerIdsBySockets.values()) {
            const playerState = this.state.playerStates.get(id);
        }
        this.tick();
    }

    tick() {
        this.state.time++;
    }
}