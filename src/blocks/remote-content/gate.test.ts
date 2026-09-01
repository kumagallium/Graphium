// @vitest-environment jsdom
// ノート本文の外部メディアゲートの回帰ガード
//
// 守りたい不変条件は 3 つ:
//  1. 同意の無い外部 URL に対して、取得元になる要素（img / video / audio）を
//     **作りもしない**。CSS で隠す・後から src を消す、では取得はもう済んでいる。
//     そのため「DOM に無いこと」ではなく「createElement されていないこと」を見る。
//  2. ローカル参照は従来どおり標準の描画に素通しする（自分で貼った画像が
//     プレースホルダになると、機能として使い物にならない）。
//  3. 保存されるスキーマが標準と同一。ここが変わると、このビルドで書いたノートが
//     古いビルドで開けなくなる（またはその逆）。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import {
  gatedImageBlock,
  gatedVideoBlock,
  gatedAudioBlock,
  gatedMediaBlockEntries,
} from "./gated-media-spec";
import {
  allowRemoteContentFor,
  isRemoteContentAllowed,
  resetRemoteContentGate,
  blockedRemoteCount,
  setEditorRemoteScope,
  REMOTE_CONTENT_CHANGED_EVENT,
} from "./store";

const REMOTE_URL = "https://tracker.example/pixel/abc123.png";
const SETTINGS_KEY = "graphium-settings";

/** 標準 render が触る最小限のエディタ。scope を刻んで渡す。 */
function makeEditor(scope: string) {
  const editor = {
    isEditable: true,
    domElement: document.createElement("div"),
    updateBlock: vi.fn(),
    onUploadStart: () => () => {},
    resolveFileUrl: async (url: string) => url,
    dictionary: {
      file_blocks: {
        add_button_text: { file: "Add file", image: "Add image", video: "Add video", audio: "Add audio" },
      },
    },
  };
  setEditorRemoteScope(editor, scope);
  return editor;
}

function makeBlock(type: string, url: string) {
  return {
    id: `block-${type}`,
    type,
    props: { url, name: "", caption: "", showPreview: true, backgroundColor: "default" },
  };
}

/**
 * render を走らせ、その間に生成されたタグ名を記録する。
 *
 * `document.createElement` を丸ごと監視するので、「作ったが append しなかった」
 * `<img>`（detached でも src 代入で取得は走る）も捕まえられる。
 *
 * renderType は既定で "nodeView"（画面に出るブロック）。BlockNote は書き出し用の
 * 呼び出しに "dom" を渡すので、ゲート側もそれで挙動を分ける。
 */
function renderRecording(spec: any, block: any, editor: any, renderType = "nodeView") {
  const created: string[] = [];
  const original = document.createElement.bind(document);
  const spy = vi
    .spyOn(document, "createElement")
    .mockImplementation((tag: any, ...rest: any[]) => {
      created.push(String(tag).toLowerCase());
      return original(tag, ...rest);
    });
  try {
    const result = spec.implementation.render.call(
      { blockContentDOMAttributes: {}, renderType, props: undefined },
      block,
      editor,
    );
    return { result, created };
  } finally {
    spy.mockRestore();
  }
}

/** DOM のどこかに remote URL が「取得先」として載っていないか */
function fetchableSources(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("*"))
    .flatMap((el) => [el.getAttribute("src"), el.getAttribute("href"), el.getAttribute("data")])
    .filter((v): v is string => Boolean(v));
}

beforeEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
});

afterEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
});

