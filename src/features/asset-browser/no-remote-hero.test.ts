// リグレッションガード: og:image / leadImage を描画に使う経路を復活させない
//
// 第三者 favicon を潰したあと og:image が同じ形で残っていたのと同様、
// 「hero 画像を出したい」という素直な変更で remote URL が描画経路に戻りやすい。
// urlMeta.ogImage / urlMeta.leadImage は取得元の記録であって描画には使わない、を
// ソース全体に対して機械的に確かめる。描画に使ってよいのは
// urlMeta.previewImage（`media-text:<key>` というローカル参照）を解決した data URL だけ。
//
// 何を見ているか（＝この検査の限界）:
//   - ソース全体の走査（RENDER_PATTERNS）は .ts / .tsx を**1 行ずつ**テキストとして
//     見るだけ。型検査でも実行時検査でもない。
//   - 「シンク（描画の取得先になる書き方）」と「ogImage / leadImage の値としての読み出し」が
//     同じ行に並んでいるものを落とす。行をまたいで変数に退避された値は、変数名が
//     hero / thumb / preview / src を含む場合（下の「hero 変数への代入」）しか追えない。
//   - したがって「素直に書いた漏れ」は止まるが、意図的に迂回されれば抜けられる。
//   - OCR の検査だけは run-ocr の実物を呼ぶ。「ソースに isLocalMediaRef と書いてあるか」
//     を見る形だと、import を残したまま判定だけ外した変更（実際に出た戻し方）が
//     素通りするため。個別ファイルを見る他の検査も、識別子の有無ではなく
//     呼び出し・判定式の形を見る。
//
// シンクの一覧は、この repo で remote URL が実際に描画へ届く経路を辿って作ってある:
//   `<img src>` / `.src =` → backgroundImage・CSS `url()` → Cytoscape の
//   `background-image: data(<key>)`（→ その key を作る mediaUrl / thumbnailUrl /
//   thumbUrl）→ ブロック props の `url`（imageBlock() 等のコンストラクタ経由を含む）。

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { resolveMediaUrl, runOcrForImage } from "../media-ocr/run-ocr";
import { recognizeImage } from "../../lib/ocr";

// OCR の検査で run-ocr の実物を呼ぶための差し替え。
//
// - ストレージプロバイダ: 実体は IndexedDB / OS ファイルシステムを触るので使えない。
//   「自分のスキームの URL からだけ fileId を取り出す」形は実装（providers/local.ts の
//   `^local-media://(.+)$` 等）に合わせてある。外部ホストの URL は実装同様 null を返す。
// - Tesseract: 渡された文字列を自分で fetch する当人。何を渡されたかだけを見る。
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    extractFileId: (url: string) =>
      url.startsWith("local-media://") ? url.slice("local-media://".length) : null,
    getMediaBlobUrl: async (fileId: string) => `blob:graphium/${fileId}`,
  }),
}));
vi.mock("../../lib/ocr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ocr")>()),
  recognizeImage: vi.fn(async () => ({ text: "", confidence: 0 })),
}));

const SRC_ROOT = join(import.meta.dirname, "..", "..");

