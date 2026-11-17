// Free, local colour analysis of a still. No AI.
// Works in CIELAB on a downscaled copy with letterbox/pillarbox bars removed.
import sharp from "sharp";

export const ANALYSIS_VERSION = 1;
const SIZE = 256;

export interface Metrics {
  version: number;
  crop: { top: number; bottom: number; left: number; right: number }; // fraction trimmed as bars
  lMean: number;
  lStd: number;
  p01: number;
  p05: number;
  p50: number;
  p95: number;
  p99: number;
  contrast: number; // p95 - p05 (L*)
  crushed: number; // share of pixels with L* < 4
  clipped: number; // share of pixels with L* > 97
  chroma: number; // mean C*
  chromaP90: number;
  warmth: number; // mean b* of midtones (+ yellow / - blue)
  tint: number; // mean a* of midtones (+ magenta / - green)
  shadow: { a: number; b: number; hue: number; chroma: number };
  highlight: { a: number; b: number; hue: number; chroma: number };
  hues: number[]; // 12 bins of 30°, chroma-weighted, sums to 1 (0s if mono)
  skin: number; // share of pixels in a broad skin-tone range
  mono: boolean;
}

// ---------- colour maths ----------
const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => srgbToLinear(i));
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const hueOf = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function percentile(sorted: Float32Array, p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/** Rows/columns that are (near) black across their whole length = letterbox bars. */
function findBars(lum: Float32Array, w: number, h: number) {
  const rowDark = (y: number) => {
    let s = 0, max = 0;
    for (let x = 0; x < w; x++) { const v = lum[y * w + x]; s += v; if (v > max) max = v; }
    return s / w < 3 && max < 12;
  };
  const colDark = (x: number, y0: number, y1: number) => {
    let s = 0, max = 0;
    for (let y = y0; y < y1; y++) { const v = lum[y * w + x]; s += v; if (v > max) max = v; }
    return s / Math.max(1, y1 - y0) < 3 && max < 12;
  };
  let top = 0, bottom = h;
  while (top < h * 0.3 && rowDark(top)) top++;
  while (bottom > h * 0.7 && rowDark(bottom - 1)) bottom--;
  let left = 0, right = w;
  while (left < w * 0.3 && colDark(left, top, bottom)) left++;
  while (right > w * 0.7 && colDark(right - 1, top, bottom)) right--;
  return { top, bottom, left, right };
}

export async function analyzeImage(path: string): Promise<{ metrics: Metrics; dhash: string }> {
  const { data, info } = await sharp(path).rotate().resize(SIZE, SIZE, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const n = w * h;
  const L = new Float32Array(n), A = new Float32Array(n), Bv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [l, a, b] = rgbToLab(data[i * ch], data[i * ch + 1], data[i * ch + 2]);
    L[i] = l; A[i] = a; Bv[i] = b;
  }
  const bars = findBars(L, w, h);

  const lums: number[] = [];
  let sumL = 0, sumL2 = 0, sumC = 0, crushed = 0, clipped = 0, skin = 0;
  let midA = 0, midB = 0, midN = 0, shA = 0, shB = 0, shN = 0, hiA = 0, hiB = 0, hiN = 0;
  const hueBins = new Array(12).fill(0);
  const chromas: number[] = [];
  for (let y = bars.top; y < bars.bottom; y++) {
    for (let x = bars.left; x < bars.right; x++) {
      const i = y * w + x;
      const l = L[i], a = A[i], b = Bv[i];
      const c = Math.hypot(a, b);
      lums.push(l); sumL += l; sumL2 += l * l; sumC += c; chromas.push(c);
      if (l < 4) crushed++;
      if (l > 97) clipped++;
      if (l >= 30 && l <= 80) { midA += a; midB += b; midN++; }
      if (l < 35) { shA += a; shB += b; shN++; }
      if (l > 70) { hiA += a; hiB += b; hiN++; }
      if (c > 8) hueBins[Math.floor(hueOf(a, b) / 30) % 12] += c;
      const hue = hueOf(a, b);
      if (l > 25 && l < 88 && c > 8 && c < 45 && hue > 20 && hue < 75) skin++;
    }
  }
  const count = lums.length || 1;
  const sorted = Float32Array.from(lums).sort();
  const cs = Float32Array.from(chromas).sort();
  const lMean = sumL / count;
  const hueTotal = hueBins.reduce((s, v) => s + v, 0);
  const tone = (sa: number, sb: number, sn: number) => {
    const a = sn ? sa / sn : 0, b = sn ? sb / sn : 0;
    return { a: round(a), b: round(b), hue: round(hueOf(a, b), 0), chroma: round(Math.hypot(a, b)) };
  };
  const p05 = percentile(sorted, 0.05), p95 = percentile(sorted, 0.95);
  const chromaP90 = percentile(cs, 0.9);

  const metrics: Metrics = {
    version: ANALYSIS_VERSION,
    crop: { top: round(bars.top / h, 3), bottom: round(1 - bars.bottom / h, 3), left: round(bars.left / w, 3), right: round(1 - bars.right / w, 3) },
    lMean: round(lMean),
    lStd: round(Math.sqrt(Math.max(0, sumL2 / count - lMean * lMean))),
    p01: round(percentile(sorted, 0.01)),
    p05: round(p05),
    p50: round(percentile(sorted, 0.5)),
    p95: round(p95),
    p99: round(percentile(sorted, 0.99)),
    contrast: round(p95 - p05),
    crushed: round(crushed / count, 4),
    clipped: round(clipped / count, 4),
    chroma: round(sumC / count),
    chromaP90: round(chromaP90),
    warmth: round(midN ? midB / midN : 0),
    tint: round(midN ? midA / midN : 0),
    shadow: tone(shA, shB, shN),
    highlight: tone(hiA, hiB, hiN),
    hues: hueBins.map((v) => round(hueTotal ? v / hueTotal : 0, 3)),
    skin: round(skin / count, 4),
    mono: chromaP90 < 6,
  };
  return { metrics, dhash: await dHash(path) };
}

/** 64-bit difference hash for near-duplicate detection. */
export async function dHash(path: string): Promise<string> {
  const { data } = await sharp(path).rotate().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), d = 0;
  while (x) { d += Number(x & 1n); x >>= 1n; }
  return d;
}

/** Normalised vector describing the grade, used to group similar looks. */
export function lookVector(m: Metrics): number[] {
  return [
    m.lMean / 100,
    m.contrast / 100,
    m.p01 / 50,
    m.p99 / 100,
    m.chroma / 40,
    m.warmth / 30,
    m.tint / 30,
    m.shadow.a / 25,
    m.shadow.b / 25,
    m.highlight.a / 25,
    m.highlight.b / 25,
    ...m.hues.map((v) => v * 0.6),
  ];
}

export function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}
