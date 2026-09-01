// 日本語 Web フォント（BIZ UDPGothic / Zen Kaku Gothic New）を取得して
// public/fonts/jp/ に配置するスクリプト
// Google Fonts CDN への実行時アクセスを無くすために使用（プライバシー / オフライン動作）
//
// Google Fonts は日本語フォントを unicode-range 付きの ~120 サブセットに分割して配信する。
// ブラウザは実際に使う字を含むチャンクだけを遅延取得するので、この分割構造を保ったまま
// セルフホストする（4 face 合計 490 チャンク・約 8MB。1 ファイルに結合すると初回に
// 全部落ちてきて、UD フォント常用の体感が壊れる）。
// ※ 総サイズは Google 側のフォント改版で動く。実測値は実行時のログに出る。
//
// このスクリプトは public/fonts/jp/ に以下を生成する（どちらも .gitignore 済み）:
//   1. *.woff2   ... fonts.gstatic.com から取得したサブセット本体
//   2. fonts.css ... @font-face + unicode-range（src の url() を同ディレクトリ相対に書き換え）
//      相対 url() なので base（web は /Graphium/、Tauri は /）に依存せず解決される。
//      読み込みは app/index.html と index.html の <link rel="stylesheet"> から。
//
// 生成物はコミットしない（.gitignore）。CI は pnpm build を回す各 workflow の
// "Cache Japanese webfonts" ステップ（actions/cache、キー = このファイルのハッシュ）で
// 使い回すので、通常は CDN を叩かない。取得に失敗したときは常に fatal — フォントが
// 欠けた dist / 配布物を作らせないため。

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// 取得元。元の <link rel="stylesheet"> と同じクエリ（display=swap 込み）にしておく。
const CSS_URL =
  "https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Kaku+Gothic+New:wght@400;700&display=swap";
// woff2 + unicode-range 版を返させるには「モダンブラウザ」の UA が必須。
// curl の既定 UA だとサブセット無しの ttf が返ってしまう。
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FONTS_DIR = join(PROJECT_ROOT, "public", "fonts", "jp");
const CSS_NAME = "fonts.css";
const cssPath = join(FONTS_DIR, CSS_NAME);
const tmpDir = join(PROJECT_ROOT, ".tmp-fonts-fetch");
const CURL_CONFIG_NAME = "curl-config.txt";

const force = process.argv.includes("--force");

