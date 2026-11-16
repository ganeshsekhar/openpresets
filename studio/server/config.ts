import { homedir } from "node:os";
import { join } from "node:path";

// All Studio data lives outside the repo so reference stills can never be committed.
export const DATA_DIR = process.env.OP_DATA ?? join(homedir(), "OpenPresets-data");
export const REFS_DIR = join(DATA_DIR, "refs");
export const THUMBS_DIR = join(DATA_DIR, "thumbs");
export const DB_PATH = join(DATA_DIR, "openpresets.sqlite");

// Localhost only for now; LAN access for phone review comes later.
export const HOST = process.env.OP_HOST ?? "127.0.0.1";
export const PORT = Number(process.env.OP_PORT ?? 4317);

export const IMAGE_EXT = /\.(jpe?g|png|webp|tiff?)$/i;
export const THUMB_WIDTH = 480;