describe("保存されるスキーマが標準と同一", () => {
  const pairs: [string, any, any][] = [
    ["image", gatedImageBlock, defaultBlockSpecs.image],
    ["video", gatedVideoBlock, defaultBlockSpecs.video],
    ["audio", gatedAudioBlock, defaultBlockSpecs.audio],
  ];

  it.each(pairs)("%s: config を参照ごと引き継いでいる", (_name, gated, base) => {
    // 同一オブジェクトであること。deep equal では「同じ形の別物」を作った変更を
    // 通してしまうが、ここで守りたいのは「触っていない」こと。
    expect(gated.spec.config).toBe(base.config);
    expect(gated.spec.config.type).toBe(base.config.type);
    expect(Object.keys(gated.spec.config.propSchema)).toEqual(
      Object.keys(base.config.propSchema),
    );
  });

  it.each(pairs)("%s: parse / meta / runsBefore を素通しする", (_n, gated, base) => {
    expect(gated.spec.implementation.parse).toBe(base.implementation.parse);
    expect(gated.spec.implementation.meta).toBe(base.implementation.meta);
    expect(gated.spec.implementation.runsBefore).toEqual(base.implementation.runsBefore);
    expect(gated.spec.extensions).toBe(base.extensions);
  });

  it.each(pairs)("%s: 差し替わっているのは描画まわりだけ", (_n, gated, base) => {
    expect(gated.spec.implementation.render).not.toBe(base.implementation.render);
    expect(gated.spec.implementation.toExternalHTML).not.toBe(base.implementation.toExternalHTML);
  });
});

describe("書き出し・クリップボード用 HTML も取得先を作らない", () => {
  const exportHtml = (spec: any, block: any, editor: any) => {
    const created: string[] = [];
    const original = document.createElement.bind(document);
    const spy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: any, ...rest: any[]) => {
        created.push(String(tag).toLowerCase());
        return original(tag, ...rest);
      });
    try {
      const res = spec.implementation.toExternalHTML.call(
        { blockContentDOMAttributes: {} },
        block,
        editor,
        { nestingLevel: 0 },
      );
      return { html: (res?.dom as HTMLElement)?.outerHTML ?? "", created };
    } finally {
      spy.mockRestore();
    }
  };

  it("ブロック中は img を作らず、URL はリンクとして残る", () => {
    const editor = makeEditor("note-1");
    const { html, created } = exportHtml(
      gatedImageBlock.spec,
      makeBlock("image", REMOTE_URL),
      editor,
    );
    expect(created).not.toContain("img");
    // 書き出しから URL ごと消してしまうと、ユーザーが求めた書き出しの中身が欠ける
    expect(html).toContain(REMOTE_URL);
    expect(html).toContain("<a ");
  });

  it("読み込み済みなら従来どおり img で書き出す", () => {
    allowRemoteContentFor("note-1");
    const editor = makeEditor("note-1");
    const { created } = exportHtml(
      gatedImageBlock.spec,
      makeBlock("image", REMOTE_URL),
      editor,
    );
    expect(created).toContain("img");
  });

  it("ローカル参照は素通しする", () => {
    const editor = makeEditor("note-1");
    const { created } = exportHtml(
      gatedImageBlock.spec,
      makeBlock("image", "local-media://abcd"),
      editor,
    );
    expect(created).toContain("img");
  });
});

describe("外部 URL は同意まで取得先を作らない", () => {
  const cases: [string, any][] = [
    ["image", gatedImageBlock],
    ["video", gatedVideoBlock],
    ["audio", gatedAudioBlock],
  ];

  it.each(cases)("%s: img / video / audio 要素そのものが作られない", (type, gated) => {
    const editor = makeEditor("note-1");
    const { result, created } = renderRecording(gated.spec, makeBlock(type, REMOTE_URL), editor);

    expect(created).not.toContain("img");
    expect(created).not.toContain("video");
    expect(created).not.toContain("audio");
    // 念のため出来上がった DOM 側も見る（取得先になる属性が 1 つも無い）
    expect(fetchableSources(result.dom as HTMLElement)).toEqual([]);
    result.destroy?.();
  });

  it.each(cases)("%s: remote URL が DOM のテキストに出ない（パスは計測トークン）", (type, gated) => {
    const editor = makeEditor("note-1");
    const { result } = renderRecording(gated.spec, makeBlock(type, REMOTE_URL), editor);
    const dom = result.dom as HTMLElement;
    expect(dom.textContent).not.toContain("abc123");
    // 「どこから読むのか」はホスト名だけ出す
    expect(dom.textContent).toContain("tracker.example");
    result.destroy?.();
  });

  it("ブロックした分がノート単位の件数に乗る", () => {
    const editor = makeEditor("note-1");
    const a = renderRecording(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), editor);
    const b = renderRecording(
      gatedVideoBlock.spec,
      { ...makeBlock("video", REMOTE_URL), id: "block-video-2" },
      editor,
    );
    expect(blockedRemoteCount("note-1")).toBe(2);
    a.result.destroy?.();
    b.result.destroy?.();
    expect(blockedRemoteCount("note-1")).toBe(0);
  });

  it("scope の無いエディタ（stories 等）でもブロック側に倒れる", () => {
    const editor = makeEditor("");
    const { created } = renderRecording(
      gatedImageBlock.spec,
      makeBlock("image", REMOTE_URL),
      editor,
    );
    expect(created).not.toContain("img");
  });
});

