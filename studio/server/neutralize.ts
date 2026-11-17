// Stock photos (Unsplash etc.) usually arrive already graded. Applying a preset
// on top of someone else's grade misrepresents it, and fitting against graded
// photos skews the drafts. So every stock test photo gets a "neutral base":
// measured once, then corrected towards a plain camera-like starting point
// (grey-world white balance, black/white levels, mid-tone and saturation).
// Bases are cached in <data>/test-photos/.neutral/ and used for previews,
// fitting, Claude refine and the published before/after images.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

export const NEUTRAL_VERSION = 3;

export interface Neutral {
  v: number;
  gains: [number, number, number]; // linear RGB white-balance gains
  black: number; // sRGB levels in/out
  white: number;
  gamma: number;
  sat: number; // saturation multiplier around luma
  flags: string[]; // why a photo may be a poor base (heavy edit, B&W…)
  mono: boolean;
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

/** Measure how far a photo is from a neutral base (pure function on RGB pixels). */
export function measureRaw(px: Uint8Array | Buffer, w: number, h: number, ch: number): Neutral {
  let sr = 0, sg = 0, sb = 0, n = 0, chromaSum = 0, cn = 0;
  const lum: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const r = px[i * ch] / 255, g = px[i * ch + 1] / 255, b = px[i * ch + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum.push(y);
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    if (y > 0.12 && y < 0.88) { chromaSum += c; cn++; }
    // Grey-world over mid-tones that aren't strongly coloured (skip sky/foliage/neon dominance).
    if (y > 0.15 && y < 0.85 && c < 0.35) { sr += toLin(r); sg += toLin(g); sb += toLin(b); n++; }
  }
  lum.sort((a, b) => a - b);
  const chroma = cn ? chromaSum / cn : 0;
  const mono = chroma < 0.025;
  const flags: string[] = [];
  if (mono) flags.push("Black & white: colour presets can't show on it");

  // White balance (partial, clamped: real scenes aren't grey).
  let gains: [number, number, number] = [1, 1, 1];
  if (!mono && n > 50) {
    const m = (sr + sg + sb) / (3 * n); // mean linear level of the grey-ish mid-tones
    const raw = [m / (sr / n || m), m / (sg / n || m), m / (sb / n || m)];
    const dev = Math.max(...raw.map((x) => Math.abs(Math.log(x))));
    if (dev > 0.4) flags.push("Strong colour cast");
    gains = raw.map((x) => clamp(1 + (x - 1) * 0.45, 0.88, 1.13)) as [number, number, number];
    const gm = Math.cbrt(gains[0] * gains[1] * gains[2]);
    gains = gains.map((x) => x / gm) as [number, number, number];
  }

  // Levels: pull lifted blacks down and dull whites up, never fully.
  const p0 = pct(lum, 0.005), p1 = pct(lum, 0.995);
  if (p0 > 0.12) flags.push("Faded blacks");
  if (p1 < 0.7) flags.push("Dull highlights");
  const black = clamp((p0 - 0.02) * 0.85, 0, 0.25);
  let white = clamp(p1 + 0.02, 0.6, 1);
  white = white + (1 - white) * 0.15;

  // Mid-tones towards a typical exposure, gently.
  const mid = clamp((pct(lum, 0.5) - black) / (white - black), 0.05, 0.95);
  const gamma = clamp(1 + (Math.log(0.46) / Math.log(mid) - 1) * 0.4, 0.8, 1.25);

  // Saturation towards typical camera output.
  const sat = mono ? 1 : clamp(Math.sqrt(0.22 / Math.max(chroma, 0.02)), 0.8, 1.3);
  if (!mono && chroma < 0.08) flags.push("Very muted colour");
  if (chroma > 0.42) flags.push("Very saturated");

  return { v: NEUTRAL_VERSION, gains, black, white, gamma, sat, flags, mono };
}

/** Apply a neutral correction in place (sRGB 8-bit pixels). */
export function applyNeutral(px: Uint8Array | Buffer, w: number, h: number, ch: number, nt: Neutral) {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = toLin(i / 255);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    let r = toSrgb(clamp(lut[px[o]] * nt.gains[0], 0, 1));
    let g = toSrgb(clamp(lut[px[o + 1]] * nt.gains[1], 0, 1));
    let b = toSrgb(clamp(lut[px[o + 2]] * nt.gains[2], 0, 1));
    const lv = (c: number) => clamp((c - nt.black) / (nt.white - nt.black), 0, 1) ** nt.gamma;
    r = lv(r); g = lv(g); b = lv(b);
    if (nt.sat !== 1) {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = y + (r - y) * nt.sat; g = y + (g - y) * nt.sat; b = y + (b - y) * nt.sat;
    }
    px[o] = Math.round(clamp(r, 0, 1) * 255);
    px[o + 1] = Math.round(clamp(g, 0, 1) * 255);
    px[o + 2] = Math.round(clamp(b, 0, 1) * 255);
  }
}

const neutralDir = (testDir: string) => join(testDir, ".neutral");

export async function measureFile(path: string): Promise<Neutral> {
  const { data, info } = await sharp(path).rotate().resize({ width: 400, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return measureRaw(data, info.width, info.height, info.channels);
}

/** Cached measurement for a test photo (re-measured if the file changes). */
export async function neutralFor(testDir: string, file: string): Promise<Neutral> {
  const src = join(testDir, file);
  const cache = join(neutralDir(testDir), `${file}.json`);
  const mtime = statSync(src).mtimeMs;
  try {
    const c = JSON.parse(readFileSync(cache, "utf8"));
    if (c.mtime === mtime && c.n?.v === NEUTRAL_VERSION) return c.n;
  } catch {}
  const n = await measureFile(src);
  mkdirSync(neutralDir(testDir), { recursive: true });
  const tmp = `${cache}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mtime, n }));
  renameSync(tmp, cache);
  return n;
}

/**
 * Path of the image to use as the base for a test photo: a cached full-size
 * neutral JPEG.
 */
export async function basePath(testDir: string, file: string): Promise<string> {
  const src = join(testDir, file);
  const out = join(neutralDir(testDir), `${file.replace(/\.[^.]+$/, "")}.v${NEUTRAL_VERSION}.jpg`);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return out;
  // Many previews request the same base at once: build it once, and only
  // expose it when complete (temp file + rename), so nobody reads half a JPEG.
  let p = building.get(out);
  if (!p) {
    p = (async () => {
      const n = await neutralFor(testDir, file);
      const { data, info } = await sharp(src).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
      applyNeutral(data, info.width, info.height, info.channels, n);
      const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
      await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 92 }).toFile(tmp);
      renameSync(tmp, out);
      return out;
    })().finally(() => building.delete(out));
    building.set(out, p);
  }
  return p;
}
const building = new Map<string, Promise<string>>();
