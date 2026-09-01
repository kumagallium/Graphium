// @vitest-environment jsdom
// ゲート中のノートを書き出したときの回帰ガード
//
// 外部メディアのゲートが変えてよいのは「何を取りに行くか」だけで、「何が書き出されるか」
// ではない。ここが混ざると、既定でブロックしている以上、ふつうに書き出した Markdown から
// URL が黙って消える —— 漏れよりたちが悪い（画面には何も出ない）。
//
// 実際に起きていたのは bookmark ブロックで、createReactBlockSpec は
// toExternalHTML を渡さないと render に落ちる（ReactBlockSpec.tsx の
// `blockImplementation.toExternalHTML || blockImplementation.render`）。ブロック中の
// カードはプレースホルダを返すので、書き出しとクリップボードにその枠の文言が入り、
// URL は 1 文字も残らなかった。
//
// そのため確かめるのは 2 点セットで、片方だけでは意味が無い:
//   1. ブロック中でも書き出しに URL が残る（＝データが落ちない）
//   2. その書き出しから外向きの要求が 1 つも出ない（＝ゲートは効いたまま）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import { BookmarkBlock } from "./view";
import { gatedMediaBlockEntries } from "../remote-content/gated-media-spec";
import {
  allowRemoteContentFor,
  resetRemoteContentGate,
  setEditorRemoteScope,
} from "../remote-content/store";
import { t } from "../../i18n";

// hero（ローカルキャッシュの data URL）は素材インデックスを読むので、書き出しの
// 観測に無関係な非同期処理を持ち込まないようフックごと差し替える。
vi.mock("../../features/asset-browser/preview-image", () => ({
  useBookmarkPreviewImage: () => null,
  ensureCachedPreviewImage: vi.fn(async () => "skipped"),
}));

const BOOKMARK_URL = "https://recipient-7f3a.tracker.example/read/abc123?u=me";
const IMAGE_URL = "https://recipient-7f3a.tracker.example/pixel/def456.png";

// ── 外向きの要求のセンサー ──
//
// 「DOM に載っていないこと」では足りない。`document.createElement("img")` した要素は
// どこにも挿さっていなくても src を代入した時点で取りに行く（`new Image().src = url`）。
// そこで要素の在処ではなく、取得を始める代入そのものを見る。代入の入口は 2 つあり、
// 片方だけでは素通りする:
//   - IDL プロパティ（`img.src = url`）… BlockNote 標準の image / video / audio
//   - setAttribute（`img.setAttribute("src", url)`）… React はこちらで属性を書く
// fetch も同じ配列に入れて、経路を問わず 0 件であることだけを見る。
//
// ownerDocument が画面の document のときだけ数える。DOMParser や
// createHTMLDocument で作った別 document の要素は取得アルゴリズムを持たない
// （BlockNote の HTML パースがそこを通る）ので、数えると空振りの失敗になる。

/** 代入された時点で取得が始まる IDL プロパティ（要素コンストラクタ名 → プロパティ名） */
const FETCHING_IDL_PROPERTIES: [string, string][] = [
  ["HTMLImageElement", "src"],
  ["HTMLImageElement", "srcset"],
  // video / audio は HTMLMediaElement.prototype.src を共有する
  ["HTMLMediaElement", "src"],
  ["HTMLSourceElement", "src"],
  ["HTMLSourceElement", "srcset"],
  ["HTMLTrackElement", "src"],
  ["HTMLIFrameElement", "src"],
  ["HTMLEmbedElement", "src"],
  ["HTMLScriptElement", "src"],
  ["HTMLObjectElement", "data"],
  // <a href> は取りに行かない。取りに行くのは <link href>（stylesheet / preload 等）
  ["HTMLLinkElement", "href"],
];