describe("ローカル参照は素通しする", () => {
  const localRefs = [
    "local-media://abcd",
    "file-media://abcd",
    "media-server://abcd",
    "blob:http://localhost/abcd",
    "data:image/png;base64,iVBORw0KGgo=",
  ];

  it.each(localRefs)("%s は標準の描画に渡る", (url) => {
    const editor = makeEditor("note-1");
    const { created } = renderRecording(gatedImageBlock.spec, makeBlock("image", url), editor);
    // 標準の image render は必ず <img> を作る。作られている＝素通ししている証拠。
    expect(created).toContain("img");
  });

  it("URL 未設定のブロックも標準の描画に渡る（件数にも乗らない）", () => {
    const editor = makeEditor("note-1");
    const { result } = renderRecording(gatedImageBlock.spec, makeBlock("image", ""), editor);
    expect(blockedRemoteCount("note-1")).toBe(0);
    result.destroy?.();
  });
});

/** 状態変更の通知はマイクロタスクで 1 回にまとめて飛ぶので、そこまで待つ */
const flushGate = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

describe("ノート単位の「読み込む」", () => {
  it("押すと標準の描画へ差し替わり、件数が 0 になる", async () => {
    const editor = makeEditor("note-1");
    const { result } = renderRecording(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), editor);
    const dom = result.dom as HTMLElement;
    expect(dom.querySelector("img")).toBeNull();
    expect(blockedRemoteCount("note-1")).toBe(1);

    allowRemoteContentFor("note-1");
    await flushGate();

    expect(dom.querySelector("img")).not.toBeNull();
    expect(dom.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(blockedRemoteCount("note-1")).toBe(0);
    result.destroy?.();
  });

  it("同意は押したノートにだけ効く", () => {
    allowRemoteContentFor("note-1");
    expect(isRemoteContentAllowed("note-1")).toBe(true);
    expect(isRemoteContentAllowed("note-2")).toBe(false);
  });

  it("プレースホルダ自体を押しても読み込みになる", async () => {
    const editor = makeEditor("note-1");
    const { result } = renderRecording(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), editor);
    const dom = result.dom as HTMLElement;
    const placeholder = dom.querySelector("[data-remote-content-blocked]") as HTMLElement;
    expect(placeholder).not.toBeNull();
    placeholder.click();
    expect(isRemoteContentAllowed("note-1")).toBe(true);
    await flushGate();
    expect(dom.querySelector("img")).not.toBeNull();
    result.destroy?.();
  });
});

describe("設定（allowRemoteContent）", () => {
  it("ON なら押さなくても標準の描画になる", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ allowRemoteContent: true }));
    const editor = makeEditor("note-1");
    const { created } = renderRecording(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), editor);
    expect(created).toContain("img");
    expect(blockedRemoteCount("note-1")).toBe(0);
  });

  it("既定（未保存）は OFF＝ブロック", () => {
    expect(isRemoteContentAllowed("note-1")).toBe(false);
    const editor = makeEditor("note-1");
    const { created } = renderRecording(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), editor);
    expect(created).not.toContain("img");
  });

  it("壊れた設定値でも ON にはならない", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ allowRemoteContent: "yes" }));
    expect(isRemoteContentAllowed("note-1")).toBe(false);
  });
});

