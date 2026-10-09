import path from "node:path";

export const DEFAULT_PATH = path.join("../", import.meta.dirname);
export const PORT = Number(process.env.PORT ?? 3000);
export const isLocal = (process.env.PORT === undefined);
export const MYME_TYPES = {
    ".txt": "text/plain; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".ico": "image/x-icon",
};