/** 同じことを属性名で（setAttribute 経由の代入用）。タグ名 → 取得を始める属性 */
const FETCHING_ATTRIBUTES: Record<string, string[]> = {
  img: ["src", "srcset"],
  video: ["src", "poster"],
  audio: ["src"],
  source: ["src", "srcset"],
  track: ["src"],
  iframe: ["src"],
  embed: ["src"],
  object: ["data"],
  script: ["src"],
  link: ["href"],
};

type Egress = { via: string; value: string };

function installEgressSensor(): { calls: Egress[]; restore: () => void } {
  const calls: Egress[] = [];
  const restores: (() => void)[] = [];
  // detached でも document 由来の要素は取りに行く。別 document のものは行かない
  const fromLiveDocument = (el: Element) => el.ownerDocument === document;

  for (const [ctorName, prop] of FETCHING_IDL_PROPERTIES) {
    const ctor = (globalThis as Record<string, unknown>)[ctorName] as
      | { prototype: object }
      | undefined;
    if (!ctor) continue;
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (!descriptor?.set) continue;
    const originalSet = descriptor.set;
    Object.defineProperty(ctor.prototype, prop, {
      ...descriptor,
      set(this: Element, value: unknown) {
        if (fromLiveDocument(this)) {
          calls.push({ via: `${ctorName}.${prop}`, value: String(value) });
        }
        originalSet.call(this, value);
      },
    });
    restores.push(() => Object.defineProperty(ctor.prototype, prop, descriptor));
  }

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    const attrs = FETCHING_ATTRIBUTES[this.tagName?.toLowerCase() ?? ""];
    if (attrs?.includes(name.toLowerCase()) && fromLiveDocument(this)) {
      calls.push({ via: `<${this.tagName.toLowerCase()} ${name}>`, value: String(value) });
    }
    return originalSetAttribute.call(this, name, value);
  };
  restores.push(() => {
    Element.prototype.setAttribute = originalSetAttribute;
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    calls.push({ via: "fetch", value: String((input as { url?: string })?.url ?? input) });
    return originalFetch?.(input as RequestInfo, init as RequestInit);
  }) as typeof fetch;
  restores.push(() => {
    globalThis.fetch = originalFetch;
  });

  return { calls, restore: () => restores.forEach((r) => r()) };
}

// ── 書き出し用のエディタ ──

/** 本番と同じ差し替え一式（bookmark + image / video / audio のゲート） */
function gatedSchema() {
  const gated = Object.fromEntries(gatedMediaBlockEntries.map((b) => [b.type, b.spec]));
  return BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, ...gated, bookmark: BookmarkBlock() } as any,
    styleSpecs: { ...defaultStyleSpecs } as any,
  });
}

/** 受け取ったノート（メタデータ未取得のブックマーク＝D1 の再現条件） */
const NOTE = [
  { type: "paragraph", content: "本文" },
  { type: "bookmark", props: { url: BOOKMARK_URL } },
  { type: "image", props: { url: IMAGE_URL } },
];

// 一度メタデータを取り終えたブックマーク。同意すると未取得のカードは取得して
// title を書き戻す＝props が変わるので、「同意で書き出しが変わらない」を見るには
// 両側で props が同じこちらを使う。
const RESOLVED_NOTE = [
  { type: "paragraph", content: "本文" },
  { type: "bookmark", props: { url: BOOKMARK_URL, title: "記事タイトル", domain: "tracker.example" } },
  { type: "image", props: { url: IMAGE_URL } },
];

/**
 * 本物の BlockNoteView をマウントして editor を取り出す。
 * React 版の spec は書き出しのとき editor.elementRenderer で React ツリーに描くので、
 * マウントしていないエディタでは toExternalHTML がそもそも動かない。
 */
