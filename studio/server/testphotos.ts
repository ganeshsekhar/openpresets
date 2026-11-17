// CC0 / Unsplash test photos that every draft preset is previewed on. They
// also become the site's public before/after images, so each needs a credit
// (docs/legal-protocol.md, Phase 4). Files live in <data>/test-photos/.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGE_EXT } from "./config.ts";
import { basePath } from "./neutralize.ts";

/** The image a test photo is rendered from: its neutral base. */
export const photoBase = (dataDir: string, p: { file: string }) => basePath(testDir(dataDir), p.file);

export interface Credit { author: string; url: string; license: string; subject?: string }
export interface TestPhoto { file: string; subject: string; credit: Credit | null }

/**
 * Default set (20), chosen to cover the audience: people and skin, cafés and
 * food, interiors, travel, city and night, golden hour, products. Order matters:
 * the first four are used for fitting, the first three for Claude refine.
 */
export const DEFAULT_SET: { id: number; file: string; subject: string; author: string; url: string }[] = [
  { id: 1027, file: "portrait-close.jpg", subject: "Portrait", author: "Roksolana Zasiadko", url: "https://unsplash.com/photos/LyeduBb2Auk" },
  { id: 823, file: "lifestyle.jpg", subject: "Lifestyle", author: "Benjamin Combs", url: "https://unsplash.com/photos/hiAdjnXZxl8" },
  { id: 431, file: "coffee.jpg", subject: "Café", author: "Carli Jean", url: "https://unsplash.com/photos/UWRqlJcDCXA" },
  { id: 292, file: "food.jpg", subject: "Food", author: "Webvilla", url: "https://unsplash.com/photos/hv1MrBzGGNY" },
  { id: 1015, file: "landscape.jpg", subject: "Travel", author: "Alexey Topolyanskiy", url: "https://unsplash.com/photos/-oWyJoSqBRM" },
  { id: 862, file: "city.jpg", subject: "City", author: "Benjamin Combs", url: "https://unsplash.com/photos/bLppF5sbXPo" },
  { id: 399, file: "golden-hour.jpg", subject: "Golden hour", author: "Sunset Girl", url: "https://unsplash.com/photos/FjAD28N8-IQ" },
  { id: 838, file: "street-family.jpg", subject: "Street", author: "London Scout", url: "https://unsplash.com/photos/4-gFGb12hFA" },
  { id: 395, file: "restaurant.jpg", subject: "Restaurant", author: "Dogancan Ozturan", url: "https://unsplash.com/photos/94taEmdowRw" },
  { id: 42, file: "cafe-interior.jpg", subject: "Café interior", author: "Luke Chesser", url: "https://unsplash.com/photos/KR2mdHJ5qMg" },
  { id: 63, file: "coffee-overhead.jpg", subject: "Coffee", author: "Justin Leibow", url: "https://unsplash.com/photos/ZJsseAxEcqM" },
  { id: 429, file: "berries.jpg", subject: "Food", author: "Glen Carrie", url: "https://unsplash.com/photos/FjjUVn_KHLU" },
  { id: 835, file: "flatlay.jpg", subject: "Food flat-lay", author: "Olenka Kotyk", url: "https://unsplash.com/photos/eqsEZNCm4-c" },
  { id: 625, file: "interior.jpg", subject: "Interior", author: "Breather", url: "https://unsplash.com/photos/DEdM9Vs6s8w" },
  { id: 164, file: "canal-town.jpg", subject: "Travel city", author: "Linh Nguyen", url: "https://unsplash.com/photos/agkblvPff5U" },
  { id: 741, file: "sky.jpg", subject: "Sky", author: "Garrett Carroll", url: "https://unsplash.com/photos/5iPhUVPYWsw" },
  { id: 777, file: "sunset-lifestyle.jpg", subject: "Sunset", author: "Julia Caesar", url: "https://unsplash.com/photos/DpoMKEARZe4" },
  { id: 452, file: "night-concert.jpg", subject: "Night", author: "Desi Mendoza", url: "https://unsplash.com/photos/CuSHBGBdXc0" },
  { id: 250, file: "product.jpg", subject: "Product", author: "Nicola Perantoni", url: "https://unsplash.com/photos/irUQaBK3ydI" },
  { id: 668, file: "desk.jpg", subject: "Desk", author: "William Iven", url: "https://unsplash.com/photos/GANqCr1BRTU" },
];

/** Photos dropped from the default set; moved to removed/ (not deleted) when the set is updated. */
export const RETIRED: { file: string; author: string }[] = [{ file: "portrait.jpg", author: "Alexander Shustov" }];

export const testDir = (dataDir: string) => join(dataDir, "test-photos");
const creditsPath = (dataDir: string) => join(testDir(dataDir), "credits.json");

function readCredits(dataDir: string): Record<string, Credit> {
  try {
    return JSON.parse(readFileSync(creditsPath(dataDir), "utf8"));
  } catch {
    return {};
  }
}

export function listTestPhotos(dataDir: string): TestPhoto[] {
  const dir = testDir(dataDir);
  if (!existsSync(dir)) return [];
  const credits = readCredits(dataDir);
  const order = (f: string) => {
    const i = DEFAULT_SET.findIndex((d) => d.file === f);
    return i === -1 ? 1000 : i;
  };
  return readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f) && !f.startsWith("."))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((file) => ({
      file,
      subject: credits[file]?.subject ?? file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      credit: credits[file] ?? null,
    }));
}

/** Downloads the default set. Called only when the owner clicks the button in Studio. */
export function retiredPresent(dataDir: string): string[] {
  const credits = readCredits(dataDir);
  return RETIRED.filter((r) => existsSync(join(testDir(dataDir), r.file)) && credits[r.file]?.author === r.author).map((r) => r.file);
}

export async function downloadDefaultSet(dataDir: string): Promise<{ saved: string[]; skipped: string[]; retired: string[] }> {
  const dir = testDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const credits = readCredits(dataDir);
  const saved: string[] = [], skipped: string[] = [], retired: string[] = [];
  // Retire dropped default photos by moving them aside (never deleting the owner's files).
  for (const file of retiredPresent(dataDir)) {
    mkdirSync(join(dir, "removed"), { recursive: true });
    renameSync(join(dir, file), join(dir, "removed", file));
    delete credits[file];
    retired.push(file);
  }
  for (const p of DEFAULT_SET) {
    const path = join(dir, p.file);
    if (existsSync(path)) {
      skipped.push(p.file);
    } else {
      const res = await fetch(`https://picsum.photos/id/${p.id}/1600/1067`);
      if (!res.ok) throw new Error(`Could not download ${p.file} (HTTP ${res.status})`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      saved.push(p.file);
    }
    credits[p.file] = { author: p.author, url: p.url, license: "Unsplash License", subject: p.subject };
  }
  writeFileSync(creditsPath(dataDir), JSON.stringify(credits, null, 2));
  return { saved, skipped, retired };
}