describe("ブロック中も BlockNote のブロック構造を保つ", () => {
  // ブロックした側の外側は block-structure.ts が自前で組み立てている（標準 render を
  // 呼ばないため）。BlockNote 側の組み立てが変わったらここが落ちる。
  it("読み込み済みブロックと同じ class・属性になる", () => {
    const block = makeBlock("image", REMOTE_URL);
    const blockedEditor = makeEditor("note-blocked");
    const blocked = renderRecording(gatedImageBlock.spec, block, blockedEditor).result;

    allowRemoteContentFor("note-allowed");
    const allowedEditor = makeEditor("note-allowed");
    const allowed = renderRecording(gatedImageBlock.spec, block, allowedEditor).result;

    const blockedDom = blocked.dom as HTMLElement;
    const allowedDom = allowed.dom as HTMLElement;
    expect(blockedDom.tagName).toBe(allowedDom.tagName);
    expect(blockedDom.className).toBe(allowedDom.className);
    const attrs = (el: HTMLElement) => el.getAttributeNames().sort().map((n) => `${n}=${el.getAttribute(n)}`);
    expect(attrs(blockedDom)).toEqual(attrs(allowedDom));

    blocked.destroy?.();
    allowed.destroy?.();
  });
});

describe("実際のエディタをマウントしたときの挙動", () => {
  // ここまでのテストは spec の render を直接呼んでいる。実際にゲートが効くかは
  // 「BlockNoteSchema.create で標準 spec を上書きできているか」にも依るので、
  // 本物の BlockNoteEditor を組み立てて nodeView 経路ごと確かめる。
  function mountWithBlocks(scope: string, blocks: any[]) {
    const customSpecs = Object.fromEntries(gatedMediaBlockEntries.map((b) => [b.type, b.spec]));
    const schema = BlockNoteSchema.create({
      blockSpecs: { ...defaultBlockSpecs, ...customSpecs } as any,
      styleSpecs: { ...defaultStyleSpecs } as any,
    });
    const editor = BlockNoteEditor.create({ schema: schema as any, initialContent: blocks });
    setEditorRemoteScope(editor, scope);
    const host = document.createElement("div");
    document.body.appendChild(host);

    const created: string[] = [];
    const original = document.createElement.bind(document);
    const spy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: any, ...rest: any[]) => {
        created.push(String(tag).toLowerCase());
        return original(tag, ...rest);
      });
    try {
      (editor as any).mount(host);
    } finally {
      spy.mockRestore();
    }
    return { editor, host, created };
  }

  it("外部 URL の画像を含むノートを開いても img が 1 つも作られない", () => {
    const { host, created } = mountWithBlocks("note-mounted", [
      { type: "paragraph", content: "hello" },
      { type: "image", props: { url: REMOTE_URL } },
    ] as any);
    expect(created).not.toContain("img");
    expect(host.querySelectorAll("img").length).toBe(0);
    // プレースホルダは出ている（＝ブロックが消えたのではない）
    expect(host.querySelector("[data-remote-content-blocked]")).not.toBeNull();
  });

  it("ローカル参照の画像なら img が作られる（検査が空振りしていない証拠）", () => {
    const { host } = mountWithBlocks("note-mounted-local", [
      { type: "image", props: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ] as any);
    expect(host.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("読み込みを許可すると img が現れる", async () => {
    const { host } = mountWithBlocks("note-mounted-allow", [
      { type: "image", props: { url: REMOTE_URL } },
    ] as any);
    expect(host.querySelectorAll("img").length).toBe(0);
    allowRemoteContentFor("note-mounted-allow");
    await flushGate();
    expect(host.querySelectorAll("img").length).toBeGreaterThan(0);
  });
});

describe("貼り付け・コピーの HTML 化（renderType: \"dom\"）", () => {
  // BlockNote の貼り付けは「外部 HTML → ブロック → 内部 HTML → 貼り付け」と往復する
  // （ExportManager.pasteHTML）。その内部 HTML 化はブロックの render を renderType:
  // "dom" で呼ぶので、ゲートが無ければ**ブロックが本文に入る前に**取得が走る。
  // 画面にも出ていないので、ゲートの件数に足してはいけない（destroy が来ない）。

  it("外部 URL の画像を HTML 化しても img を作らない", () => {
    const editor = makeEditor("note-paste");
    const { created } = renderRecording(
      gatedImageBlock.spec,
      makeBlock("image", REMOTE_URL),
      editor,
      "dom",
    );
    expect(created).not.toContain("img");
  });

  it("HTML 化はバーの件数にも購読にも残らない", () => {
    const editor = makeEditor("note-paste");
    const added = vi.spyOn(window, "addEventListener");
    renderRecording(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), editor, "dom");
    // 画面に出ないので destroy は呼ばれない。数えると減らす者がいなくなる
    expect(blockedRemoteCount("note-paste")).toBe(0);
    expect(added.mock.calls.map((c) => c[0])).not.toContain(REMOTE_CONTENT_CHANGED_EVENT);
    added.mockRestore();
  });

  it("URL は data-url として残るので、貼り付けの往復で失われない", () => {
    const editor = makeEditor("note-paste");
    const { result } = renderRecording(
      gatedImageBlock.spec,
      makeBlock("image", REMOTE_URL),
      editor,
      "dom",
    );
    expect((result.dom as HTMLElement).getAttribute("data-url")).toBe(REMOTE_URL);
  });

  it("実物のエディタで貼り付けの HTML 往復を通しても img が作られない", () => {
    // ExportManager.pasteHTML の中身のうち、要素を作る 2 段
    // （tryParseHTMLToBlocks → blocksToFullHTML）をそのまま走らせる。
    // 最後の prosemirrorView.pasteHTML は jsdom に ClipboardEvent が無くて呼べないが、
    // そこは detached document でのパースなので取得は起きない。
    const customSpecs = Object.fromEntries(gatedMediaBlockEntries.map((b) => [b.type, b.spec]));
    const schema = BlockNoteSchema.create({
      blockSpecs: { ...defaultBlockSpecs, ...customSpecs } as any,
      styleSpecs: { ...defaultStyleSpecs } as any,
    });
    const editor = BlockNoteEditor.create({ schema: schema as any });
    setEditorRemoteScope(editor, "note-paste-live");

    const created: string[] = [];
    const original = document.createElement.bind(document);
    const spy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: any, ...rest: any[]) => {
        created.push(String(tag).toLowerCase());
        return original(tag, ...rest);
      });
    let html = "";
    let blocks: any[] = [];
    try {
      blocks = (editor as any).tryParseHTMLToBlocks(`<p>hi</p><img src="${REMOTE_URL}">`);
      html = (editor as any).blocksToFullHTML(blocks);
    } finally {
      spy.mockRestore();
    }

    expect(created).not.toContain("img");
    expect(html).not.toContain("<img");
    // ブロックは失われない（貼り付けが壊れていない）。取り込み側がこの URL を差し替える
    expect(blocks.find((b) => b.type === "image")?.props?.url).toBe(REMOTE_URL);
    // 往復後の HTML にも URL は残るので、貼り付け結果のブロックが URL を失わない
    expect(html).toContain(REMOTE_URL);
  });
});