async function mountEditor(scope: string, note: any[] = NOTE) {
  let editor: any;
  function Harness() {
    const created = useCreateBlockNote({ schema: gatedSchema() as any, initialContent: note as any });
    setEditorRemoteScope(created, scope);
    editor = created;
    return (
      <BlockNoteViewRaw
        editor={created as any}
        theme="light"
        sideMenu={false}
        formattingToolbar={false}
        slashMenu={false}
        linkToolbar={false}
        emojiPicker={false}
        filePanel={false}
        tableHandles={false}
      />
    );
  }
  const rendered = render(<Harness />);
  // React で書かれたブロック（bookmark）の nodeView は ProseMirror の描画より
  // 1 ティック遅れて出るので、画面が揃うまで進める
  await act(async () => {});
  return { editor: editor!, container: rendered.container };
}

/** 「Markdown で書き出す」（export-markdown.ts）と同じ呼び出し */
async function exportMarkdown(editor: any): Promise<string> {
  let markdown = "";
  await act(async () => {
    markdown = await editor.blocksToMarkdownLossy(editor.document);
  });
  return markdown;
}

// センサーが「出た」と記録した先で本当に外へ出てしまわないよう、fetch は最初から
// 潰しておく（センサーはこのモックを包む）。実運用でも大半の配信元は CORS で弾く。
const fetchMock = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));

beforeEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRemoteContentGate();
  localStorage.clear();
});

describe("ブロック中のノートを Markdown に書き出す", () => {
  it("ブックマークと画像の URL が残り、外向きの要求は 1 つも出ない", async () => {
    const sensor = installEgressSensor();
    let markdown = "";
    try {
      const { editor, container } = await mountEditor("note-export");
      // 前提: 画面はブロック中（＝ゲートが効いている状態で書き出している）
      expect(container.querySelectorAll("[data-remote-content-blocked]").length).toBe(2);
      markdown = await exportMarkdown(editor);
    } finally {
      sensor.restore();
    }

    // 1. ユーザーが求めた書き出しの中身が落ちていない
    expect(markdown).toContain(BOOKMARK_URL);
    expect(markdown).toContain(IMAGE_URL);
    expect(markdown).toContain("本文");
    // プレースホルダの UI 文言が書き出しに混ざらない
    expect(markdown).not.toContain(t("block.remoteContent.why"));
    expect(markdown).not.toContain(t("block.remoteContent.action"));

    // 2. ゲートは効いたまま（書き出しから 1 件も外へ出ない）
    expect(sensor.calls).toEqual([]);
  });

  it("ブックマークの行は同意済みのノートと 1 文字も変わらない", async () => {
    const blocked = await exportMarkdown((await mountEditor("note-blocked", RESOLVED_NOTE)).editor);
    cleanup();

    allowRemoteContentFor("note-allowed");
    const allowed = await exportMarkdown((await mountEditor("note-allowed", RESOLVED_NOTE)).editor);

    const bookmarkLine = (md: string) =>
      md.split("\n").filter((line) => line.includes(BOOKMARK_URL)).join("\n");
    expect(bookmarkLine(blocked)).toBe(`[記事タイトル](${BOOKMARK_URL})`);
    expect(bookmarkLine(blocked)).toBe(bookmarkLine(allowed));

    // 画像はここまで揃わない。ブロック中は BlockNote 自身の showPreview: false の
    // 出力（リンク）に倒しているので `![...]` ではなくリンクになる
    // （gated-media-spec.ts の gateToExternalHTML）。URL は両方に残る＝欠落は無い。
    expect(blocked).toContain(IMAGE_URL);
    expect(allowed).toContain(IMAGE_URL);
    expect(allowed).toContain(`![BlockNote image](${IMAGE_URL})`);
  });

  it("センサーは空振りしていない（同意済みのノートを開けば記録される）", async () => {
    // 上の 0 件が「センサーが何も見ていない」ことの言い換えになっていないかの確認。
    // 同意済みのノートを**開く**と、カードのメタデータ取得と favicon、画像ブロックの
    // <img> が出るので、同じセンサーがそれを捕まえられる必要がある。
    allowRemoteContentFor("note-sensor");
    const sensor = installEgressSensor();
    try {
      await mountEditor("note-sensor");
    } finally {
      sensor.restore();
    }
    expect(sensor.calls.map((c) => c.value)).toContain(IMAGE_URL);
    expect(sensor.calls.map((c) => c.value)).toContain(BOOKMARK_URL);
    // 2 つの入口がどちらも実際に発火していること（片方だけの検査になっていない）
    expect(sensor.calls.map((c) => c.via)).toContain("HTMLImageElement.src");
    expect(sensor.calls.map((c) => c.via)).toContain("<img src>");
  });

  it("動画・音声もブロック中の書き出しに URL が残る", async () => {
    // gated-media-spec.ts の toExternalHTML は image だけでなく 3 種を同じ形で
    // 通しているが、URL が残ることを見ていたのは image だけだった（gate.test.ts）
    const VIDEO_URL = "https://recipient-7f3a.tracker.example/clip/ghi789.mp4";
    const AUDIO_URL = "https://recipient-7f3a.tracker.example/tone/jkl012.mp3";
    const sensor = installEgressSensor();
    let markdown = "";
    try {
      const { editor } = await mountEditor("note-av", [
        { type: "video", props: { url: VIDEO_URL } },
        { type: "audio", props: { url: AUDIO_URL } },
      ]);
      markdown = await exportMarkdown(editor);
    } finally {
      sensor.restore();
    }
    expect(markdown).toContain(VIDEO_URL);
    expect(markdown).toContain(AUDIO_URL);
    expect(markdown).not.toContain(t("block.remoteContent.why"));
    expect(sensor.calls).toEqual([]);
  });
});

