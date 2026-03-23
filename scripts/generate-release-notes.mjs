/**
 * git log からリリースノート JSON を生成するスクリプト。
 * public/release_notes.json に出力する。
 *
 * 使い方:
 *   node scripts/generate-release-notes.mjs
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNT = 50;

// git log から直近 COUNT 件のコミットを取得
const raw = execSync(
  `git log --pretty=format:"%H|||%s|||%ci" -${COUNT}`,
  { encoding: "utf-8", cwd: join(__dirname, "..") }
).trim();

const commits = raw
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, message, date] = line.split("|||", 3);
    return { sha: sha.slice(0, 7), message, date: date.slice(0, 10) };
  });

const outPath = join(__dirname, "..", "public", "release_notes.json");
writeFileSync(outPath, JSON.stringify(commits, null, 2), "utf-8");
console.log(`${commits.length} 件のコミットを ${outPath} に出力しました`);