// 既存の public/fonts/jp/ がそのまま使えるかを確かめる（使えれば null、駄目なら理由）。
// fonts.css の url() は生成時に同ディレクトリ相対（./xxx.woff2）へ書き換えてあるので、
// そこから実体の有無を突き合わせる。CI では actions/cache の復元結果がここを通るため、
// 「CSS だけ復元されて woff2 が欠けている」状態を skip せず取り直せるようにしておく。
function installProblem() {
  const css = readFileSync(cssPath, "utf-8");
  const names = [...css.matchAll(/url\(\.\/([^)"']+\.woff2)\)/g)].map((m) => m[1]);
  if (names.length === 0) return "fonts.css references no local woff2";
  const missing = names.filter((name) => {
    const file = join(FONTS_DIR, name);
    return !existsSync(file) || statSync(file).size === 0;
  });
  if (missing.length > 0) {
    return `${missing.length}/${names.length} chunks missing or empty (e.g. ${missing[0]})`;
  }
  return null;
}

// fonts.css は全 woff2 を取り切ってから最後に書き出すので、存在 = 前回が完走した印。
// 生成物は tmp ディレクトリごと差し替えるため、中途半端な CSS が残ってビルドが
// 壊れることはない。
if (existsSync(cssPath) && !force) {
  const problem = installProblem();
  if (problem === null) {
    console.log(`[fetch-fonts] Already present (use --force to refresh):`);
    console.log(`  - ${FONTS_DIR}`);
    process.exit(0);
  }
  console.warn(`[fetch-fonts] Existing files are incomplete — refetching (${problem})`);
}

// 失敗時は tmp を掃除して抜ける（既存の public/fonts/jp/ はそのまま温存される）
function fail(...lines) {
  for (const line of lines) console.error(`[fetch-fonts] ${line}`);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

// curl の終了コード → 実際の失敗理由。
// -f を付けているので HTTP エラー（404 / 403 / 429）は 22、タイムアウトは 28 で返る。
// 全部を「オフライン？」と報告すると、レート制限や CDN の 404 を切り分けられない。
const CURL_EXIT_HINTS = {
  2: "curl failed to initialize (unknown option — curl older than 7.66?)",
  6: "Could not resolve the font CDN host (DNS)",
  7: "Could not connect to the font CDN (offline / firewall / proxy?)",
  22: "The font CDN returned an HTTP error (404 / 403, or 429 = rate limited)",
  28: "Timed out while downloading",
  35: "TLS handshake failed (proxy interception?)",
  56: "Connection reset while receiving data",
};

// curl 自体が起動できたか（未インストール環境の切り分け）も含めて 1 行にまとめる
function curlFailure(result) {
  if (result.error) {
    return result.error.code === "ENOENT"
      ? "curl not found (required to download fonts)"
      : `Failed to run curl: ${result.error.message}`;
  }
  if (result.status === null) return `curl was killed by ${result.signal ?? "a signal"}`;
  const hint = CURL_EXIT_HINTS[result.status] ?? "Download failed";
  return `${hint} [curl exit ${result.status}]`;
}

// 一時的な失敗（429 / 5xx / タイムアウト）は curl 自身に数回リトライさせて、
// CDN 側の都合だけで CI が赤くなる確率を下げる。
// --retry / --connect-timeout は --parallel 非対応の古い curl にもある。
const RETRY_ARGS = ["--retry", "3", "--retry-delay", "2", "--connect-timeout", "20"];

rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

// 1. Google Fonts の CSS を取得
console.log(`[fetch-fonts] Downloading ${CSS_URL}`);
const remoteCssPath = join(tmpDir, "google.css");
const cssDl = spawnSync(
  "curl",
  ["-fsSL", ...RETRY_ARGS, "-A", USER_AGENT, "-o", remoteCssPath, CSS_URL],
  { stdio: "inherit" },
);
if (cssDl.status !== 0) fail(curlFailure(cssDl));

const remoteCss = readFileSync(remoteCssPath, "utf-8");

// 2. 参照されている woff2 を全部拾う（unicode-range のチャンク単位）
const woff2Urls = [
  ...new Set(remoteCss.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+\.woff2/g) ?? []),
];
if (woff2Urls.length === 0) {
  fail(
    "No woff2 URLs in the response.",
    "  woff2 以外（ttf 等）が返っている可能性がある — USER_AGENT の指定を確認する。",
  );
}
if (woff2Urls.length < 50) {
  console.warn(
    `[fetch-fonts] Only ${woff2Urls.length} chunks found — expected ~490 (subsetting may be off)`,
  );
}

// 3. ローカルのファイル名を決める。
//    URL の直前に現れる font-family / font-weight と、チャンクの識別子から組む。
//    日本語サブセットは URL 末尾に連番が付く   → bizudpgothic-400-119.woff2
//    ラテン等のサブセットは直前に /* latin */ 等のコメントが付く → ...-400-latin.woff2
function lastMatch(text, re) {
  let last;
  for (const m of text.matchAll(re)) last = m;
  return last;
}

const localNames = new Map();
const usedNames = new Set();
for (const url of woff2Urls) {
  const head = remoteCss.slice(0, remoteCss.indexOf(url));
  const family = lastMatch(head, /font-family:\s*'([^']*)'/g)?.[1] ?? "jp";
  const weight = lastMatch(head, /font-weight:\s*(\d+)/g)?.[1] ?? "400";
  const label = lastMatch(head, /\/\*\s*([\w-]+)\s*\*\//g)?.[1];
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "") || "jp";
  const chunk =
    url.match(/\.(\d+)\.woff2$/)?.[1] ?? label?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "x";
  let name = `${slug}-${weight}-${chunk}.woff2`;
  for (let n = 2; usedNames.has(name); n++) name = `${slug}-${weight}-${chunk}_${n}.woff2`;
  usedNames.add(name);
  localNames.set(url, name);
}

// 4. woff2 を一括ダウンロード。
//    URL を引数に並べると 490 本で Windows のコマンドライン長制限（32767 文字）を
//    超えるので curl の設定ファイル経由にする。output は cwd 相対にしておく
//    （設定ファイル内の "..." はバックスラッシュがエスケープ扱いになり、Windows の
//    絶対パスを書くと壊れるため）。
const curlConfig = woff2Urls
  .map((url) => `url = "${url}"\noutput = "${localNames.get(url)}"`)
  .join("\n");
writeFileSync(join(tmpDir, CURL_CONFIG_NAME), `${curlConfig}\n`, "utf-8");

console.log(`[fetch-fonts] Downloading ${woff2Urls.length} woff2 chunks`);
const runCurl = (parallel) =>
  spawnSync(
    "curl",
    [
      "-fsSL",
      ...RETRY_ARGS,
      "-A",
      USER_AGENT,
      ...(parallel ? ["--parallel", "--parallel-max", "8"] : []),
      "-K",
      CURL_CONFIG_NAME,
    ],
    { cwd: tmpDir, stdio: "inherit" },
  );

// curl 7.66 未満は --parallel を知らず、「unknown option」= 終了コード 2 で即死する。
// 逐次モードへ落とすのはこの 1 ケースだけに限る。どんな失敗でも再試行すると、
// 429 を食らったときに 490 チャンク・約 8MB を丸ごと二度落としたうえで、
// 最後に的外れな「オフライン？」を表示することになる。
const CURL_UNKNOWN_OPTION = 2;
let dl = runCurl(true);
if (dl.status === CURL_UNKNOWN_OPTION) {
  console.warn("[fetch-fonts] curl does not support --parallel — retrying sequentially");
  dl = runCurl(false);
}
if (dl.status !== 0) {
  fail(
    curlFailure(dl),
    "  取り直すなら `pnpm bundle:fonts`（一時的な失敗ならこれで通ることが多い）。",
  );
}

// 取りこぼし / 0 バイトが無いか検証してから CSS を書く
let totalBytes = 0;
for (const url of woff2Urls) {
  const file = join(tmpDir, localNames.get(url));
  if (!existsSync(file) || statSync(file).size === 0) {
    fail(`Missing or empty chunk: ${localNames.get(url)} (${url})`);
  }
  totalBytes += statSync(file).size;
}

// 5. src の url() を同ディレクトリ相対に書き換えた CSS を生成する。
//    @font-face / unicode-range / コメントは元のまま残す（チャンク構造の維持が目的）。
//    長い URL から先に置換して、短い URL が別 URL の部分文字列だった場合の取り違えを防ぐ。
let localCss = remoteCss;
for (const url of [...woff2Urls].sort((a, b) => b.length - a.length)) {
  localCss = localCss.replaceAll(url, `./${localNames.get(url)}`);
}
const header = [
  "/* 自動生成ファイル — 直接編集しない（scripts/fetch-fonts.mjs が生成 / .gitignore 済み）",
  `   取得元: ${CSS_URL}`,
  "   src の url() は同ディレクトリ相対に書き換え済みなので base 非依存で解決される。*/",
  "",
].join("\n");
writeFileSync(join(tmpDir, CSS_NAME), header + localCss, "utf-8");

// 6. 中間ファイルを落としてから tmp ごと public/fonts/jp/ に差し替える。
//    ディレクトリ単位の rename なので、途中で失敗しても半端な状態が公開されない。
rmSync(remoteCssPath, { force: true });
rmSync(join(tmpDir, CURL_CONFIG_NAME), { force: true });
rmSync(FONTS_DIR, { recursive: true, force: true });
mkdirSync(dirname(FONTS_DIR), { recursive: true });
renameSync(tmpDir, FONTS_DIR);

console.log(
  `[fetch-fonts] Bundled ${woff2Urls.length} subset chunks (${(totalBytes / 1024 / 1024).toFixed(2)}MB):`,
);
console.log(`  - ${FONTS_DIR}`);
console.log(`  - ${cssPath}`);
