// @vitest-environment jsdom
// 挿入直後の外部画像をローカルへ取り込む hook の回帰ガード
//
// この hook が効いていないと、自分で貼った・AI に書かせた画像まで
// 「外部画像を読み込む」を押さないと見えないノートになる。逆に効きすぎて
// 「ノートを開いた時点で既にあった画像」まで取り込みに行くと、まさに止めたい
// 要求（配信元への GET）をこちらから出すことになるので、その両方を見る。
//
// 同じ hook が本文に埋まった data URL も素材へ移す。こちらは要求を出さない＝同意の
// 話ではないので、ゲートにもトーストにも出さないことを別に見る（出すと、自分で
// 貼った画像のせいで「外部画像のまま残しています」が出る）。
//
// 中盤はゲート（gated-media-spec / store）と組み合わせた実物のエディタでの確認。
// 取り込みが済んだ画像はローカル参照なので、バーもプレースホルダも出ないこと。
//
// 最後は SandboxEditor ごと作り直したときの書き戻し先。取り込みの最中に
// 自動保存でノート id が付くとエディタだけが差し替わるので、その隙に解決した
// 取り込みが「捨てられたインスタンス」に吸い込まれないことを見る。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { ReactNode, useLayoutEffect } from "react";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { LocaleProvider } from "../../i18n";
import { SandboxEditor } from "../../base/editor";
import { AiAssistantProvider } from "../../features/ai-assistant/store";
import { LabelStoreProvider } from "../../features/context-label/store";
import { LinkStoreProvider } from "../../features/block-link/store";
import { useRemoteImageImport, type RemoteImportToastState } from "./use-remote-image-import";
import { RemoteContentBar } from "./RemoteContentBar";
import { gatedMediaBlockEntries } from "./gated-media-spec";
import {
  blockedRemoteCount,
  registerBlockedRemoteBlock,
  resetRemoteContentGate,
  setEditorRemoteScope,
  useRemoteContentScope,
} from "./store";

const saveRemoteImageAsMedia = vi.hoisted(() => vi.fn());
const saveDataImageAsMedia = vi.hoisted(() => vi.fn());
vi.mock("../../features/asset-browser/remote-image", () => ({
  saveRemoteImageAsMedia,
  saveDataImageAsMedia,
}));

const REMOTE = "https://tracker.example/pixel/abc123.png";
const OTHER_REMOTE = "https://tracker.example/pixel/zzz999.png";
const LOCAL_PNG = "data:image/png;base64,iVBORw0KGgo=";
/** 本文に直接埋まった画像。要求は出ないが、base64 のままだとノート JSON が膨らむ */
const PASTED_DATA_URL = "data:image/png;base64,UE5H";

/** editor.document を差し替えられる最小のエディタ（children も辿る） */
function makeEditor(blocks: any[]) {
  const find = (list: any[], id: string): any | undefined => {
    for (const b of list) {
      if (b.id === id) return b;
      const hit = b.children?.length ? find(b.children, id) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  const editor = {
    document: blocks,
    getBlock: (id: string) => find(editor.document, id),
    updateBlock: vi.fn((id: string, patch: any) => {
      const b = find(editor.document, id);
      if (b) b.props = { ...b.props, ...patch.props };
    }),
  };
  return editor;
}

const imageBlock = (id: string, url: string) => ({ id, type: "image", props: { url, name: "" } });

/** 取り込みの Promise が解決してブロックへ書き戻されるまで進める */
async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
  saveRemoteImageAsMedia.mockReset();
  saveRemoteImageAsMedia.mockResolvedValue({ url: "local-media://imported", name: "pic.png" });
  saveDataImageAsMedia.mockReset();
  saveDataImageAsMedia.mockResolvedValue({ url: "local-media://from-data", name: "image.png" });
});

afterEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
});

