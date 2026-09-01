// @vitest-environment jsdom
// 一括 Markdown 変換（doc-to-markdown.ts）の回帰ガード。
//
// 守りたい不変条件は 2 つ:
//  1. 変換のあいだ、取得を行う要素（img / video / audio）を 1 つも作らない。
//     BlockNote 標準の image / video / audio は HTML 化で `<img>` を作って src に
//     URL を代入する。この要素は画面の document に属するので、DOM に挿さっていなく
//     ても代入した時点で取りに行く（`new Image().src = url` と同じ）。書き出しは
//     画面を持たないため、止めそこねると「全ノートの外部 URL を、誰にも見えない
//     まま一斉に叩く」経路になる。「DOM に無い」では止まらないので、要素が
//     生成されたか・src が代入されたかを直接見る。
//  2. 出力の Markdown は素の default スキーマで変換したときと 1 文字も変わらない。
//     URL は `![name](https://…)` としてテキストのまま残す。URL を落として静かに
//     するのは直し方ではない（書き出したファイルから元の在処が消える）。
//
// 2 は期待値をベタ書きせず、素の defaultBlockSpecs で組んだエディタの出力と
// 突き合わせる。BlockNote 側の出力が変わったときも、差分としてここで見える。

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";

// 全ノート一括の入口（exportAllNotesAsMarkdownZip）まで通すため、
// ダウンロードだけ差し替える。zip の中身は bulk-export.test.ts が見ている。
vi.mock("../../lib/download-file", () => ({ downloadBlob: vi.fn(async () => {}) }));

import { graphiumDocToMarkdown } from "./doc-to-markdown";
import { exportAllNotesAsMarkdownZip } from "./bulk-export";
import { sanitizeBlocksForMarkdown } from "./sanitize-blocks";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";

const REMOTE_IMAGE = "https://tracker.example/pixel/abc123.png";
const REMOTE_VIDEO = "https://tracker.example/v.mp4";
const REMOTE_AUDIO = "https://tracker.example/a.mp3";
const REMOTE_FILE = "https://tracker.example/f.zip";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

function block(type: string, props: Record<string, unknown>): AnyBlock {
  return { id: `b-${type}`, type, props, children: [] };
}

function paragraph(text: string): AnyBlock {
  return { id: `p-${text}`, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] };
}

