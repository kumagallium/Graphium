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
// 順路（見本の中の案内）。target を id に解決して束に入れる
const TOUR = opt("tour", "");

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

// チャットの記録（appdata の standalone-chat-index / standalone-chat:<id>）
const appdata = {};
const appdataDir = resolve(DATA_DIR, "appdata");
if (existsSync(appdataDir)) {
  for (const f of readdirSync(appdataDir)) {
    if (!f.endsWith(".json")) continue;
    const key = basename(f, ".json");
    if (!key.startsWith("standalone-chat")) continue;
    appdata[key] = JSON.parse(readFileSync(resolve(appdataDir, f), "utf8"));
  }
}
const chatCount = Object.keys(appdata).filter((k) => k.startsWith("standalone-chat:")).length;

// 順路の target → hash
function resolveTour(spec) {
  const lower = (s) => (s ?? "").toLowerCase();
  const byKind = (kind) => wiki.filter((w) => w.doc?.wikiMeta?.kind === kind);
  const chats = Object.entries(appdata)
    .filter(([k]) => k.startsWith("standalone-chat:"))
    .map(([, v]) => v)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const steps = [];
  for (const st of spec.steps) {
    const t = st.target;
    let hash = null;
    if (t.kind === "note") {
      const n = notes.find((n) => n.doc.title === t.title);
      if (n) hash = `#note/${n.id}`;
    } else if (t.kind === "chat") {
      const c = chats[t.index ?? 0];
      if (c) hash = `#chats/${encodeURIComponent(c.id)}`;
    } else if (t.kind === "route") {
      hash = t.hash;
    } else {
      // 元ノートが多い順（束ね方が見えるページを先に）
      let pool = byKind(t.kind).slice().sort((a, b) => (b.doc.wikiMeta?.derivedFromNotes?.length ?? 0) - (a.doc.wikiMeta?.derivedFromNotes?.length ?? 0));
      // section: 本文にその見出し（正規表現）があるものに絞り、元ノートが多い順に並べる
      if (t.section) {
        const re = new RegExp(`^## .*(${t.section})`, "m");
        const narrowed = pool
          .filter((w) => re.test(w.doc?.wikiMeta?.topicMarkdown ?? ""))
          .sort((a, b) => (b.doc.wikiMeta?.derivedFromNotes?.length ?? 0) - (a.doc.wikiMeta?.derivedFromNotes?.length ?? 0));
        if (narrowed.length > 0) pool = narrowed;
        else console.warn(`[pack] tour: no ${t.kind} has a section matching /${t.section}/`);
      }
      const hit =
        (!t.match && !t.title && pool[0]) ||
        (t.match && pool.find((w) => lower(w.doc.title).includes(lower(t.match)))) ||
        (t.matchAlt && pool.find((w) => lower(w.doc.title).includes(lower(t.matchAlt)))) ||
        (t.title && pool.find((w) => w.doc.title === t.title));
      if (hit) hash = `#knowledge/${t.kind}/${hit.id}`;
      else if (pool[0]) { hash = `#knowledge/${t.kind}/${pool[0].id}`; console.warn(`[pack] tour: no ${t.kind} matches "${t.match ?? t.title}", using first`); }
    }
    if (!hash) { console.warn(`[pack] tour: could not resolve step "${st.title}" — skipped`); continue; }
    steps.push({ title: st.title, body: st.body, hash });
  }
  return { steps };
}
const tour = TOUR ? resolveTour(JSON.parse(readFileSync(resolve(TOUR), "utf8"))) : null;

const bundle = {
  format: "graphium-demo-bundle",
  version: 1,
  id: ID,
  language: LANGUAGE,
  createdAt: new Date().toISOString(),
  ...(generatedBy ? { generatedBy } : {}),
  notes,
  wiki,
  ...(Object.keys(appdata).length > 0 ? { appdata } : {}),
  ...(tour && tour.steps.length > 0 ? { tour } : {}),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle));
const size = Buffer.byteLength(JSON.stringify(bundle));
console.log(`[pack] ${OUT}`);
console.log(`[pack] chats=${chatCount} tour=${tour ? tour.steps.length : 0} notes=${notes.length} wiki=${wiki.length} (${[...kinds.entries()].map(([k, n]) => `${k}:${n}`).join(", ")}) generatedBy=${generatedBy ?? "-"} size=${(size / 1024).toFixed(0)} KB`);