describe("ブックマーク 1 個ぶんの書き出し", () => {
  /**
   * ヘッドレスエディタ（マウントしない＝elementRenderer を持たない）で 1 ブロックだけ
   * HTML 化する。React 版の spec はこの場合 createRoot 側の経路で描かれるので、
   * BlockNote 本体の直列化をそのまま通したまま props の組み合わせを並べられる。
   */
  const exportBlockHtml = (props: Record<string, string>) => {
    const editor = BlockNoteEditor.create({ schema: gatedSchema() as any });
    const sensor = installEgressSensor();
    try {
      const html = (editor as any).blocksToHTMLLossy([
        { type: "bookmark", props: { title: "", description: "", ogImage: "", domain: "", ...props } },
      ]);
      return { html: String(html), calls: sensor.calls };
    } finally {
      sensor.restore();
    }
  };

  it("URL をリンクとして出し、要求は出さない", () => {
    const { html, calls } = exportBlockHtml({ url: BOOKMARK_URL });
    expect(html).toContain(`href="${BOOKMARK_URL}"`);
    expect(calls).toEqual([]);
  });

  it("タイトルがあればリンクテキストに使う", () => {
    const { html } = exportBlockHtml({ url: BOOKMARK_URL, title: "記事タイトル" });
    expect(html).toContain("記事タイトル");
    expect(html).toContain(`href="${BOOKMARK_URL}"`);
  });

  it("説明文も落とさない", () => {
    const { html } = exportBlockHtml({ url: BOOKMARK_URL, title: "記事タイトル", description: "説明文" });
    expect(html).toContain("説明文");
  });

  it("同意の有無で出力が変わらない", () => {
    const props = { url: BOOKMARK_URL, title: "記事タイトル", description: "説明文" };
    const blocked = exportBlockHtml(props).html;
    allowRemoteContentFor("note-allowed");
    // 設定 ON（scope を問わず許可）でも同じ
    localStorage.setItem("graphium-settings", JSON.stringify({ allowRemoteContent: true }));
    expect(exportBlockHtml(props).html).toBe(blocked);
  });

  it("URL が空のブックマークは、入力を促す画面の文言を書き出さない", () => {
    const { html, calls } = exportBlockHtml({ url: "" });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain(t("block.bookmark.placeholder"));
    expect(calls).toEqual([]);
  });
});
