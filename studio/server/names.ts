// Preset names: a descriptive generator, and a linter that blocks film titles,
// credits, film-stock brands and preset vendors (docs/legal-protocol.md, Phase 3).
import type { DB } from "./db.ts";
import { filmKeyFromFilename } from "./importer.ts";

const BRANDS = [
  "adobe", "lightroom", "photoshop", "vsco", "mastin", "rni", "really nice images", "tribe archipelago", "archipelago",
  "kodak", "portra", "ektar", "ektachrome", "kodachrome", "tri-x", "trix", "gold 200", "ultramax", "colorplus",
  "fuji", "fujifilm", "velvia", "provia", "astia", "superia", "pro 400h", "acros", "classic chrome", "eterna",
  "cinestill", "ilford", "hp5", "delta", "agfa", "vista", "lomography", "lomo", "polaroid", "instax", "leica",
  "hasselblad", "canon", "nikon", "sony", "netflix", "a24", "pixar", "disney", "marvel",
];

const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "film", "unsorted", "night", "day", "man", "woman", "door", "red", "big", "four"]);

/** Words and phrases a preset name must not contain. */
export function blockedTerms(db: DB): string[] {
  const out = new Set(BRANDS);
  const films = db.prepare("SELECT title, meta_json FROM films").all() as { title: string; meta_json: string }[];
  // Film names also live in still file names ("Copshop_001.jpg"), whatever folder they're in.
  for (const r of db.prepare("SELECT path FROM refs").all() as { path: string }[]) {
    const key = filmKeyFromFilename(r.path.split("/").pop() ?? "");
    if (key) films.push({ title: key.replace(/-/g, " "), meta_json: "{}" });
  }
  for (const f of films) {
    const title = f.title.toLowerCase().trim();
    if (title && title !== "unsorted") out.add(title);
    // Distinctive single words from titles (e.g. "Copshop", "Terrifier") are blocked too.
    for (const w of title.split(/[^a-z0-9']+/)) if (w.length >= 4 && !STOP.has(w)) out.add(w);
    try {
      const meta = JSON.parse(f.meta_json) as Record<string, string>;
      for (const key of ["Director", "Director of Photography", "Production Designer", "Costume Designer"]) {
        for (const person of String(meta[key] ?? "").split(/,|&| and /)) {
          const p = person.trim().toLowerCase();
          if (p.length > 3) { out.add(p); const last = p.split(/\s+/).pop()!; if (last.length > 3) out.add(last); }
        }
      }
    } catch {}
  }
  return [...out];
}

export function lintName(name: string, blocked: string[]): string[] {
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9' -]+/g, " ")} `;
  return blocked.filter((t) => n.includes(` ${t} `) || (t.includes(" ") && n.includes(t)));
}

const ADJ: Record<string, string[]> = {
  warm: ["Amber", "Honey", "Ember", "Copper", "Sunlit", "Golden"],
  cool: ["Cobalt", "Glacier", "Slate", "Harbor", "Frost", "Indigo"],
  teal: ["Teal Ember", "Tide & Rust", "Sea Glass"],
  neon: ["Neon", "Electric", "Afterglow"],
  faded: ["Faded", "Washed", "Matte", "Dusty"],
  mono: ["Silver", "Ink", "Graphite", "Charcoal"],
  pastel: ["Pastel", "Powder", "Blush"],
  earthy: ["Clay", "Ochre", "Terracotta", "Olive"],
  dark: ["Midnight", "Low Light", "Shadow"],
  bright: ["Daylight", "Airy", "Clear"],
  green: ["Moss", "Jade", "Verdant"],
  magenta: ["Rosé", "Orchid", "Berry"],
  neutral: ["Clean", "Quiet", "Natural"],
};
const NOUN: Record<string, string[]> = {
  "Warm & cozy": ["Hearth", "Lamp", "Glow"],
  Nostalgic: ["Memory", "Postcard", "Matinee", "Reel"],
  Moody: ["Dusk", "Hush", "Storm"],
  "Dreamy & soft": ["Haze", "Bloom", "Drift"],
  "Bright & airy": ["Morning", "Breeze", "Light"],
  Cinematic: ["Frame", "Scene", "Reel", "Cut"],
  Romantic: ["Blush", "Velvet", "Bloom"],
  Vibrant: ["Pop", "Carnival", "Spark"],
  Calm: ["Still", "Calm", "Tide"],
  Melancholic: ["Rain", "Blue Hour", "Hush"],
  Gritty: ["Grit", "Static", "Concrete"],
  "Fresh & clean": ["Fresh", "Crisp", "Open"],
};

/** Descriptive name from tags, unique among existing names. */
export function suggestName(tags: { grp: string; value: string }[], existing: Set<string>, seed: number): string {
  const has = (v: string) => tags.some((t) => t.value === v);
  const pick = <T,>(arr: T[], k: number) => arr[Math.abs(k) % arr.length];
  const key =
    has("Black & white") ? "mono" : has("Teal & orange") ? "teal" : has("Neon") ? "neon" : has("Pastel") ? "pastel" : has("Faded blacks") ? "faded" :
    has("Earthy") ? "earthy" : has("Green cast") ? "green" : has("Magenta cast") ? "magenta" : has("Warm") ? "warm" : has("Cool") ? "cool" :
    has("Dark") ? "dark" : has("Bright") ? "bright" : "neutral";
  const mood = tags.find((t) => t.grp === "mood")?.value ?? "Cinematic";
  for (let i = 0; i < 30; i++) {
    const name = `${pick(ADJ[key], seed + i)} ${pick(NOUN[mood] ?? NOUN.Cinematic, seed * 7 + i * 3)}`;
    if (!existing.has(name.toLowerCase())) return name;
  }
  let n = 2;
  const base = `${pick(ADJ[key], seed)} ${pick(NOUN[mood] ?? NOUN.Cinematic, seed)}`;
  while (existing.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
