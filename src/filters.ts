// Filter model built to scale to thousands of presets: free-text search,
// one style (category), any number of tags, and a sort order. All of it
// lives in the URL so filtered views can be shared.
import type { Preset } from "./data";

export type Sort = "featured" | "new" | "az" | "popular";
export const SORTS: { id: Sort; label: string }[] = [
  { id: "featured", label: "Featured" },
  { id: "new", label: "Newest" },
  { id: "popular", label: "Most downloaded" },
  { id: "az", label: "A–Z" },
];

export interface Filters {
  q: string;
  cat: string;
  tags: string[];
  sort: Sort;
}

export function readFilters(params: URLSearchParams): Filters {
  const sort = params.get("sort") as Sort;
  return {
    q: params.get("q") ?? "",
    cat: params.get("cat") ?? "",
    tags: (params.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    sort: SORTS.some((s) => s.id === sort) ? sort : "featured",
  };
}

export function filtersHash(f: Partial<Filters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.cat) p.set("cat", f.cat);
  if (f.tags?.length) p.set("tags", f.tags.join(","));
  if (f.sort && f.sort !== "featured") p.set("sort", f.sort);
  const s = p.toString();
  return `#/${s ? `?${s}` : ""}`;
}

export const activeCount = (f: Filters) => (f.cat ? 1 : 0) + f.tags.length + (f.sort !== "featured" ? 1 : 0);

export function applyFilters(all: Preset[], f: Filters): Preset[] {
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter((p) => {
    if (f.cat && p.category !== f.cat) return false;
    if (f.tags.length && !f.tags.every((t) => p.tags.includes(t))) return false;
    if (!terms.length) return true;
    const hay = `${p.name} ${p.category} ${p.description} ${p.tags.join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  if (f.sort === "az") list.sort((a, b) => a.name.localeCompare(b.name));
  else if (f.sort === "new") list.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || b.id.localeCompare(a.id));
  else if (f.sort === "popular") list.sort((a, b) => b.downloads - a.downloads);
  return list;
}

/** Value -> count, most common first. */
export function counts(values: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const categoryCounts = (list: Preset[]) => counts(list.map((p) => p.category));
export const tagCounts = (list: Preset[]) => counts(list.flatMap((p) => p.tags));