describe("useRemoteImageImport", () => {
  const uploadFile = vi.fn(async () => "local-media://uploaded");

  it("ノートを開いた時点で既にある外部画像には触らない", () => {
    const editor = makeEditor([imageBlock("a", REMOTE)]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());
    expect(saveRemoteImageAsMedia).not.toHaveBeenCalled();
  });

  it("開いた後に入った外部画像を取り込んでローカル URL に差し替える", async () => {
    const editor = makeEditor([imageBlock("a", REMOTE)]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan()); // 開いた時点の記録

    editor.document = [imageBlock("a", REMOTE), imageBlock("b", REMOTE)];
    await act(async () => {
      result.current.scan();
      await settle();
    });

    expect(saveRemoteImageAsMedia).toHaveBeenCalledTimes(1);
    expect(saveRemoteImageAsMedia).toHaveBeenCalledWith(REMOTE, uploadFile);
    expect(editor.updateBlock).toHaveBeenCalledWith("b", {
      props: { url: "local-media://imported", name: "pic.png" },
    });
  });

  it("カラムの中に入った画像も拾う（children を辿る）", async () => {
    // 1 回の貼り付けで、画像がカラムやリストの子として入ることがある。
    // トップレベルだけを見ていると、その画像だけ外部 URL のまま本文に残る。
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [
      { id: "col", type: "columnList", props: {}, children: [imageBlock("nested", REMOTE)] },
    ];
    await act(async () => {
      result.current.scan();
      await settle();
    });
    expect(saveRemoteImageAsMedia).toHaveBeenCalledWith(REMOTE, uploadFile);
    expect(editor.updateBlock).toHaveBeenCalledWith("nested", {
      props: { url: "local-media://imported", name: "pic.png" },
    });
  });

  it("ローカル参照の画像は取り込みに行かない", async () => {
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", "local-media://already")];
    await act(async () => {
      result.current.scan();
      await settle();
    });
    expect(saveRemoteImageAsMedia).not.toHaveBeenCalled();
    expect(saveDataImageAsMedia).not.toHaveBeenCalled();
  });

  it("取り込みに失敗したら URL はそのまま（リモート URL のまま描画に回さない）", async () => {
    saveRemoteImageAsMedia.mockResolvedValue(null);
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    await act(async () => {
      result.current.scan();
      await settle();
    });
    expect(editor.updateBlock).not.toHaveBeenCalled();
    // 失敗を握りつぶさず件数として出す（枠のまま残る理由が画面に出る）
    expect(result.current.toast).toEqual({ running: 0, imported: 0, failed: 1 });
  });

  it("失敗したブロックを打鍵のたびに再試行しない", async () => {
    saveRemoteImageAsMedia.mockResolvedValue(null);
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    await act(async () => {
      result.current.scan();
      await settle();
    });
    await act(async () => {
      result.current.scan();
      result.current.scan();
      await settle();
    });
    expect(saveRemoteImageAsMedia).toHaveBeenCalledTimes(1);
  });

  it("同じ URL の画像が同時に入っても取得は 1 回だけ", async () => {
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    // Markdown に同じ画像が 2 回出てくる形（貼り付け 1 回で 2 ブロック）
    editor.document = [imageBlock("b", REMOTE), imageBlock("c", REMOTE), imageBlock("d", OTHER_REMOTE)];
    await act(async () => {
      result.current.scan();
      await settle();
    });

    const urls = saveRemoteImageAsMedia.mock.calls.map((c: any[]) => c[0]);
    expect(urls.sort()).toEqual([REMOTE, OTHER_REMOTE].sort());
    expect(editor.updateBlock).toHaveBeenCalledTimes(3);
  });

  it("進行と結果をトーストに出す", async () => {
    let resolveImport: (v: unknown) => void = () => {};
    saveRemoteImageAsMedia.mockReturnValue(new Promise((r) => { resolveImport = r; }));
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    await act(async () => {
      result.current.scan();
      await Promise.resolve();
    });
    expect(result.current.toast).toEqual({ running: 1, imported: 0, failed: 0 });

    await act(async () => {
      resolveImport({ url: "local-media://imported", name: "pic.png" });
      await settle();
    });
    expect(result.current.toast).toEqual({ running: 0, imported: 1, failed: 0 });
  });

  it("取り込み中に消されたブロックには書き戻さない", async () => {
    let resolveImport: (v: unknown) => void = () => {};
    saveRemoteImageAsMedia.mockReturnValue(new Promise((r) => { resolveImport = r; }));
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    act(() => result.current.scan());
    editor.document = []; // ユーザーが取り消した

    await act(async () => {
      resolveImport({ url: "local-media://imported", name: "pic.png" });
      await settle();
    });
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });

  it("取り込み中にノートを切り替えたら書き戻さない", async () => {
    let resolveImport: (v: unknown) => void = () => {};
    saveRemoteImageAsMedia.mockReturnValue(new Promise((r) => { resolveImport = r; }));
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    // ノートの切り替えはエディタごと作り直す（note-app.tsx の key={fm.editorKey}・
    // SidePeek の key={noteId}）ので、この hook はアンマウントされる
    const { result, unmount } = renderHook(() =>
      useRemoteImageImport({ editorRef, scope: "n1", uploadFile }),
    );
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    act(() => result.current.scan());
    unmount();

    await act(async () => {
      resolveImport({ url: "local-media://imported", name: "pic.png" });
      await settle();
    });
    expect(editor.updateBlock).not.toHaveBeenCalled();
    // 立て札の後始末は「取り込みの途中でノートを閉じても…」のテストが見る
  });

  it("取り込み中に自動保存でノート id が付いても、ローカル URL に差し替える", async () => {
    // 未採番のノートは自動保存で fileId が付く（use-file-manager の「新規作成」分岐）。
    // scope をノート ID から作っていた頃は、この瞬間に scope が変わって取り込みが
    // 捨てられ、本文には外部 URL が残ったまま保存されていた。
    let resolveImport: (v: unknown) => void = () => {};
    saveRemoteImageAsMedia.mockReturnValue(new Promise((r) => { resolveImport = r; }));
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    // note-app.tsx と同じ配線: fileId は受け取るが、scope はそこから作らない
    const { result, rerender } = renderHook(
      (_props: { fileId: string | null }) => {
        const scope = useRemoteContentScope();
        return { scope, ...useRemoteImageImport({ editorRef, scope, uploadFile }) };
      },
      { initialProps: { fileId: null } as { fileId: string | null } },
    );
    const scope = result.current.scope;
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    act(() => result.current.scan());
    rerender({ fileId: "real-file-id" });

    await act(async () => {
      resolveImport({ url: "local-media://imported", name: "pic.png" });
      await settle();
    });

    // 保存を挟んでも同じ scope のまま＝取り込みの行き先を見失わない
    expect(result.current.scope).toBe(scope);
    expect(editor.updateBlock).toHaveBeenCalledWith("b", {
      props: { url: "local-media://imported", name: "pic.png" },
    });
    expect(editor.document[0].props.url).toBe("local-media://imported");
    expect(result.current.toast).toEqual({ running: 0, imported: 1, failed: 0 });
  });

  it("scope が変わったら既知集合を捨てる（別の本文の既存画像を取り込まない）", async () => {
    const editor = makeEditor([imageBlock("a", REMOTE)]);
    const editorRef = { current: editor } as any;
    const { result, rerender } = renderHook(
      ({ scope }) => useRemoteImageImport({ editorRef, scope, uploadFile }),
      { initialProps: { scope: "n1" } },
    );
    act(() => result.current.scan());

    editor.document = [imageBlock("z", REMOTE)];
    rerender({ scope: "n2" });
    await act(async () => {
      result.current.scan();
      await settle();
    });
    // 切り替え後の 1 回目は「開いた時点の記録」なので取り込まない
    expect(saveRemoteImageAsMedia).not.toHaveBeenCalled();
  });

  it("取り込みの途中でノートを閉じても、バーの件数が減ったままにならない", async () => {
    saveRemoteImageAsMedia.mockReturnValue(new Promise(() => {})); // 解決しない
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result, unmount } = renderHook(() =>
      useRemoteImageImport({ editorRef, scope: "n1", uploadFile }),
    );
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    // 画面側の状態: ゲートがこのブロックを「ブロック中」として登録している
    registerBlockedRemoteBlock("n1", "b");
    act(() => result.current.scan());
    expect(blockedRemoteCount("n1")).toBe(0); // 取り込み中は数えない

    unmount();
    // 立て札が残ると、同じノートを開き直したときこのブロックが数えられない
    expect(blockedRemoteCount("n1")).toBe(1);
  });

  it("書き戻し先が画面から消えていたら、リモート URL のまま失敗として数える", async () => {
    // editorRef が空 = 画面にエディタが無い。ここで前のインスタンスへ書くくらいなら
    // 書かないほうがよい（誰も見ていない本文に書いて取り込みが消える）。
    let resolveImport: (v: unknown) => void = () => {};
    saveRemoteImageAsMedia.mockReturnValue(new Promise((r) => { resolveImport = r; }));
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() =>
      useRemoteImageImport({ editorRef, scope: "n1", uploadFile }),
    );
    act(() => result.current.scan());

    editor.document = [imageBlock("b", REMOTE)];
    act(() => result.current.scan());
    editorRef.current = null;

    await act(async () => {
      resolveImport({ url: "local-media://imported", name: "pic.png" });
      await settle();
    });
    expect(editor.updateBlock).not.toHaveBeenCalled();
    // リモート URL へフォールバックせず、ゲートに止められたまま残す
    expect(editor.document[0].props.url).toBe(REMOTE);
    // 黙って消さず、失敗として画面に出す
    expect(result.current.toast).toEqual({ running: 0, imported: 0, failed: 1 });
  });

  it("uploadFile が無ければ何もしない", () => {
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() =>
      useRemoteImageImport({ editorRef, scope: "n1", uploadFile: undefined }),
    );
    act(() => result.current.scan());
    editor.document = [imageBlock("b", REMOTE)];
    act(() => result.current.scan());
    expect(saveRemoteImageAsMedia).not.toHaveBeenCalled();
  });

  // ── data URL ──
  // 要求は出ないので同意の話ではない。それでも取り込むのは、base64 を本文に置いたまま
  // にするとノート JSON がその画像ぶん膨らみ、開くたび・保存するたびに運ばれるため。

  it("data URL の画像もローカルメディアへ移す（プロキシは通らない）", async () => {
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", PASTED_DATA_URL)];
    await act(async () => {
      result.current.scan();
      await settle();
    });
    expect(saveDataImageAsMedia).toHaveBeenCalledWith(PASTED_DATA_URL, uploadFile);
    expect(saveRemoteImageAsMedia).not.toHaveBeenCalled();
    expect(editor.updateBlock).toHaveBeenCalledWith("b", {
      props: { url: "local-media://from-data", name: "image.png" },
    });
  });

  it("data URL を同意の対象にしない（取り込み中の目印を立てない）", () => {
    saveDataImageAsMedia.mockReturnValue(new Promise(() => {})); // 解決しない
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", PASTED_DATA_URL)];
    act(() => result.current.scan());

    // 目印を立てたかどうかは「ブロック中として数えられている件数」にしか出ないので、
    // ゲート側の登録を手で置いて見る（実際のゲートは data URL を止めないので、
    // この登録はこのテストの中だけの状態）。立てていれば件数はここで 0 に落ちる。
    registerBlockedRemoteBlock("n1", "b");
    expect(blockedRemoteCount("n1")).toBe(1);
    // 進行トーストにも出さない（枠が出ないので、説明することが無い）
    expect(result.current.toast).toEqual({ running: 0, imported: 0, failed: 0 });
  });

  it("data URL の取り込みに失敗しても、本文の data URL はそのまま残す", async () => {
    saveDataImageAsMedia.mockResolvedValue(null);
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", PASTED_DATA_URL)];
    await act(async () => {
      result.current.scan();
      await settle();
    });
    // 実体は手元にあるので、残しておけばそのまま表示できる
    expect(editor.updateBlock).not.toHaveBeenCalled();
    expect(editor.document[0].props.url).toBe(PASTED_DATA_URL);
    // 「外部サイトの画像のまま残しています」は data URL には当てはまらない
    expect(result.current.toast).toEqual({ running: 0, imported: 0, failed: 0 });
  });

  it("画像でない data URL は手元の実体として扱わない", async () => {
    // `data:text/html` は local-media-ref の許可リストに載っていない形。素材にはできず、
    // 外部 URL と同じ扱い（ゲートに止められる側）に倒す。
    const html = "data:text/html;base64,UE5H";
    const editor = makeEditor([]);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() => useRemoteImageImport({ editorRef, scope: "n1", uploadFile }));
    act(() => result.current.scan());

    editor.document = [imageBlock("b", html)];
    await act(async () => {
      result.current.scan();
      await settle();
    });
    expect(saveDataImageAsMedia).not.toHaveBeenCalled();
    expect(saveRemoteImageAsMedia).toHaveBeenCalledWith(html, uploadFile);
  });
});

