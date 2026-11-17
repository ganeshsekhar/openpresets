import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { library, repoChanges, setGallery, setListed, stage } from "../server/publish.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "op-m4-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function setup() {
  const data = join(root, "data"), repo = join(root, "repo");
  const tp = join(data, "test-photos");
  mkdirSync(tp, { recursive: true });
  for (const f of ["portrait-close.jpg", "lifestyle.jpg", "coffee.jpg", "food.jpg", "city.jpg"]) {
    await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toFile(join(tp, f));
  }
  writeFileSync(join(tp, "credits.json"), JSON.stringify({ "portrait-close.jpg": { author: "A", url: "https://unsplash.com/x", license: "Unsplash License", subject: "Portrait" } }));
  mkdirSync(join(repo, "public"), { recursive: true });
  writeFileSync(join(repo, "public/presets.csv"), "ID,Name,Slug,Category,Tags,Author,Before Image URL,After Image URL,Description,Status,Date Added,Downloads,Exposure2012,Contrast2012\nOP-001,Placeholder,,,,,,,,Live,,0,,\n");
  writeFileSync(join(repo, "CREDITS.md"), "old\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "init", "--allow-empty"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "files"], { cwd: repo });

  const db = openDb(":memory:");
  db.exec("INSERT INTO batches (id, status) VALUES (1, 'closed')");
  const ins = db.prepare("INSERT INTO drafts (batch_id, kind, ref_ids_json, name, description, tags_json, settings_json, status) VALUES (1, 'still', ?, ?, 'd', ?, ?, ?)");
  const tags = JSON.stringify([{ grp: "goodFor", value: "Travel" }, { grp: "goodFor", value: "Cafés & restaurants" }, { grp: "mood", value: "Nostalgic" }]);
  ins.run("[1]", "Warm Mile", tags, JSON.stringify({ IncrementalTemperature: 20, Fade: 10 }), "approved");
  ins.run("[2]", "Blue Hour", tags, JSON.stringify({ IncrementalTemperature: -20 }), "approved");
  ins.run("[3]", "Not Yet", tags, "{}", "draft");
  return { db, data, repo };
}

describe("publish", () => {
  it("lists approved presets, stages CSV + previews + credits replacing placeholders, and tracks state", async () => {
    const { db, data, repo } = await setup();
    let lib = library(db, data);
    expect(lib.items.map((i) => [i.name, i.state])).toEqual([["Warm Mile", "off"], ["Blue Hour", "off"]]);
    expect(lib.items[0].gallery).toEqual(["portrait-close.jpg", "lifestyle.jpg", "coffee.jpg", "food.jpg"]);

    setListed(db, [lib.items[0].id, lib.items[1].id], true);
    setGallery(db, data, lib.items[1].id, ["city.jpg", "coffee.jpg"]);
    expect(library(db, data).pending).toBe(2);

    const r = await stage(db, data, repo);
    expect(r.presets).toBe(2);
    const csv = readFileSync(join(repo, "public/presets.csv"), "utf8").trim().split("\n");
    expect(csv).toHaveLength(3); // header + 2, placeholder gone
    const head = csv[0].split(",");
    expect(head.slice(-3)).toEqual(["Good For", "Mood", "Gallery"]);
    expect(head).toContain("ToneCurvePV2012"); // Fade becomes a real curve column
    expect(csv[1]).toMatch(/^OP-101,Warm Mile,warm-mile,Travel,/);
    expect(csv[2]).toContain("city::previews/photos/city.webp::previews/OP-102/city.webp");
    expect(csv[1]).toContain('"Travel, Cafés & restaurants"');
    expect(readdirSync(join(repo, "public/previews/OP-102")).sort()).toEqual(["city.webp", "coffee.webp"]);
    expect(existsSync(join(repo, "public/previews/photos/city.webp"))).toBe(true);
    const credits = readFileSync(join(repo, "CREDITS.md"), "utf8");
    expect(credits).toContain("| Portrait | A | https://unsplash.com/x | Unsplash License | 1 preset |");
    expect(credits).toContain("UNKNOWN — add credit"); // missing credits are loud, not silent
    expect((await repoChanges(repo)).length).toBeGreaterThan(0);

    // Shrinking a gallery removes the stale after-image.
    setGallery(db, data, lib.items[1].id, ["coffee.jpg"]);
    await stage(db, data, repo);
    expect(readdirSync(join(repo, "public/previews/OP-102"))).toEqual(["coffee.webp"]);
    expect(existsSync(join(repo, "public/previews/photos/city.webp"))).toBe(false);

    // Simulate a published state, then unlist → removing.
    db.exec("UPDATE drafts SET published_at = datetime('now'), published_hash = 'x' WHERE status = 'approved'");
    setListed(db, [lib.items[1].id], false);
    lib = library(db, data);
    expect(lib.items.map((i) => i.state)).toEqual(["updated", "removing"]);
  }, 60_000);
});
