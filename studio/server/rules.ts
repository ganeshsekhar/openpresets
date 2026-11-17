// Free first-pass tags from colour metrics. Each tag gets a confidence 0–1;
// stills where no Mood or Good-for tag is confident are marked "unclear" and
// can be sent to Claude. Thresholds are tuned for film stills (darker than
// phone photos: median L* ≈ 32).
import type { Metrics } from "./analysis.ts";

export const TAXONOMY = {
  goodFor: [
    "Cafés & restaurants",
    "Influencers & lifestyle",
    "Travel",
    "Brands & marketing",
    "Portraits & people",
    "Night & city",
    "Everyday phone photos",
    "Photographers",
  ],
  mood: [
    "Warm & cozy",
    "Nostalgic",
    "Moody",
    "Dreamy & soft",
    "Bright & airy",
    "Cinematic",
    "Romantic",
    "Vibrant",
    "Calm",
    "Melancholic",
    "Gritty",
    "Fresh & clean",
  ],
  color: [
    "Warm",
    "Cool",
    "Neutral",
    "Bright",
    "Dark",
    "Faded blacks",
    "High contrast",
    "Soft contrast",
    "Teal & orange",
    "Neon",
    "Pastel",
    "Earthy",
    "Muted",
    "Green cast",
    "Magenta cast",
    "Black & white",
  ],
  light: ["Night", "Golden hour", "Overcast", "Summer", "Autumn", "Winter"],
} as const;

export type Group = keyof typeof TAXONOMY;
export const GROUPS = Object.keys(TAXONOMY) as Group[];
export const GROUP_LABEL: Record<Group, string> = { goodFor: "Good for", mood: "Mood", color: "Colour", light: "Light & season" };

export interface Tag {
  grp: Group;
  value: string;
  confidence: number;
}

export const KEEP = 0.55; // tags below this are dropped
export const SURE = 0.65; // a still is "clear" with a Mood and a Good-for at or above this

const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** Confidence that x is above t; `scale` = distance over which it goes from 0.5 to ~1. */
const above = (x: number, t: number, scale: number) => clamp(0.5 + (x - t) / (2 * scale));
const below = (x: number, t: number, scale: number) => clamp(0.5 + (t - x) / (2 * scale));
const within = (x: number, lo: number, hi: number, scale: number) => Math.min(above(x, lo, scale), below(x, hi, scale));
const all = (...c: number[]) => Math.min(...c);
const any = (...c: number[]) => Math.max(...c);
const hueIn = (h: number, lo: number, hi: number) => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);
const dominantHue = (m: Metrics) => {
  let best = 0;
  m.hues.forEach((v, i) => { if (v > m.hues[best]) best = i; });
  return best * 30 + 15;
};