describe("ゲートとの噛み合わせ（実物のエディタ）", () => {
  const uploadFile = vi.fn(async () => LOCAL_PNG);

  // 取り込み後の URL は実際のプロバイダが返すローカル参照。ここでは data: を使う
  // （ゲートがローカルと見なす形なら何でも同じ経路を通る）
  beforeEach(() => {
    saveRemoteImageAsMedia.mockResolvedValue({ url: LOCAL_PNG, name: "pic.png" });
  });

  /** ゲート付きスキーマで実際のエディタを組み立ててマウントする */
  function mount(scope: string, blocks: any[]) {
    const customSpecs = Object.fromEntries(gatedMediaBlockEntries.map((b) => [b.type, b.spec]));
    const schema = BlockNoteSchema.create({
      blockSpecs: { ...defaultBlockSpecs, ...customSpecs } as any,
      styleSpecs: { ...defaultStyleSpecs } as any,
    });
    const editor = BlockNoteEditor.create({ schema: schema as any, initialContent: blocks });
    setEditorRemoteScope(editor, scope);
    const host = document.createElement("div");
    document.body.appendChild(host);
    (editor as any).mount(host);
    return { editor, host };
  }

  /** そのノートのバーが出ているか（出ていれば文言が入る） */
  function barText(scope: string): string {
    const { container } = render(
      <LocaleProvider>
        <RemoteContentBar scope={scope} />
      </LocaleProvider>,
    );
    return container.textContent ?? "";
  }

  it("貼った画像は取り込まれ、バーもプレースホルダも出ない", async () => {
    const { editor, host } = mount("n-paste", [{ type: "paragraph", content: "hi" }] as any);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() =>
      useRemoteImageImport({ editorRef, scope: "n-paste", uploadFile }),
    );
    act(() => result.current.scan()); // 開いた時点の記録

    // 貼り付け相当: 外部 URL の画像ブロックが本文に入る
    await act(async () => {
      editor.insertBlocks([{ type: "image", props: { url: REMOTE } } as any], editor.document[0], "after");
      result.current.scan();
    });
    // 取り込み中はバーの件数から外れている（自分で貼った画像で点滅させない）
    expect(blockedRemoteCount("n-paste")).toBe(0);
    expect(barText("n-paste")).toBe("");

    await act(async () => {
      await settle();
    });

    // 本文にリモート URL は残らない
    const image = editor.document.find((b: any) => b.type === "image") as any;
    expect(image.props.url).toBe(LOCAL_PNG);
    expect(JSON.stringify(editor.document)).not.toContain("tracker.example");
    // ローカル参照なので標準の描画に戻り、プレースホルダは無い
    expect(host.querySelector("[data-remote-content-blocked]")).toBeNull();
    expect(host.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(blockedRemoteCount("n-paste")).toBe(0);
    expect(barText("n-paste")).toBe("");
  });

  it("取り込めなかった画像はブロックされたまま残り、バーに出る", async () => {
    saveRemoteImageAsMedia.mockResolvedValue(null);
    const { editor, host } = mount("n-fail", [{ type: "paragraph", content: "hi" }] as any);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() =>
      useRemoteImageImport({ editorRef, scope: "n-fail", uploadFile }),
    );
    act(() => result.current.scan());

    await act(async () => {
      editor.insertBlocks([{ type: "image", props: { url: REMOTE } } as any], editor.document[0], "after");
      result.current.scan();
      await settle();
    });

    // URL は消さない（後で取り込み直せる環境で開き直せるように）
    const image = editor.document.find((b: any) => b.type === "image") as any;
    expect(image.props.url).toBe(REMOTE);
    // それでも取りには行っていない
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.querySelector("[data-remote-content-blocked]")).not.toBeNull();
    expect(blockedRemoteCount("n-fail")).toBe(1);
    expect(barText("n-fail")).not.toBe("");
  });

  it("開いた時点からある外部画像は取り込まれず、バーに出る", async () => {
    const { editor } = mount("n-open", [{ type: "image", props: { url: REMOTE } }] as any);
    const editorRef = { current: editor } as any;
    const { result } = renderHook(() =>
      useRemoteImageImport({ editorRef, scope: "n-open", uploadFile }),
    );
    await act(async () => {
      result.current.scan();
      await settle();
    });
    expect(saveRemoteImageAsMedia).not.toHaveBeenCalled();
    expect(blockedRemoteCount("n-open")).toBe(1);
    expect(barText("n-open")).not.toBe("");
  });
});

