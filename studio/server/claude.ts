// Optional second pass: ask Claude (via the local Claude Code CLI, on the
// owner's plan — no API key) to tag stills the free rules were unsure about.
// Stills go in numbered contact sheets of up to 20 so one request covers many.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { type DB, logEvent } from "./db.ts";
import { TAXONOMY } from "./rules.ts";

export const PER_SHEET = 20;
const COLS = 5;
const TILE_W = 360;
const TILE_H = 203;

export function unclearRefs(db: DB): { id: number; path: string }[] {
  return db
    .prepare(
      `SELECT r.id, r.path FROM refs r JOIN analyses a ON a.ref_id = r.id
        WHERE r.missing = 0 AND r.excluded = 0 AND r.dup_of IS NULL AND a.unclear = 1 ORDER BY r.id`,
    )
    .all() as { id: number; path: string }[];
}

async function buildSheet(refsDir: string, refs: { id: number; path: string }[], out: string) {
  const rows = Math.ceil(refs.length / COLS);
  const tiles = await Promise.all(
    refs.map(async (r, i) => {
      const img = await sharp(join(refsDir, r.path)).rotate().resize(TILE_W, TILE_H, { fit: "cover" }).toBuffer();
      const label = Buffer.from(
        `<svg width="${TILE_W}" height="${TILE_H}"><rect x="6" y="6" width="42" height="30" rx="6" fill="#000" fill-opacity="0.75"/>` +
          `<text x="27" y="28" font-family="Helvetica, Arial" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`,
      );
      const tile = await sharp(img).composite([{ input: label }]).toBuffer();
      return { input: tile, left: (i % COLS) * (TILE_W + 6), top: Math.floor(i / COLS) * (TILE_H + 6) };
    }),
  );
  await sharp({ create: { width: COLS * (TILE_W + 6) - 6, height: rows * (TILE_H + 6) - 6, channels: 3, background: "#ffffff" } })
    .composite(tiles)
    .jpeg({ quality: 85 })
    .toFile(out);
}

function prompt(sheet: string, n: number) {
  return `Read the image ${sheet}. It is a contact sheet of ${n} film stills, numbered 1 to ${n} in their top-left corners.

For each still, judge only its COLOUR GRADING (tones, contrast, colour palette, mood of the grade), not the subject or story. We are deciding which Lightroom-preset audiences this grade would suit.

Use ONLY these exact labels:
- mood (1-3): ${TAXONOMY.mood.join(" | ")}
- goodFor (1-3, whose everyday photos this grade would flatter): ${TAXONOMY.goodFor.join(" | ")}
- light (0-2): ${TAXONOMY.light.join(" | ")}

Reply with JSON only, no prose:
{"items":[{"n":1,"mood":["..."],"goodFor":["..."],"light":["..."]}, ...]}`;
}

type Item = { n: number; mood?: string[]; goodFor?: string[]; light?: string[] };

function parseItems(stdout: string): Item[] {
  const outer = JSON.parse(stdout);
  const candidate = outer.structured_output ?? outer.result ?? outer;
  const obj = typeof candidate === "string" ? JSON.parse(candidate.slice(candidate.indexOf("{"), candidate.lastIndexOf("}") + 1)) : candidate;
  if (!Array.isArray(obj.items)) throw new Error("Claude reply had no items");
  return obj.items;
}

export function runClaude(cwd: string, text: string): Promise<{ stdout: string; costUsd?: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", text, "--output-format", "json", "--allowedTools", "Read", "--add-dir", cwd], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? "Claude Code CLI not found (install it and sign in first)" : e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().slice(0, 300) || `claude exited with ${code}`));
      let costUsd: number | undefined;
      try { costUsd = JSON.parse(out).total_cost_usd; } catch {}
      resolve({ stdout: out, costUsd });
    });
  });
}

export interface ClaudeResult { sheets: number; tagged: number; failed: number; errors: string[] }

export async function claudePass(db: DB, refsDir: string, dataDir: string, onProgress?: (msg: string) => void): Promise<ClaudeResult> {
  const refs = unclearRefs(db);
  const sheetsDir = join(dataDir, "sheets");
  mkdirSync(sheetsDir, { recursive: true });
  const result: ClaudeResult = { sheets: 0, tagged: 0, failed: 0, errors: [] };
  const valid = { mood: new Set<string>(TAXONOMY.mood), goodFor: new Set<string>(TAXONOMY.goodFor), light: new Set<string>(TAXONOMY.light) };
  const clearClaude = db.prepare("DELETE FROM tags WHERE ref_id = ? AND source = 'claude'");
  const removedByOwner = db.prepare("SELECT 1 FROM tags WHERE ref_id = ? AND grp = ? AND value = ? AND source = 'owner-removed'");
  const add = db.prepare(
    `INSERT INTO tags (ref_id, grp, value, confidence, source) VALUES (?, ?, ?, 0.8, 'claude')
     ON CONFLICT(ref_id, grp, value) DO UPDATE SET confidence = 0.8, source = 'claude' WHERE source = 'rules'`,
  );
  const settle = db.prepare("UPDATE analyses SET unclear = 0 WHERE ref_id = ?");

  for (let s = 0; s < refs.length; s += PER_SHEET) {
    const chunk = refs.slice(s, s + PER_SHEET);
    const name = `sheet-${Date.now()}-${s / PER_SHEET + 1}.jpg`;
    onProgress?.(`Sheet ${s / PER_SHEET + 1} of ${Math.ceil(refs.length / PER_SHEET)}…`);
    try {
      await buildSheet(refsDir, chunk, join(sheetsDir, name));
      const { stdout } = await runClaude(sheetsDir, prompt(name, chunk.length));
      const items = parseItems(stdout);
      for (const it of items) {
        const ref = chunk[it.n - 1];
        if (!ref) continue;
        clearClaude.run(ref.id);
        for (const grp of ["mood", "goodFor", "light"] as const) {
          for (const value of it[grp] ?? []) {
            if (valid[grp].has(value) && !removedByOwner.get(ref.id, grp, value)) add.run(ref.id, grp, value);
          }
        }
        settle.run(ref.id);
        result.tagged += 1;
      }
      result.sheets += 1;
    } catch (e) {
      result.failed += chunk.length;
      result.errors.push((e as Error).message);
      if (/not found/.test((e as Error).message)) break;
    }
  }
  logEvent(db, "claude-tags", result);
  return result;
}