export function tagsFor(m: Metrics): { tags: Tag[]; unclear: boolean } {
  const s: Partial<Record<`${Group}:${string}`, number>> = {};
  const set = (grp: Group, value: string, c: number) => { s[`${grp}:${value}`] = c; };
  const mono = m.mono ? 1 : 0;
  const color = 1 - mono;

  // ---- colour character ----
  const warm = above(m.warmth, 10, 6) * color;
  const cool = below(m.warmth, -4, 5) * color;
  set("color", "Warm", warm);
  set("color", "Cool", cool);
  set("color", "Neutral", Math.min(within(m.warmth, -4, 10, 4), within(m.tint, -7, 7, 4)) * color);
  set("color", "Bright", above(m.lMean, 50, 8));
  set("color", "Dark", below(m.lMean, 25, 6));
  const faded = above(m.p01, 6, 3);
  set("color", "Faded blacks", faded);
  const hiCon = above(m.contrast, 75, 8);
  const softCon = below(m.contrast, 45, 7);
  set("color", "High contrast", hiCon);
  set("color", "Soft contrast", softCon);
  const tealOrange =
    color *
    (hueIn(m.shadow.hue, 150, 250) && m.shadow.chroma > 4 ? 1 : 0) *
    any(above(m.warmth, 4, 4), hueIn(m.highlight.hue, 30, 100) ? above(m.highlight.chroma, 8, 4) : 0, above(m.skin, 0.08, 0.04));
  set("color", "Teal & orange", tealOrange);
  const dh = dominantHue(m);
  const neon = color * all(above(m.chromaP90, 30, 6), below(m.lMean, 38, 8), hueIn(dh, 270, 360) || hueIn(dh, 180, 240) || hueIn(dh, 0, 15) ? 1 : 0.3);
  set("color", "Neon", neon);
  const pastel = color * all(above(m.lMean, 48, 6), within(m.chroma, 6, 16, 3), below(m.contrast, 62, 8));
  set("color", "Pastel", pastel);
  const earthy = color * all(within(m.warmth, 5, 22, 4), within(m.chroma, 8, 18, 4), hueIn(dh, 30, 90) ? 1 : 0.2);
  set("color", "Earthy", earthy);
  const muted = color * below(m.chroma, 8, 2.5);
  set("color", "Muted", muted);
  set("color", "Green cast", color * below(m.tint, -10, 4));
  set("color", "Magenta cast", color * above(m.tint, 10, 4));
  set("color", "Black & white", mono);

  // ---- mood ----
  const cozy = color * all(warm, within(m.lMean, 20, 58, 6), below(m.contrast, 72, 8));
  set("mood", "Warm & cozy", cozy);
  set("mood", "Nostalgic", any(faded * above(m.warmth, 0, 6), color * all(above(m.warmth, 8, 5), below(m.chroma, 14, 4), below(m.contrast, 60, 8))));
  const moody = all(below(m.lMean, 30, 6), any(below(m.chroma, 14, 4), below(m.warmth, 2, 4), mono));
  set("mood", "Moody", moody);
  set("mood", "Dreamy & soft", all(softCon, above(m.lMean, 35, 6)));
  const airy = all(above(m.lMean, 52, 6), below(m.contrast, 72, 8), below(m.chroma, 18, 4));
  set("mood", "Bright & airy", airy);
  set("mood", "Cinematic", any(tealOrange, all(above(m.contrast, 60, 8), above(m.shadow.chroma, 6, 3), below(m.lMean, 45, 8)) * color));
  set("mood", "Romantic", color * all(above(m.tint, 5, 4), above(m.warmth, 3, 4), below(m.contrast, 66, 8)));
  const vibrant = color * any(above(m.chroma, 18, 4), above(m.chromaP90, 34, 6));
  set("mood", "Vibrant", vibrant);
  set("mood", "Calm", all(below(m.contrast, 50, 7), below(m.chroma, 12, 3), above(m.lMean, 25, 6)));
  set("mood", "Melancholic", color * all(below(m.warmth, 0, 4), below(m.lMean, 40, 6), below(m.chroma, 14, 4)));
  const gritty = all(above(m.contrast, 70, 8), any(below(m.chroma, 12, 3), mono));
  set("mood", "Gritty", gritty);
  const fresh = color * all(above(m.lMean, 45, 6), within(m.warmth, -8, 8, 3), within(m.tint, -6, 6, 3), below(m.p01, 5, 2), within(m.chroma, 8, 20, 3));
  set("mood", "Fresh & clean", fresh);

  // ---- light & season ----
  set("light", "Night", below(m.lMean, 20, 5));
  set("light", "Golden hour", color * all(above(m.warmth, 15, 5), hueIn(m.highlight.hue, 50, 95) ? above(m.highlight.chroma, 12, 4) : 0));
  set("light", "Overcast", all(below(m.contrast, 50, 6), within(m.warmth, -6, 6, 3), below(m.chroma, 10, 3), above(m.lMean, 30, 6)));
  set("light", "Summer", color * all(above(m.lMean, 45, 6), above(m.chroma, 14, 4), above(m.warmth, 0, 4)));
  set("light", "Autumn", earthy * above(m.warmth, 8, 4));
  set("light", "Winter", color * all(below(m.warmth, -4, 4), above(m.lMean, 40, 6), below(m.chroma, 14, 4)));

  // ---- good for (does the grade suit that audience's photos?) ----
  const skinSafe = color * all(above(m.tint, -6, 4), above(m.warmth, -2, 4));
  set("goodFor", "Cafés & restaurants", color * all(above(m.warmth, 6, 4), above(m.lMean, 22, 6), above(m.tint, -6, 4), below(m.p01, 12, 4)));
  set("goodFor", "Influencers & lifestyle", any(airy, pastel, cozy * above(m.lMean, 30, 6), s["mood:Dreamy & soft"] ?? 0) * skinSafe);
  set("goodFor", "Travel", any(vibrant * above(m.lMean, 30, 6), fresh, color * all(cool, above(m.lMean, 35, 6))));
  set("goodFor", "Brands & marketing", any(fresh, color * all(within(m.warmth, -6, 8, 3), within(m.contrast, 45, 75, 6), above(m.lMean, 35, 6), below(m.p01, 6, 2))));
  set("goodFor", "Portraits & people", all(above(m.skin, 0.08, 0.04), skinSafe));
  set("goodFor", "Night & city", all(below(m.lMean, 26, 6), any(neon, cool, above(m.chroma, 14, 4))));
  set("goodFor", "Everyday phone photos", color * all(within(m.contrast, 45, 75, 6), within(m.warmth, -10, 14, 4), within(m.chroma, 8, 20, 3), above(m.lMean, 28, 6)));
  set("goodFor", "Photographers", any(mono, gritty, s["mood:Cinematic"] ?? 0, hiCon));

  const tags: Tag[] = [];
  for (const [key, c] of Object.entries(s)) {
    if (c === undefined || c < KEEP) continue;
    const [grp, ...rest] = key.split(":");
    tags.push({ grp: grp as Group, value: rest.join(":"), confidence: Math.round(c * 100) / 100 });
  }
  // Colour: only the strongest few, so chips stay readable.
  const top = (grp: Group, n: number) => tags.filter((t) => t.grp === grp).sort((a, b) => b.confidence - a.confidence).slice(n);
  const drop = new Set([...top("color", 4), ...top("mood", 3), ...top("goodFor", 3), ...top("light", 2)]);
  const kept = tags.filter((t) => !drop.has(t));
  const sure = (grp: Group) => kept.some((t) => t.grp === grp && t.confidence >= SURE);
  return { tags: kept, unclear: !(sure("mood") && sure("goodFor")) };
}
