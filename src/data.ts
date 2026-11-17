import Papa from "papaparse";

/** One before/after photo pair. The first pair of a preset is its cover. */
export interface GalleryPair {
  subject: string; // short label, e.g. "Portrait"; may be blank
  before: string;
  after: string; // blank = render a CSS approximation of `before`
}

export const MAX_GALLERY = 4;

export interface Preset {
  id: string;
  name: string;
  slug: string;
  category: string;
  tags: string[];
  author: string;
  beforeUrl: string;
  afterUrl: string; // blank = render a CSS approximation from the settings
  description: string;
  status: string;
  dateAdded: string;
  downloads: number;
  /** "Good For" column: what the look suits, e.g. "Travel". */
  goodFor: string[];
  /** "Mood" column, e.g. "Warm & cozy". */
  mood: string[];
  /** Up to four before/after pairs; [0] is the cover (same as beforeUrl/afterUrl). */
  gallery: GalleryPair[];
  /** Lightroom crs: settings, keyed by crs name. Blank cells are omitted. */
  settings: Record<string, string>;
}

/** Sheet columns that describe the preset rather than a Lightroom setting. */
const META_COLUMNS: Record<string, keyof Preset> = {
  ID: "id",
  Name: "name",
  Slug: "slug",
  Category: "category",
  Tags: "tags",
  Author: "author",
  "Before Image URL": "beforeUrl",
  "After Image URL": "afterUrl",
  Description: "description",
  Status: "status",
  "Date Added": "dateAdded",
  Downloads: "downloads",
  "Good For": "goodFor",
  Mood: "mood",
  Gallery: "gallery",
};

/**
 * Resolve an image path from the sheet. Absolute URLs (http(s), protocol-
 * relative, data:, blob:) pass through; anything else is relative to the site
 * root and gets Vite's BASE_URL so it works on GitHub Pages sub-paths.
 */
export function resolveUrl(u: string, base: string = import.meta.env?.BASE_URL ?? "/"): string {
  const v = u.trim();
  if (!v) return "";
  if (/^(?:https?:|data:|blob:|\/\/)/i.test(v)) return v;
  const b = base.endsWith("/") ? base : `${base}/`;
  return b + v.replace(/^(?:\.\/|\/)+/, "");
}

/** "a, b ,, A" -> ["a", "b"] (trimmed, blanks and case-insensitive repeats dropped). */
export function splitList(val: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of val.split(",")) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

/** "subject::before::after|..." -> pairs. Entries without a before image are skipped. */
export function parseGallery(val: string, base?: string): GalleryPair[] {
  const out: GalleryPair[] = [];
  for (const entry of val.split("|")) {
    const parts = entry.split("::").map((x) => x.trim());
    if (parts.length < 2) continue;
    const [subject, before, after = ""] = parts.length === 2 ? ["", parts[0], parts[1]] : parts;
    if (!before) continue;
    out.push({ subject, before: resolveUrl(before, base), after: resolveUrl(after, base) });
    if (out.length === MAX_GALLERY) break;
  }
  return out;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function rowToPreset(row: Record<string, string>, base?: string): Preset {
  const p: Preset = {
    id: "",
    name: "",
    slug: "",
    category: "",
    tags: [],
    author: "",
    beforeUrl: "",
    afterUrl: "",
    description: "",
    status: "",
    dateAdded: "",
    downloads: 0,
    goodFor: [],
    mood: [],
    gallery: [],
    settings: {},
  };
  for (const [rawKey, rawVal] of Object.entries(row)) {
    const key = rawKey.trim();
    const val = (rawVal ?? "").trim();
    if (!key) continue;
    const meta = META_COLUMNS[key];
    if (meta === "tags") {
      p.tags = val
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    } else if (meta === "downloads") {
      p.downloads = Number(val) || 0;
    } else if (meta === "goodFor" || meta === "mood") {
      p[meta] = splitList(val);
    } else if (meta === "gallery") {
      p.gallery = parseGallery(val, base);
    } else if (meta === "beforeUrl" || meta === "afterUrl") {
      p[meta] = resolveUrl(val, base);
    } else if (meta) {
      (p[meta] as string) = val;
    } else if (val !== "") {
      p.settings[key] = val;
    }
  }
  if (!p.slug) p.slug = slugify(p.name || p.id);
  if (!p.category && p.goodFor.length) p.category = p.goodFor[0];
  if (p.gallery.length) {
    // The cover pair doubles as Before/After Image URL; fill them if the sheet left them blank.
    if (!p.beforeUrl) {
      p.beforeUrl = p.gallery[0].before;
      p.afterUrl ||= p.gallery[0].after;
    }
  } else if (p.beforeUrl) {
    p.gallery = [{ subject: "", before: p.beforeUrl, after: p.afterUrl }];
  }
  return p;
}

export function parsePresetsCsv(text: string, base?: string): Preset[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return result.data
    .map((row) => rowToPreset(row, base))
    .filter((p) => p.name && p.status.toLowerCase() === "live");
}

export async function loadPresets(url: string): Promise<Preset[]> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load presets (${res.status})`);
  return parsePresetsCsv(await res.text());
}
