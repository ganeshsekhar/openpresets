// CC0 / Unsplash test photos that every draft preset is previewed on. They
// also become the site's public before/after images, so each needs a credit
// (docs/legal-protocol.md, Phase 4). Files live in <data>/test-photos/.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGE_EXT } from "./config.ts";

export interface Credit { author: string; url: string; license: string; subject?: string }
export interface TestPhoto { file: string; subject: string; credit: Credit | null }

/** Default set, chosen to cover the audience: people, cafés & food, interiors, travel, city, product. */
export const DEFAULT_SET: { id: number; file: string; subject: string; author: string; url: string }[] = [
  { id: 64, file: "portrait.jpg", subject: "Portrait", author: "Alexander Shustov", url: "https://unsplash.com/photos/AHBiSKaENwc" },
  { id: 823, file: "lifestyle.jpg", subject: "Lifestyle", author: "Benjamin Combs", url: "https://unsplash.com/photos/hiAdjnXZxl8" },
  { id: 431, file: "coffee.jpg", subject: "Café", author: "Carli Jean", url: "https://unsplash.com/photos/UWRqlJcDCXA" },
  { id: 292, file: "food.jpg", subject: "Food", author: "Webvilla", url: "https://unsplash.com/photos/hv1MrBzGGNY" },
  { id: 625, file: "interior.jpg", subject: "Interior", author: "Breather", url: "https://unsplash.com/photos/DEdM9Vs6s8w" },
  { id: 1015, file: "landscape.jpg", subject: "Travel", author: "Alexey Topolyanskiy", url: "https://unsplash.com/photos/-oWyJoSqBRM" },
  { id: 862, file: "city.jpg", subject: "City", author: "Benjamin Combs", url: "https://unsplash.com/photos/bLppF5sbXPo" },
  { id: 250, file: "product.jpg", subject: "Product", author: "Nicola Perantoni", url: "https://unsplash.com/photos/irUQaBK3ydI" },
];

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
  return readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f) && !f.startsWith("."))
    .sort()
    .map((file) => ({
      file,
      subject: credits[file]?.subject ?? file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      credit: credits[file] ?? null,
    }));
}

/** Downloads the default set. Called only when the owner clicks the button in Studio. */
export async function downloadDefaultSet(dataDir: string): Promise<{ saved: string[]; skipped: string[] }> {
  const dir = testDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const credits = readCredits(dataDir);
  const saved: string[] = [], skipped: string[] = [];
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
  return { saved, skipped };
}