describe("登録（base/editor.tsx の schema に注ぐ）", () => {
  // 差し替えを注いでいるのは base/editor.tsx が schema を組む所。registry.ts の
  // customBlockEntries には載せられない —— あちらは「BlockNote が知らないブロック型」の
  // 一覧で、registry.test.ts が全エントリに Markdown 変換器を要求する。image /
  // video / audio は標準型で変換器を持たないため、混ぜるとその不変条件が壊れる。
  //
  // したがってここは「配列に入っているか」ではなく、本文を描画する唯一の入口
  // （SandboxEditor）を実際にマウントして、渡していないのにゲートが効いていることを見る。
  // editor.tsx から `...gatedMediaSpecs` を外すと、標準の image spec が描画に戻って
  // 1 つ目が赤くなる。

  // この describe だけ実物のエディタを React ごとマウントするので、その後片付け。
  // 言語も戻す（モジュールスコープの値なのでファイル内の他のテストに残る）。
  afterEach(async () => {
    (await import("@testing-library/react")).cleanup();
    (await import("../../i18n")).syncLocale("en");
  });

  /** SandboxEditor が中で読む Context 一式でくるんでマウントする */
  async function mountSandbox(scope: string, initialContent: any[]) {
    const { render } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { LocaleProvider } = await import("../../i18n");
    const { SandboxEditor } = await import("../../base/editor");
    const { AiAssistantProvider } = await import("../../features/ai-assistant/store");
    const { LabelStoreProvider } = await import("../../features/context-label/store");
    const { LinkStoreProvider } = await import("../../features/block-link/store");
    return render(
      createElement(
        LocaleProvider,
        null,
        createElement(
          AiAssistantProvider,
          null,
          createElement(
            LabelStoreProvider,
            null,
            createElement(
              LinkStoreProvider,
              null,
              // blocks は渡さない。呼び出し側が何も渡さなくても差し替わることが要点
              createElement(SandboxEditor, { remoteContentScope: scope, initialContent }),
            ),
          ),
        ),
      ),
    );
  }

  it("SandboxEditor は blocks を渡されなくても外部 URL の画像を描画しない", async () => {
    const { container } = await mountSandbox("note-sandbox", [
      { type: "paragraph", content: "hello" },
      { type: "image", props: { url: REMOTE_URL } },
    ]);
    expect(container.querySelectorAll("img").length).toBe(0);
    // ブロックが消えたのではなく、枠に差し替わっている
    expect(container.querySelector("[data-remote-content-blocked]")).not.toBeNull();
  });

  it("ローカル参照の画像は描画される（上の検査が空振りしていない証拠）", async () => {
    const { container } = await mountSandbox("note-sandbox-local", [
      { type: "image", props: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ]);
    expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("言語を切り替えるとプレースホルダの文言も入れ替わる", async () => {
    // 枠の文言は Context 非依存の t() で組んでいる（BlockNote へ DOM をそのまま返す
    // 描画なので、useLocaleSubscription() を置ける React コンポーネントが無い）。
    // それでも言語切替に追従する根拠は base/editor.tsx にあり、useCreateBlockNote の
    // deps に locale が入っている ＝ 切り替えるとエディタごと作り直され、nodeView も
    // 枠も新しい辞書で組み直される。その deps から locale が外れるとここが赤くなる。
    // 実物をマウントしないと確かめられないので、この describe に置いている。
    const { act } = await import("@testing-library/react");
    const { syncLocale } = await import("../../i18n");
    syncLocale("en");
    const { container } = await mountSandbox("note-sandbox-locale", [
      { type: "image", props: { url: REMOTE_URL } },
    ]);
    const text = () =>
      container.querySelector("[data-remote-content-blocked]")?.textContent ?? "";
    expect(text()).toContain("Image from another site");
    await act(async () => {
      syncLocale("ja");
    });
    expect(text()).toContain("外部サイトの画像");
  });

  it("registry の customBlockEntries には載せない（標準型を混ぜない）", async () => {
    // registry は pdf-viewer 経由で react-pdf を読むため、描画まわりだけモックする
    vi.doMock("react-pdf", () => ({
      Document: () => null,
      Page: () => null,
      pdfjs: { GlobalWorkerOptions: {} },
    }));
    vi.doMock("../../lib/pdfjs-config", () => ({}));
    const { customBlockEntries } = await import("../registry");
    for (const type of ["image", "video", "audio"]) {
      expect(customBlockEntries.some((b) => b.type === type)).toBe(false);
    }
    expect(gatedMediaBlockEntries.map((b) => b.type)).toEqual(["image", "video", "audio"]);
  });
});
