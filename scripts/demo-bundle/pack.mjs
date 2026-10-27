/**
 * 隔離した DATA_DIR（generate.mjs が書いた notes/ と wiki/）を、見本の束 public/demo/<id>.json にまとめる。
 *
 * 使い方:
 *   node scripts/demo-bundle/pack.mjs --data-dir <DATA_DIR> --id bread-ja --language ja
 *
 * 束の形は src/lib/demo/bundle.ts の DemoBundle。ドキュメント本体は DATA_DIR のファイルそのまま
 * （id はファイル名）。AI の名前は wiki の wikiMeta.generatedBy.model で一番多いものを採る。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, basename, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const DATA_DIR = resolve(opt("data-dir", process.env.DATA_DIR ?? ""));
const ID = opt("id", "bread-ja");
const LANGUAGE = opt("language", ID.endsWith("-en") ? "en" : "ja");
const OUT = resolve(opt("out", resolve(__dirname, "../../public/demo", `${ID}.json`)));

function readDocs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ id: basename(f, ".json"), doc: JSON.parse(readFileSync(resolve(dir, f), "utf8")) }));
}

const notes = readDocs(resolve(DATA_DIR, "notes"));
const wiki = readDocs(resolve(DATA_DIR, "wiki"));
if (notes.length === 0) {
  console.error(`notes が無い: ${DATA_DIR}/notes`);
  process.exit(1);
}

// 生成に使った AI の名前（最頻値）
const modelCounts = new Map();
for (const w of wiki) {
  const m = w.doc?.wikiMeta?.generatedBy?.model;
  if (typeof m === "string" && m) modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
}
const generatedBy = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

const kinds = new Map();
for (const w of wiki) {
  const k = w.doc?.wikiMeta?.kind ?? "?";
  kinds.set(k, (kinds.get(k) ?? 0) + 1);
}

const bundle = {
  format: "graphium-demo-bundle",
  version: 1,
  id: ID,
  language: LANGUAGE,
  createdAt: new Date().toISOString(),
  ...(generatedBy ? { generatedBy } : {}),
  notes,
  wiki,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle));
const size = Buffer.byteLength(JSON.stringify(bundle));
console.log(`[pack] ${OUT}`);
console.log(`[pack] notes=${notes.length} wiki=${wiki.length} (${[...kinds.entries()].map(([k, n]) => `${k}:${n}`).join(", ")}) generatedBy=${generatedBy ?? "-"} size=${(size / 1024).toFixed(0)} KB`);