function collectSourceFiles(
  dir: string,
  match: RegExp,
  out: string[] = [],
): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, match, out);
    } else if (match.test(name) && !/\.(test|stories)\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/** src/ からの相対パス（区切りは常に "/"） */
function relPath(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join("/");
}

/**
 * ogImage / leadImage を「値として読み出している」形。
 *
 * 記録として持つ側 —— キー位置（`ogImage: meta.ogImage` の左辺）、型宣言
 * （`ogImage?: string`）、型に書いた文字列リテラル（Pick<..., "leadImage">）—— は除く。
 * メンバー読み出し（`article.leadImage` / `meta?.ogImage`）と、分割代入や
 * ローカル変数を経由した裸の `leadImage` が対象。
 */
const META = String.raw`(?<![\w$"'])(?:ogImage|leadImage)\b(?![\w$"'])(?!\s*\??\s*:)`;

/** シンクと META が同じ行に並ぶ形を組む（シンクが先） */
function sink(prefix: string): RegExp {
  return new RegExp(prefix + String.raw`[^;\n]*` + META);
}

/** 描画の取得先になる書き方（＝ここに remote URL が入ると外部へ GET が飛ぶ） */
const RENDER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "src={...}", re: sink(String.raw`\bsrc=\{`) },
  // `src: url` / `img.src = url` の両方
  { label: "src への代入", re: sink(String.raw`\bsrc\s*[:=]`) },
  { label: "backgroundImage", re: sink(String.raw`\bbackground-?[iI]mage\b`) },
  { label: "CSS url()", re: sink(String.raw`\burl\(`) },
  // Cytoscape の background-image は data(<key>) 経由で読む。key を作る側
  // （mediaUrl → thumbnailUrl / thumbUrl）に remote URL が入った時点で漏れる。
  // previewImage はローカル参照専用なので、ここに remote URL を入れるのも同罪。
  {
    label: "サムネイル系フィールド",
    re: sink(
      String.raw`\b(?:thumbUrl|thumbnailUrl|thumbnail|mediaUrl|previewImage|imageUrl|imgUrl|heroUrl|posterUrl|poster|coverUrl|photoUrl|iconUrl|avatarUrl)\b`,
    ),
  },
  // ブロック props の url。BlockNote の image / bookmark ブロックは props.url を
  // そのまま `<img src>` に載せるので、ノートを開いた時点で取りに行く。
  { label: "ブロック props の url", re: sink(String.raw`\bprops\b[^;\n]*\burl\b`) },
  { label: "url フィールドへの代入", re: sink(String.raw`\burl\s*[:=]`) },
  // `imageBlock(article.leadImage, ...)` のように、ブロックやサムネイルを組み立てる
  // 関数へ渡す形。渡した先で props.url になるため、呼び出し側で止める。
  {
    label: "画像ブロック生成関数への受け渡し",
    re: sink(String.raw`\b\w*(?:[iI]mage|[iI]mg|[tT]humb|[hH]ero|[pP]review|[pP]oster|[aA]vatar|[iI]con)\w*\s*\(`),
  },
  // 描画時の直接取得。取り込みは capture 時に pickPreviewSource → sidecar の
  // image-proxy 経由でだけ行う（preview-image.ts）ので、ここに og:image の値は来ない。
  { label: "直接 fetch", re: sink(String.raw`\b(?:fetch|axios(?:\.\w+)?)\s*\(`) },
  // `const hero = urlMeta?.leadImage || urlMeta?.ogImage` 経由で src に渡る形。
  // これが以前の実装そのものなので、名前づけの段階で止める。
  {
    label: "hero 変数への代入",
    re: new RegExp(
      String.raw`\b(?:const|let|var)\s+\w*(?:hero|thumb|preview|src)\w*\s*(?::[^=]*)?=\s*[^;\n]*` + META,
      "i",
    ),
  },
];

/**
 * ローカル / 外部の判定を自前で組み直している宣言を探し、その名前を返す。
 *
 * 見ているのは「`local-media://` と `file-media://` を隣り合う行に並べ、それを囲む
 * 宣言の名前が local / remote / external を含む」形。名前まで見るのは、同じスキームを
 * 並べていても別の問いに答えている一覧があるため —— sharing/SharedLibraryView.tsx の
 * isUnresolvableMediaUrl は「この共有ビューでは実体を解決できない参照か」で、載って
 * いるのは全部ネットワークへ出ないスキーム。判定を外しても壊れ画像の代わりに案内文が
 * 出るか出ないかが変わるだけで、外部への取得は 1 件も生まれない。
 *
 * 裏を返すと、ローカル判定を local / remote / external を含まない名前で書き直された
 * 場合はここでは気付けない。これは規約の可視化であって強制ではない。
 */
