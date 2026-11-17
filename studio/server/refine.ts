// Optional: Claude compares the reference still(s) with the draft rendered on
// test photos and returns adjusted sliders, a name and a description. Runs via
// the local Claude Code CLI on the owner's plan, only when the owner clicks.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { saveSettings } from "./batches.ts";
import { runClaude } from "./claude.ts";
import { type DB, logEvent } from "./db.ts";
import { blockedTerms, lintName } from "./names.ts";
import { renderFile, SLIDER, SLIDERS, type Settings } from "./renderer.ts";
import { TAXONOMY } from "./rules.ts";
import { listTestPhotos, testDir } from "./testphotos.ts";

const W = 520, H = 347;

async function label(buf: Buffer, text: string) {
  const svg = Buffer.from(
    `<svg width="${W}" height="${H}"><rect x="8" y="8" width="${text.length * 9 + 20}" height="28" rx="6" fill="#000" fill-opacity="0.75"/>` +
      `<text x="18" y="27" font-family="Helvetica, Arial" font-size="15" font-weight="700" fill="#fff">${text}</text></svg>`,
  );
  return sharp(await sharp(buf).resize(W, H, { fit: "cover" }).toBuffer()).composite([{ input: svg }]).jpeg().toBuffer();
}

async function buildSheet(db: DB, refsDir: string, dataDir: string, refIds: number[], settings: Settings, out: string) {
  const refs = refIds.slice(0, 3).map((id) => (db.prepare("SELECT path FROM refs WHERE id = ?").get(id) as { path: string }).path);
  const photos = listTestPhotos(dataDir);
  const pick = ["Portrait", "Café", "Travel", "Food", "City"].map((s) => photos.find((p) => p.subject === s)).filter(Boolean).slice(0, 3) as typeof photos;
  const use = pick.length >= 2 ? pick : photos.slice(0, 3);
  const left = await Promise.all(refs.map(async (p, i) => label(await sharp(join(refsDir, p)).toBuffer(), `REFERENCE ${i + 1}`)));
  const right = await Promise.all(use.map(async (p) => label(await renderFile(join(testDir(dataDir), p.file), settings, W), `PRESET ON ${p.subject.toUpperCase()}`)));
  const rows = Math.max(left.length, right.length);
  await sharp({ create: { width: W * 2 + 12, height: rows * (H + 8) - 8, channels: 3, background: "#ffffff" } })
    .composite([
      ...left.map((b, i) => ({ input: b, left: 0, top: i * (H + 8) })),
      ...right.map((b, i) => ({ input: b, left: W + 12, top: i * (H + 8) })),
    ])
    .jpeg({ quality: 85 })
    .toFile(out);
}

function prompt(file: string, settings: Settings, name: string, note: string) {
  const keys = SLIDERS.map((s) => `${s.key} (${s.min}..${s.max})`).join(", ");
  return `Read the image ${file}. Left column: REFERENCE film still(s) whose colour grading we want as a Lightroom preset. Right column: our current draft preset applied to everyday test photos.

Goal: adjust the preset so the test photos take on the reference's GRADE (tone curve, contrast, black level, white balance, colour palette, shadow/highlight colour, saturation, grain, vignette) — not its lighting, subject or exposure. It must still flatter everyday photos (skin, food, travel): avoid extreme casts.

Current settings (Lightroom crs names; "Fade" lifts the blacks): ${JSON.stringify(settings)}
Current name: ${name}
${note ? `Owner's note: ${note}\n` : ""}
Allowed keys and ranges: ${keys}, ConvertToGrayscale ("True" for black and white). Omit keys that should be 0.

Also give: a fresh preset name (2-3 evocative words; NO film titles, people, studios, film-stock or camera brands, preset vendors), a one-sentence description, 1-3 goodFor and 1-2 mood labels from:
goodFor: ${TAXONOMY.goodFor.join(" | ")}
mood: ${TAXONOMY.mood.join(" | ")}

Reply with JSON only:
{"settings":{...},"name":"...","description":"...","goodFor":["..."],"mood":["..."]}`;
}

function clean(raw: Record<string, unknown>): Settings {
  const out: Settings = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k === "ConvertToGrayscale") { if (/^true$/i.test(String(v))) out.ConvertToGrayscale = "True"; continue; }
    const def = SLIDER[k];
    const n = Number(v);
    if (!def || !Number.isFinite(n)) continue;
    const c = k.endsWith("Hue") ? ((Math.round(n) % 360) + 360) % 360 : Math.max(def.min, Math.min(def.max, n));
    if (c !== 0) out[k] = def.step < 1 ? Math.round(c * 100) / 100 : Math.round(c);
  }
  return out;
}

export async function refineDraft(db: DB, refsDir: string, dataDir: string, draftId: number, note = ""): Promise<{ name: string; changed: number }> {
  const d = db.prepare("SELECT ref_ids_json, settings_json, name, tags_json FROM drafts WHERE id = ?").get(draftId) as
    | { ref_ids_json: string; settings_json: string; name: string; tags_json: string }
    | undefined;
  if (!d) throw new Error("Draft not found");
  const settings = JSON.parse(d.settings_json) as Settings;
  const dir = join(dataDir, "sheets");
  mkdirSync(dir, { recursive: true });
  const file = `refine-${draftId}-${Date.now()}.jpg`;
  await buildSheet(db, refsDir, dataDir, JSON.parse(d.ref_ids_json), settings, join(dir, file));
  const { stdout } = await runClaude(dir, prompt(file, settings, d.name, note));
  const outer = JSON.parse(stdout);
  const text = String(outer.result ?? "");
  const obj = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
    settings?: Record<string, unknown>; name?: string; description?: string; goodFor?: string[]; mood?: string[];
  };
  const next = clean(obj.settings ?? {});
  if (!Object.keys(next).length) throw new Error("Claude returned no usable settings");
  saveSettings(db, draftId, next, "claude", note ? `Claude: ${note}` : "Claude refine");
  const changed = new Set([...Object.keys(settings), ...Object.keys(next)].filter((k) => settings[k] !== next[k])).size;

  let name = d.name;
  if (obj.name && !lintName(obj.name, blockedTerms(db)).length) name = obj.name.trim().slice(0, 60);
  const tags = JSON.parse(d.tags_json) as { grp: string; value: string }[];
  const add = (grp: "goodFor" | "mood", vals?: string[]) => {
    const valid = new Set<string>(TAXONOMY[grp]);
    const picked = (vals ?? []).filter((v) => valid.has(v));
    return picked.length ? picked.map((value) => ({ grp, value })) : tags.filter((t) => t.grp === grp);
  };
  const merged = [...add("goodFor", obj.goodFor), ...add("mood", obj.mood), ...tags.filter((t) => t.grp !== "goodFor" && t.grp !== "mood")];
  db.prepare("UPDATE drafts SET name = ?, description = COALESCE(?, description), tags_json = ? WHERE id = ?")
    .run(name, obj.description ? obj.description.slice(0, 300) : null, JSON.stringify(merged), draftId);
  logEvent(db, "claude-refine", { draftId, changed, name });
  return { name, changed };
}
