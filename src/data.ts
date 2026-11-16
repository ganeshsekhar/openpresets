import Papa from "papaparse";

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
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function rowToPreset(row: Record<string, string>): Preset {
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
    } else if (meta) {
      (p[meta] as string) = val;
    } else if (val !== "") {
      p.settings[key] = val;
    }
  }
  if (!p.slug) p.slug = slugify(p.name || p.id);
  return p;
}

export function parsePresetsCsv(text: string): Preset[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return result.data
    .map(rowToPreset)
    .filter((p) => p.name && p.status.toLowerCase() === "live");
}

export async function loadPresets(url: string): Promise<Preset[]> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load presets (${res.status})`);
  return parsePresetsCsv(await res.text());
}