function findLocalRefAllowlists(source: string): string[] {
  const lines = source.split("\n");
  const owners: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // 2 行の窓で「2 つのスキームを並べている」形を見る（並び順は問わない）
    const window = lines.slice(i, i + 2).join("\n");
    if (!/["']local-media:\/\/["']/.test(window)) continue;
    if (!/["']file-media:\/\/["']/.test(window)) continue;
    // それを囲んでいる宣言の名前を遡って探す
    let owner = "";
    for (let j = i; j >= 0; j--) {
      const decl = lines[j].match(/^\s*(?:export\s+)?(?:const|let|var|function)\s+(\w+)/);
      if (decl) {
        owner = decl[1];
        break;
      }
    }
    if (/local|remote|external/i.test(owner)) owners.push(owner);
  }
  return [...new Set(owners)];
}

type Hit = { file: string; line: number; label: string; code: string };

/**
 * remote URL をローカル実体へ取り込む「洗浄」関数。
 *
 * ここへ remote URL を渡すのは漏れではなく、漏れを止めている当の処理なので
 * 対象外にする。取り込み口を新しく作ったときだけここに足すこと（＝足すという
 * 行為が「この関数は本当に取り込んでいるか」を読み直す機会になる）。
 */
const LAUNDERING_CALLS = [
  // 取り込み時に sidecar 経由でバイト列を取り、ローカル URL を返す。
  // 呼び出し元は pdf-translate（記事の lead 画像）と
  // blocks/remote-content/use-remote-image-import（本文に貼られた画像）。
  "saveRemoteImageAsMedia",
  // asset-browser/preview-image.ts: 同じことを media-text チャネルに対して行う
  "ensureCachedPreviewImage",
];
const LAUNDERING_CALL_RE = new RegExp(
  String.raw`\b(?:${LAUNDERING_CALLS.join("|")})\s*\(`,
  "g",
);
/** 洗浄関数の戻り値を受けた識別子（そのファイルの中では local 参照とみなす） */
const LAUNDERED_BINDING_RE = new RegExp(
  String.raw`\b(ogImage|leadImage)\s*=\s*(?:await\s+)?(?:${LAUNDERING_CALLS.join("|")})\s*\(`,
  "g",
);

/**
 * 洗浄済み識別子の **裸の** 出現だけを潰す。
 *
 * `const leadImage = await saveRemoteImageAsMedia(...)` のあとの `leadImage` は
 * `{url, name}` のローカルオブジェクトなので、`imageBlock(leadImage.url, ...)` は漏れではない。
 * 一方 `article.leadImage` のようなメンバー参照は配信元の URL そのものなので潰さない
 * （＝洗浄済みの名前と同名のプロパティを読んでも、検出はすり抜けない）。
 */
function maskLaundered(line: string, names: Set<string>): string {
  let out = line;
  for (const name of names) {
    out = out.replace(new RegExp(String.raw`(?<![.\w$])${name}\b`, "g"), "__local__");
  }
  return out;
}

/**
 * 既知の例外（ファイル・行の中身の完全一致で、許す行数も指定する）。
 *
 * 「直すべきだが別タスクで進行中」のような、赤にしても止められない漏れを一時的に
 * 通すための逃げ道。今は空 —— 空であることが「見逃している既知の漏れは無い」の意味。
 * 追加するときは必ず、いつ誰が消すのかをコメントに書くこと。
 */
const KNOWN_EXCEPTIONS: { file: string; code: string; maxLines: number }[] = [];

describe("og:image を描画に使う経路が復活していない", () => {
  const files = collectSourceFiles(SRC_ROOT, /\.tsx?$/);

  it("走査対象がある（パス解決の壊れを検出する）", () => {
    expect(files.length).toBeGreaterThan(100);
    // 件数だけでは足りない。SRC_ROOT が src の下（features 等）へずれても閾値は超えたままで、
    // 走査系の検査が「blocks を一度も見ないまま緑」になる。各ツリーの目印で src 自身を確かめる。
    // 目印を消す・動かすときは、この一覧も一緒に直すこと。
    const rels = files.map(relPath);
    for (const sentinel of [
      "note-app.tsx",
      "blocks/bookmark/view.tsx",
      "features/media-ocr/run-ocr.ts",
      "lib/storage/registry.ts",
    ]) {
      expect(rels).toContain(sentinel);
    }
  });

  it("ogImage / leadImage を画像の取得先に渡しているソースが無い", () => {
    const hits: Hit[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      if (!source.includes("ogImage") && !source.includes("leadImage")) continue;
      // このファイルの中で洗浄関数の戻り値を受けている名前を先に拾う
      const laundered = new Set(
        Array.from(source.matchAll(LAUNDERED_BINDING_RE), (m) => m[1]),
      );
      source.split("\n").forEach((line, i) => {
        // コメント行は対象外（この規約を説明している行が大量にある）
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        // 洗浄関数への受け渡しそのものは漏れではない。ただし行ごと飛ばすと同じ行に
        // 書かれた本物の漏れまで見逃すので、関数名だけを潰してシンク判定から外す。
        let scanned = line.replace(LAUNDERING_CALL_RE, "__launder__(");
        if (laundered.size) scanned = maskLaundered(scanned, laundered);
        for (const { label, re } of RENDER_PATTERNS) {
          if (re.test(scanned)) hits.push({ file: relPath(file), line: i + 1, label, code });
        }
      });
    }

    // 既知の例外を差し引く。1 行が複数のシンクに当たることがあるので、
    // 「行」単位で許可し、許可した行の当たりはまとめて落とす。
    const used = KNOWN_EXCEPTIONS.map(() => new Set<string>());
    const remaining = hits.filter((hit) => {
      const at = `${hit.file}:${hit.line}`;
      const i = KNOWN_EXCEPTIONS.findIndex(
        (ex, idx) =>
          ex.file === hit.file &&
          ex.code === hit.code &&
          (used[idx].has(at) || used[idx].size < ex.maxLines),
      );
      if (i === -1) return true;
      used[i].add(at);
      return false;
    });

    // 例外が使われなくなった＝本体が直った合図。落とさずに知らせるだけにする
    // （直した側のセッションを赤で止めないため）。
    KNOWN_EXCEPTIONS.forEach((ex, idx) => {
      if (used[idx].size === 0) {
        console.warn(`[no-remote-hero] 未使用の例外: ${ex.file} — 修正済みなら KNOWN_EXCEPTIONS から削除してください`);
      }
    });

    expect(remaining.map((h) => `${h.file}:${h.line}: ${h.label} — ${h.code}`)).toEqual([]);
  });

  it("ブックマークブロックが props.ogImage を描画していない", () => {
    // ノート本文のカードは media-index とは別の保存先（ブロック props）を持つ。
    // ここを直し忘れると、既存ノートを開くだけで配信元へ GET が飛ぶ。
    const source = readFileSync(join(SRC_ROOT, "blocks", "bookmark", "view.tsx"), "utf-8");
    expect(source).not.toMatch(/src=\{\s*(meta\.)?ogImage/);
    // props への書き戻しも空文字だけ（fetch した値をそのまま入れない）
    expect(source).not.toMatch(/ogImage:\s*(newMeta|fetched|meta)\./);
  });

  it("Cytoscape の background-image が検証済みのデータキーだけを参照している", () => {
    // Cytoscape は background-image を描画時に取得するので、`data(<key>)` に載せた URL は
    // その時点でそのまま外へ出る。ここは「今どの key が背景画像に結線されているか」を
    // 固定するだけの検査で、key の中身が安全かどうかまでは見ていない。
    // 新しい key を足すときは、その生成箇所を読んで remote URL が入り得ないことを
    // 確かめてからこの一覧に加えること。
    const ALLOWED_DATA_KEYS = new Set([
      // fileId から解決したサムネイル（blob: / data:）だけを載せている
      "thumbUrl", // network-graph/view.tsx, asset-browser/asset-graph-panel.tsx
      // provToCytoscapeElements が elements 組み立て時に正規化してから載せている
      "thumbnailUrl", // prov-generator/cy-graph.ts
    ]);
    const bad: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT, /\.tsx?$/)) {
      const source = readFileSync(file, "utf-8");
      // "background-image": <値> だけを見る（-opacity / -crossorigin は別キー）
      for (const m of source.matchAll(/["']background-image["']\s*:\s*([^,\n]+)/g)) {
        const value = m[1].trim();
        const data = value.match(/^["']data\((\w+)\)["']/);
        if (!data || !ALLOWED_DATA_KEYS.has(data[1])) {
          bad.push(`${relPath(file)}: background-image: ${value}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("ブロック props の url を取得先に載せているのはゲート配下だけ", () => {
    // ノート本文のメディアブロックは props.url をそのまま `<img src>` に載せる実装が
    // 標準。それを差し替えたのが blocks/remote-content で、外部 URL は同意まで
    // 標準 render を呼ばないことで止めている。ここを迂回して別の場所で
    // props.url を描画に載せると、その経路だけゲートが効かなくなる。
    //
    // 見ているのは「シンクと props.url が同じ行に並ぶ形」だけ。変数に退避されれば
    // 追えないので、これは規約の可視化であって強制ではない。
    const SINKS = [
      String.raw`\bsrc=\{`,
      String.raw`\bsrc\s*[:=]`,
      String.raw`\bbackground-?[iI]mage\b`,
      // react-pdf の <Document file={...} /> は渡された URL を pdf.js が取りに行く
      String.raw`\bfile=\{`,
    ];
    const PROPS_URL = String.raw`\b(?:props|block\.props|\w+\.props)\b[^;\n]*\burl\b|\burl\b[^;\n]*\bprops\b`;
    const ALLOWED_DIRS = ["blocks/remote-content/"];
    const bad: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT, /\.tsx?$/)) {
      const rel = relPath(file);
      if (ALLOWED_DIRS.some((d) => rel.startsWith(d))) continue;
      const source = readFileSync(file, "utf-8");
      if (!source.includes("props")) continue;
      source.split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        for (const s of SINKS) {
          if (new RegExp(s + String.raw`[^;\n]*(?:` + PROPS_URL + ")").test(line)) {
            bad.push(`${rel}:${i + 1}: ${code}`);
          }
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("印刷（PDF 保存）が画面に無い取得先を足さず、同意も勝手に立てていない", () => {
    // 旧 export-pdf.ts（html2pdf / html2canvas）はクローン内の `<img>` を useCORS: true で
    // **取り直して**いた ＝ ブロックの実装を通らない第 2 の取得経路だったので、書き出し側で
    // remote な src を落とす必要があった。print-note.ts はブラウザ自身に印刷させるので
    // 取り直しは無く、守るべき性質は「画面が要求していないものを紙面に足さない」に変わる。
    //
    // 見ているのは print-note.ts が組み立てる印刷ツリーの中身。ヘッダー（文字だけ）、
    // 画面 DOM のクローン、ローカルで描いた PROV グラフの data URI —— この 3 つ以外を
    // 足していないことを、ソースの形で固定する。実物を呼ぶ検査にしていないのは、
    // printNote が cytoscape と document・印刷ダイアログを要求するため。
    const source = readFileSync(
      join(SRC_ROOT, "features", "pdf-export", "print-note.ts"),
      "utf-8",
    );

    // 印刷ツリーに入るのはこの 3 つだけ
    const appended = Array.from(
      source.matchAll(/root\.appendChild\(([^;\n]+)\);/g),
      (m) => m[1].trim(),
    );
    expect(appended).toEqual([
      "buildHeader(title, labels)",
      "cloneEditorContent(editorElement)",
      "section",
    ]);

    // 本文と見出しを組む側は取得先になる要素を作らない。クローンがしているのは
    // 操作 UI の除去と textarea → div の置き換えだけで、src には触らない。
    for (const name of ["buildHeader", "cloneEditorContent"]) {
      const fn = source.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`))?.[0] ?? "";
      expect(fn, `${name} を読み出せていない（検査が空振りしている）`).not.toBe("");
      expect(fn, `${name} が src を触っている`).not.toMatch(/\bsrc\b/);
      expect(fn, `${name} が取得先になる要素を作っている`).not.toMatch(
        /createElement(?:NS)?\s*\(\s*["'](?:img|image|video|audio|source|iframe|embed|link|script)\b/i,
      );
    }

    // 印刷が自分で入れる画像は PROV グラフ 1 枚だけ。値はオフスクリーンの Cytoscape が
    // その場で描いた base64 の data URI で、外部ホストを指しようがない。
    const assigned = Array.from(
      source.matchAll(/\.\s*src\s*=\s*([^;\n]+)/g),
      (m) => m[1].trim(),
    );
    expect(assigned).toEqual(["pngDataUrl"]);
    expect(source).toMatch(/const pngDataUrl = await renderProvGraphToPng\(/);
    expect(source).toMatch(/cy\.png\(\{\s*output:\s*"base64uri"/);
    // src 以外の取得先属性で入れ替えていない
    expect(source).not.toMatch(
      /setAttribute\(\s*["'](?:src|srcset|href|data|poster|xlink:href)["']/,
    );
    // 画面の要求を待つだけで、自分では取りに行かない（旧経路の useCORS 相当が無い）
    for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /new Image\s*\(/, /useCORS/]) {
      expect(source, `print-note.ts に ${forbidden} が生えている`).not.toMatch(forbidden);
    }
    // 「紙面を綺麗にするため」に読み込みを立てるのは、無言の書き出しをビーコンにする
    expect(source).not.toMatch(/allowRemoteContentFor/);
  });

  it("OCR が外部ホストの URL を Tesseract に渡さない", async () => {
    // Tesseract は渡された文字列を自分で fetch する。本文の描画を止めていても、
    // OCR 経由で同じ URL へ要求が出れば同じ漏れになる。
    //
    // ここだけは実物を呼ぶ。ソースに isLocalMediaRef があるかを見る形だと、
    // import を残したまま `return url;` に戻す変更（＝実際に出た戻し方）で緑のままになる。
    // 見ているのは resolveMediaUrl の戻り値と、runOcrForImage が recognizeImage へ
    // 渡した文字列。アプリ内の OCR 呼び出しは全部この 2 つを通る。
    const recognize = vi.mocked(recognizeImage);
    recognize.mockClear();

    // 外部ホストを指す形は、取りに行ける値にならない（＝空文字で止まる）
    for (const remote of [
      "https://example.com/a.png",
      "http://example.com/a.png",
      "//example.com/a.png", // プロトコル相対。ページのスキームで解決されて外へ出る
      "a.png", // 相対パス。同上
      "HTTPS://EXAMPLE.COM/a.png",
    ]) {
      expect(await resolveMediaUrl(remote)).toBe("");
      await expect(runOcrForImage(remote)).rejects.toThrow();
    }
    expect(recognize).not.toHaveBeenCalled();

    // 手元に実体がある参照は通る（止めすぎて OCR が動かなくなっていないこと）
    expect(await resolveMediaUrl("local-media://abc")).toBe("blob:graphium/abc");
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(await resolveMediaUrl(dataUrl)).toBe(dataUrl);
    await runOcrForImage(dataUrl);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0][0]).toBe(dataUrl);

    // 以前の実装（プロバイダが解決できない URL をそのまま返す）に戻していないか
    const source = readFileSync(join(SRC_ROOT, "features", "media-ocr", "run-ocr.ts"), "utf-8");
    expect(source).not.toMatch(/if \(!fileId\) return url;/);
  });

  it("貼り付け時の取り込みが image-proxy 以外の経路を持たない", () => {
    // 本文に入った外部画像は image-proxy 経由でしか取りに行かない。ここに直接の
    // fetch / new Image() が生えると、ブラウザから配信元へ出る経路が復活する
    // （プロキシが消している Cookie・UA・Referer も一緒に戻る）。
    // 呼び出し元だけを見ても足りない。洗浄関数の**中身**に直接の取得が生えても
    // 同じ漏れになるし、実際その形で検査を素通りした。取り込み経路の両方を見る。
    const importFlow = {
      "blocks/remote-content/use-remote-image-import.ts": readFileSync(
        join(SRC_ROOT, "blocks", "remote-content", "use-remote-image-import.ts"),
        "utf-8",
      ),
      "features/asset-browser/remote-image.ts": readFileSync(
        join(SRC_ROOT, "features", "asset-browser", "remote-image.ts"),
        "utf-8",
      ),
    };
    const source = importFlow["blocks/remote-content/use-remote-image-import.ts"];
    // 呼び出しの形で見る（import が残っているだけでは通さない）
    expect(source).toMatch(/saveRemoteImageAsMedia\s*\(/);
    const FORBIDDEN = [
      /new Image\s*\(/,
      /XMLHttpRequest/,
      // `new Image()` と同じ機構。要素を DOM に挿さなくても src 代入で取得が走るので、
      // コンストラクタだけを禁止しても塞げない（実際この形で検査を素通りした）。
      /createElement(?:NS)?\s*\(\s*['"`]?[^)]*\b(?:img|image|video|audio|source|iframe|embed|link|script)\b/i,
      // 画像・メディア要素を作らずに取得する経路
      /\bnavigator\s*\.\s*sendBeacon\b/,
      /\bnew\s+(?:EventSource|WebSocket)\s*\(/,
      /\bimport\s*\(/,
    ];
    for (const [name, text] of Object.entries(importFlow)) {
      for (const forbidden of FORBIDDEN) {
        expect(text, `${name} に ${forbidden} が生えている`).not.toMatch(forbidden);
      }
    }
    // 呼び出し元は自分で取りに行かない（洗浄関数に任せる）
    expect(source, "use-remote-image-import.ts に直接の fetch が生えている").not.toMatch(
      /\bfetch\s*\(/,
    );
    // 洗浄関数だけが fetch を持ってよい。ただし宛先は自前 origin の image-proxy だけ。
    // proxy URL は一度変数に組んでから渡すので、呼び出し行だけ見ても宛先が判らない。
    // 「proxy URL を受けた変数」を取り出し、fetch がそれ以外を渡していないかで見る。
    const laundry = importFlow["features/asset-browser/remote-image.ts"];
    const proxyVar = laundry.match(
      /const\s+(\w+)\s*=\s*`\$\{apiBase\(\)\}\/url\/image-proxy/,
    );
    expect(proxyVar, "remote-image.ts が image-proxy の URL を組み立てていない").toBeTruthy();
    const fetchArgs = Array.from(laundry.matchAll(/\bfetch\s*\(\s*([^,)]+)/g), (m) => m[1].trim());
    expect(fetchArgs.length, "remote-image.ts の fetch が消えている").toBeGreaterThan(0);
    for (const arg of fetchArgs) {
      expect(arg, "remote-image.ts の fetch が image-proxy 以外を叩いている").toBe(proxyVar![1]);
    }
    // 取り込めなかったときに remote URL を書き戻さない（＝描画へ回さない）。
    // 書き戻す形は「取り込み結果ではないものを props.url に入れる」なので、
    // updateBlock に渡す url が local の戻り値であることだけを許す。
    const writes = source.match(/props:\s*\{\s*url:\s*[^,\n}]+/g) ?? [];
    expect(writes.length).toBeGreaterThan(0); // 書き戻し自体が消えていたら検査が空振り
    for (const write of writes) {
      expect(write).toMatch(/url:\s*local\.url/);
    }
  });

  it("ローカル判定の許可リストが 1 本しかない", () => {
    // 2 本目ができると必ず片方だけ更新されて、そちらの経路から漏れる。
    // 判定の実体は local-media-ref.ts のみ。
    const bad: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT, /\.tsx?$/)) {
      const rel = relPath(file);
      if (rel === "features/asset-browser/local-media-ref.ts") continue;
      for (const owner of findLocalRefAllowlists(readFileSync(file, "utf-8"))) {
        bad.push(`${rel}: ${owner}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("この検出ロジックが 2 本目の許可リストを見逃さない", () => {
    // ガードが実際に効くことを確かめる（常に空を返すだけの検出では意味がない）
    expect(
      findLocalRefAllowlists(
        ["const LOCAL_PREFIXES = [", '  "local-media://",', '  "file-media://",', "];"].join("\n"),
      ),
    ).toEqual(["LOCAL_PREFIXES"]);
    expect(
      findLocalRefAllowlists(
        [
          "function isLocalRef(url: string): boolean {",
          '  return url.startsWith("file-media://") || url.startsWith("local-media://");',
          "}",
        ].join("\n"),
      ),
    ).toEqual(["isLocalRef"]);
    // 同じスキームを並べていても、別の問いに答えている一覧は拾わない
    // （findLocalRefAllowlists の doc 参照。実在するのは SharedLibraryView.tsx のこれ）
    expect(
      findLocalRefAllowlists(
        [
          "function isUnresolvableMediaUrl(url: string): boolean {",
          "  return (",
          '    url.startsWith("shared-blob:") ||',
          '    url.startsWith("file-media://") ||',
          '    url.startsWith("local-media://")',
          "  );",
          "}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("スタイルシートが外部ホストの画像・フォントを参照していない", () => {
    // webfont を self-host した分の据え置き。CSS の url() は「そのページを開いた」だけで
    // 取りに行くので、http(s):// と プロトコル相対 // は許さない（相対パスと data: のみ）。
    const bad: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT, /\.css$/)) {
      const source = readFileSync(file, "utf-8");
      for (const line of source.split("\n")) {
        if (/url\(\s*["']?(?:https?:)?\/\//i.test(line)) bad.push(`${relPath(file)}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("ゲート分岐を持つブロックは書き出し用 HTML を自前で持っている", () => {
    // createReactBlockSpec は toExternalHTML を渡さないと render に落ちる
    // （ReactBlockSpec.tsx の `blockImplementation.toExternalHTML || blockImplementation.render`）。
    // ゲート分岐を持つ spec でこれをやると、ブロック中のノートを書き出したときに
    // 枠の文言が本文として入り、URL は 1 文字も残らない。画面には何も出ないまま
    // 書き出しの中身が消えるので、元の漏れよりたちが悪い（bookmark と pdf で実際に起きた）。
    //
    // ゲートを見ない spec（callout / step 等）は BlockNote の既定の落とし方で正しいので、
    // ここでは「ゲートを参照している spec」だけに要求する。
    const GATE_HINT = /remote-content|remoteAllowed|isRemoteContentAllowed|\bgated\b/;
    const missing: string[] = [];
    for (const file of collectSourceFiles(join(SRC_ROOT, "blocks"), /\.tsx?$/)) {
      const source = readFileSync(file, "utf-8");
      if (!source.includes("createReactBlockSpec(")) continue;
      if (!GATE_HINT.test(source)) continue;
      if (!/\btoExternalHTML\s*:/.test(source)) missing.push(relPath(file));
    }
    expect(missing).toEqual([]);
  });
});