describe("取り込み中のエディタ作り直し（SandboxEditor 実物）", () => {
  const uploadFile = vi.fn(async () => LOCAL_PNG);
  const SCOPE = "n-remount";

  beforeEach(() => {
    saveRemoteImageAsMedia.mockResolvedValue({ url: LOCAL_PNG, name: "pic.png" });
  });

  /** SandboxEditor が中で読む Context 一式 */
  function Providers({ children }: { children: ReactNode }) {
    return (
      <LocaleProvider>
        <AiAssistantProvider>
          <LabelStoreProvider>
            <LinkStoreProvider>{children}</LinkStoreProvider>
          </LabelStoreProvider>
        </AiAssistantProvider>
      </LocaleProvider>
    );
  }

  type Refs = {
    /** SandboxEditor がコミット中（layout effect）に差し替える ref＝いま画面にあるもの */
    live: { current: any };
    /** onEditorReady で埋まる ref。note-app.tsx の editorRef と同じ遅れ方をする */
    passive: { current: any };
  };
  type Api = { scan: () => void; toast: RemoteImportToastState };

  /**
   * note-app.tsx と同じ配線の最小ハーネス。
   * SandboxEditor の key は fileId（未採番のうちは "new"）で、取り込みの hook は
   * その外側にいる —— つまりエディタだけが作り直され、hook は生き残る。
   *
   * commits には「作り直しのコミットが済んだ直後」の両 ref を控える。親の layout
   * effect は子（SandboxEditor）の layout effect の後・passive effect の前に走るので、
   * ここが実機で取り込みが解決していた隙そのものになる。
   */
  function Harness({
    fileId,
    initial,
    refs,
    api,
    commits,
  }: {
    fileId: string | null;
    initial?: any[];
    refs: Refs;
    api: Api;
    commits: { live: any; passive: any }[];
  }) {
    const imported = useRemoteImageImport({
      editorRef: refs.live as any,
      scope: SCOPE,
      uploadFile,
    });
    // hook の戻り値を test から触るための受け渡し（renderHook が使えないので手で置く）
    api.scan = imported.scan;
    api.toast = imported.toast;
    useLayoutEffect(() => {
      commits.push({ live: refs.live.current, passive: refs.passive.current });
    }, [fileId, refs, commits]);
    return (
      <Providers>
        <SandboxEditor
          key={fileId || "new"}
          blocks={gatedMediaBlockEntries}
          remoteContentScope={SCOPE}
          initialContent={initial}
          liveEditorRef={refs.live as any}
          onEditorReady={(e) => {
            refs.passive.current = e;
          }}
          uploadFile={uploadFile}
        />
      </Providers>
    );
  }

  it("作り直しのコミット直後、書き戻し先は既に新しいインスタンスを指している", async () => {
    // 取り込みが解決し得る隙そのものを見る。onEditorReady（passive effect）だけを
    // 頼りにしていると、このタイミングでは捨てられた前のインスタンスしか手に入らず、
    // そこへ書いた取り込みは誰にも見えないまま消える。
    const refs: Refs = { live: { current: null }, passive: { current: null } };
    const api = {} as Api;
    const commits: { live: any; passive: any }[] = [];
    const { rerender } = render(
      <Harness
        fileId={null}
        initial={[{ type: "paragraph", content: "hi" }]}
        refs={refs}
        api={api}
        commits={commits}
      />,
    );
    const first = refs.live.current;
    expect(first).toBeTruthy();

    await act(async () => {
      rerender(
        <Harness
          fileId="real-file-id"
          initial={[{ type: "paragraph", content: "hi" }]}
          refs={refs}
          api={api}
          commits={commits}
        />,
      );
    });

    const atRemount = commits[commits.length - 1];
    expect(atRemount.live).toBe(refs.live.current); // 画面にある新しいインスタンス
    expect(atRemount.live).not.toBe(first);
    expect(atRemount.passive).toBe(first); // onEditorReady はまだ追いついていない
    // 捨てられた側は、それでも getBlock / updateBlock を受け付ける。だから
    // 「hook がまだ生きているか」だけでは書き戻し先の判定にならない。
    expect(atRemount.passive.getBlock(first.document[0].id)).toBeTruthy();
  });

  it("取り込み中に自動保存でエディタが作り直されても、画面にある本文へ書き戻す", async () => {
    // 貼り付け〜作り直し〜解決までを通しで見る。act は中で起きた更新を最後に
    // まとめて流すので、作り直しと解決は別の act に分ける（passive ref がまだ
    // 古い一瞬そのものは 1 つ上の test が見る）。
    let resolveImport: (v: unknown) => void = () => {};
    saveRemoteImageAsMedia.mockReturnValue(new Promise((r) => { resolveImport = r; }));

    const refs: Refs = { live: { current: null }, passive: { current: null } };
    const api = {} as Api;
    const commits: { live: any; passive: any }[] = [];
    const { rerender } = render(
      <Harness
        fileId={null}
        initial={[{ type: "paragraph", content: "hi" }]}
        refs={refs}
        api={api}
        commits={commits}
      />,
    );
    await act(async () => { await settle(); });

    const first = refs.live.current;
    act(() => api.scan()); // 開いた時点の記録

    // 貼り付け相当。取り込みを始めるが、proxy の応答は保留したままにする
    await act(async () => {
      first.insertBlocks(
        [{ type: "image", props: { url: REMOTE } } as any],
        first.document[0],
        "after",
      );
      api.scan();
    });
    const blockId = first.document.find((b: any) => b.type === "image").id;
    expect(saveRemoteImageAsMedia).toHaveBeenCalledTimes(1);

    // 自動保存でノート id が付く = key が変わって SandboxEditor だけが作り直される。
    // 新しいインスタンスは保存済みの本文から組み直されるので、同じ block id が
    // 同じ外部 URL のまま入っている（＝この取り込みの正しい行き先）。
    const saved = JSON.parse(JSON.stringify(first.document));

    act(() => {
      rerender(
        <Harness
          fileId="real-file-id"
          initial={saved}
          refs={refs}
          api={api}
          commits={commits}
        />,
      );
    });
    // 取り込みは作り直しを挟んで解決する
    await act(async () => {
      resolveImport({ url: LOCAL_PNG, name: "pic.png" });
      await settle();
    });

    const live = refs.live.current;
    expect(live).not.toBe(first);
    // 書き戻しは「画面にある」新しいインスタンスに入る
    expect(live.getBlock(blockId)).toBeTruthy();
    expect(live.getBlock(blockId).props.url).toBe(LOCAL_PNG);
    expect(JSON.stringify(live.document)).not.toContain("tracker.example");
    // 捨てられたインスタンスは触られていない（そちらへ書くと取り込みが消える）
    expect(first.getBlock(blockId).props.url).toBe(REMOTE);
    // 黙って落ちていない
    expect(api.toast).toEqual({ running: 0, imported: 1, failed: 0 });
  });
});