function makeDoc(blocks: AnyBlock[]): GraphiumDocument {
  const now = "2026-08-04T00:00:00.000Z";
  return {
    version: 5,
    title: "Note",
    pages: [{ id: "p1", title: "Note", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: now,
    modifiedAt: now,
    source: "human",
  } as unknown as GraphiumDocument;
}

// ── 突き合わせ用の「素の」変換 ──
// doc-to-markdown.ts が差し替え前にやっていたのと同じ組み立て（素の defaultBlockSpecs）。
const referenceEditor = BlockNoteEditor.create({
  schema: BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs, styleSpecs: defaultStyleSpecs }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const referenceSchemaInfo = {
  knownBlockTypes: new Set(Object.keys(defaultBlockSpecs)),
  knownStyles: new Set(Object.keys(defaultStyleSpecs)),
};

async function referenceMarkdown(blocks: AnyBlock[]): Promise<string> {
  const sanitized = sanitizeBlocksForMarkdown(blocks, referenceSchemaInfo);
  const markdown: string = await referenceEditor.blocksToMarkdownLossy(sanitized);
  return markdown.trim();
}

/** 出力が空同士で一致する「見かけの一致」を弾いてから突き合わせる */
async function expectSameAsReference(blocks: AnyBlock[]): Promise<void> {
  const expected = await referenceMarkdown(blocks);
  expect(expected).not.toBe("");
  expect(await graphiumDocToMarkdown(makeDoc(blocks))).toBe(expected);
}

// ── センサー ──

type SrcAssignment = { tag: string; attr: string; value: string; live: boolean };

/**
 * src 系 IDL セッターに仕掛けるセンサー。
 * live は「その要素の document が画面の document か」。true なら DOM に挿さって
 * いなくても取得が走る位置なので、代入が 1 件でもあれば要求が出ている。
 */
function installSrcSensor(): { seen: SrcAssignment[]; restore: () => void } {
  const seen: SrcAssignment[] = [];
  const restores: (() => void)[] = [];
  const watch = (proto: object, attr: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, attr);
    if (!descriptor?.set) return;
    const originalSet = descriptor.set;
    Object.defineProperty(proto, attr, {
      ...descriptor,
      set(this: Element, value: unknown) {
        seen.push({
          tag: this.tagName.toLowerCase(),
          attr,
          value: String(value),
          live: this.ownerDocument === document,
        });
        originalSet.call(this, value);
      },
    });
    restores.push(() => Object.defineProperty(proto, attr, descriptor));
  };
  watch(HTMLImageElement.prototype, "src");
  watch(HTMLImageElement.prototype, "srcset");
  watch(HTMLMediaElement.prototype, "src");
  watch(HTMLSourceElement.prototype, "src");
  watch(HTMLIFrameElement.prototype, "src");
  return { seen, restore: () => restores.forEach((restore) => restore()) };
}

/** createElement された要素名を記録する（差し替えが効いていれば img は通らない） */
function recordCreatedTags(): { created: string[]; restore: () => void } {
  const created: string[] = [];
  const original = document.createElement;
  document.createElement = function (this: Document, tagName: string, options?: ElementCreationOptions) {
    created.push(tagName.toLowerCase());
    return original.call(this, tagName, options);
  } as typeof document.createElement;
  return {
    created,
    restore: () => {
      document.createElement = original;
    },
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

beforeAll(async () => {
  // ヘッドレスエディタは初回変換時に 1 個作って使い回す。その生成分が
  // センサーに混ざらないよう、計測前に暖めておく。
  await graphiumDocToMarkdown(makeDoc([paragraph("warm up")]));
});

describe("外部 URL への要求", () => {
  const mediaDoc = () =>
    makeDoc([
      paragraph("before"),
      block("image", { url: REMOTE_IMAGE, name: "shot.png" }),
      block("video", { url: REMOTE_VIDEO, name: "v.mp4" }),
      block("audio", { url: REMOTE_AUDIO, name: "a.mp3" }),
      block("file", { url: REMOTE_FILE, name: "f.zip" }),
      block("bookmark", { url: "https://tracker.example/page", title: "Page", domain: "tracker.example" }),
      paragraph("after"),
    ]);

  it("変換中に img / video / audio を作らない", async () => {
    const recorder = recordCreatedTags();
    cleanups.push(recorder.restore);
    await graphiumDocToMarkdown(mediaDoc());
    recorder.restore();
    expect(recorder.created).not.toContain("img");
    expect(recorder.created).not.toContain("video");
    expect(recorder.created).not.toContain("audio");
    // 記録自体は動いている（`<a>` などは従来どおり作られる）
    expect(recorder.created.length).toBeGreaterThan(0);
  });

  it("src への代入が 1 件も起きない", async () => {
    const sensor = installSrcSensor();
    cleanups.push(sensor.restore);
    await graphiumDocToMarkdown(mediaDoc());
    sensor.restore();
    expect(sensor.seen).toEqual([]);
  });

  it("それでも URL は Markdown にそのまま残る", async () => {
    const markdown = await graphiumDocToMarkdown(mediaDoc());
    expect(markdown).toContain(`![shot.png](${REMOTE_IMAGE})`);
    expect(markdown).toContain(`![](${REMOTE_VIDEO})`);
    expect(markdown).toContain(REMOTE_AUDIO);
    expect(markdown).toContain(`[f.zip](${REMOTE_FILE})`);
    expect(markdown).toContain("https://tracker.example/page");
  });

  it("全ノート一括の入口から通しても要求が出ない", async () => {
    // 報告された経路そのもの: 保管庫まるごとを Markdown で書き出す。
    const docs = { "id-1": mediaDoc(), "id-2": mediaDoc() };
    const provider = {
      listFiles: async () =>
        Object.keys(docs).map((id) => ({
          id,
          name: `${id}.json`,
          modifiedTime: "2026-08-04T00:00:00.000Z",
          createdTime: "2026-08-04T00:00:00.000Z",
        })),
      loadFile: async (id: string) => docs[id as keyof typeof docs],
    } as unknown as StorageProvider;

    const sensor = installSrcSensor();
    const recorder = recordCreatedTags();
    cleanups.push(sensor.restore, recorder.restore);
    const result = await exportAllNotesAsMarkdownZip(provider);
    recorder.restore();
    sensor.restore();

    expect(result).toEqual({ exported: 2, failed: 0 });
    expect(sensor.seen).toEqual([]);
    expect(recorder.created).not.toContain("img");
    expect(recorder.created).not.toContain("video");
    expect(recorder.created).not.toContain("audio");
  });

  it("2 回目以降（使い回されるヘッドレスエディタ）でも要求が出ない", async () => {
    // ヘッドレスエディタはモジュール内で 1 個を使い回すので、初回だけ安全でも
    // 意味が無い。なお doc-to-markdown は blocks/remote-content の同意状態を
    // 一切読まない（import もしない）ため、経路はゲートの状態に関わらずここ 1 本。
    const sensor = installSrcSensor();
    const recorder = recordCreatedTags();
    cleanups.push(sensor.restore, recorder.restore);
    await graphiumDocToMarkdown(mediaDoc());
    await graphiumDocToMarkdown(mediaDoc());
    recorder.restore();
    sensor.restore();
    expect(sensor.seen).toEqual([]);
    expect(recorder.created).not.toContain("img");
  });
});

describe("Markdown 出力（素の default スキーマとの突き合わせ）", () => {
  const cases: [string, AnyBlock][] = [
    ["image", block("image", { url: REMOTE_IMAGE })],
    ["image + name", block("image", { url: REMOTE_IMAGE, name: "shot.png" })],
    ["image + caption", block("image", { url: REMOTE_IMAGE, caption: "a cap" })],
    ["image + name + caption", block("image", { url: REMOTE_IMAGE, name: "shot.png", caption: "a cap" })],
    ["image (プレビュー無し)", block("image", { url: REMOTE_IMAGE, name: "shot.png", showPreview: false })],
    [
      "image (プレビュー無し + caption)",
      block("image", { url: REMOTE_IMAGE, name: "shot.png", caption: "a cap", showPreview: false }),
    ],
    ["image + previewWidth", block("image", { url: REMOTE_IMAGE, name: "shot.png", previewWidth: 300 })],
    ["image (URL 未設定)", block("image", { url: "" })],
    ["image (ローカル参照)", block("image", { url: "graphium-media://abc", name: "local.png" })],
    ["image (data URL)", block("image", { url: "data:image/png;base64,AAAA", name: "d.png" })],
    ["image (空白入り URL)", block("image", { url: "https://t.example/a b(1).png", name: "w" })],
    ["image (記号入りファイル名)", block("image", { url: REMOTE_IMAGE, name: "a]b*c_d.png" })],
    ["image (& 入り URL)", block("image", { url: "https://t.example/p?a=1&b=2", name: "q&a.png" })],
    ["image + 背景色", block("image", { url: REMOTE_IMAGE, name: "n", backgroundColor: "blue", textAlignment: "center" })],
    ["video", block("video", { url: REMOTE_VIDEO })],
    ["video + name", block("video", { url: REMOTE_VIDEO, name: "v.mp4" })],
    ["video + caption", block("video", { url: REMOTE_VIDEO, name: "v.mp4", caption: "vc" })],
    ["video (プレビュー無し)", block("video", { url: REMOTE_VIDEO, name: "v.mp4", showPreview: false })],
    ["video + previewWidth", block("video", { url: REMOTE_VIDEO, previewWidth: 320 })],
    ["video (URL 未設定)", block("video", { url: "" })],
    ["audio", block("audio", { url: REMOTE_AUDIO })],
    ["audio + name", block("audio", { url: REMOTE_AUDIO, name: "a.mp3" })],
    ["audio + caption", block("audio", { url: REMOTE_AUDIO, name: "a.mp3", caption: "ac" })],
    ["audio (プレビュー無し)", block("audio", { url: REMOTE_AUDIO, name: "a.mp3", showPreview: false })],
    ["audio (URL 未設定)", block("audio", { url: "" })],
    ["file", block("file", { url: REMOTE_FILE })],
    ["file + name", block("file", { url: REMOTE_FILE, name: "f.zip" })],
    ["file + caption", block("file", { url: REMOTE_FILE, name: "f.zip", caption: "fc" })],
    ["file (URL 未設定)", block("file", { url: "" })],
    ["bookmark", block("bookmark", { url: "https://tracker.example/page", title: "Page", domain: "tracker.example" })],
    // 登録型名は "pdf"。"pdfViewer" と書くと未知ブロック扱いで空になり、検査が空振りする
    ["pdf", block("pdf", { url: "https://tracker.example/doc.pdf", name: "doc.pdf" })],
  ];

  it.each(cases)("%s", async (_label, target) => {
    await expectSameAsReference([target]);
  });

  const structural: [string, AnyBlock[]][] = [
    ["段落に挟まれた image", [paragraph("before"), block("image", { url: REMOTE_IMAGE, name: "shot.png" }), paragraph("after")]],
    [
      "リスト項目の子の image",
      [
        {
          id: "li",
          type: "bulletListItem",
          props: {},
          content: [{ type: "text", text: "item", styles: {} }],
          children: [block("image", { url: REMOTE_IMAGE, name: "shot.png" })],
        },
      ],
    ],
    [
      "連続する image",
      [block("image", { url: REMOTE_IMAGE, name: "a.png" }), block("image", { url: `${REMOTE_IMAGE}?2`, name: "b.png" })],
    ],
    // 差し替えはメディア系だけでなく全 spec に掛かるので、標準ブロックの出力も
    // 変わっていないことを見る
    [
      "標準ブロック一式",
      [
        { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "見出し", styles: {} }], children: [] },
        { id: "b", type: "bulletListItem", props: {}, content: [{ type: "text", text: "箇条書き", styles: {} }], children: [] },
        { id: "n", type: "numberedListItem", props: {}, content: [{ type: "text", text: "番号付き", styles: {} }], children: [] },
        { id: "c", type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "済み", styles: {} }], children: [] },
        { id: "q", type: "quote", props: {}, content: [{ type: "text", text: "引用", styles: {} }], children: [] },
        { id: "co", type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "const a = 1;", styles: {} }], children: [] },
        {
          id: "s",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "太字", styles: { bold: true } },
            { type: "link", href: "https://tracker.example/link", content: [{ type: "text", text: "リンク", styles: {} }] },
          ],
          children: [],
        },
        {
          id: "t",
          type: "table",
          props: {},
          content: {
            type: "tableContent",
            rows: [
              { cells: [[{ type: "text", text: "a", styles: {} }], [{ type: "text", text: "b", styles: {} }]] },
              { cells: [[{ type: "text", text: "c", styles: {} }], [{ type: "text", text: "d", styles: {} }]] },
            ],
          },
          children: [],
        },
      ],
    ],
  ];

  it.each(structural)("%s", async (_label, blocks) => {
    await expectSameAsReference(blocks);
  });
});
