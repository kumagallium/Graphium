// @vitest-environment jsdom
// サイドピークで編集した直後に、同じノートをメインエディタで開く（StrictMode で描画する。
// main.tsx と同じ）。
//
// 対象の不変条件:
// - 開いているピークは「未保存を今すぐ書き出す」口を出す。メイン側（handleOpen*）が呼ぶと、
//   自動保存の 3 秒を待たずにその場で書く。書いた後のアンマウントでは書き直さない
// - 閉じたピークの口は外れる
// - ピークが消えるのと同じコミットでメインのエディタが作られても（素材ギャラリーを閉じて
//   本文へ戻る）、メインは書き出しを待ち、書き出した本文で作られる（古い本文で作られない）

import { StrictMode, useState, type ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

// pdf ビューアは jsdom に無い API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

// BlockNote 実体は jsdom で描けないので、本文（document）と変更通知だけを持つ偽エディタに
// 差し替える（side-peek.unmount-save.test.tsx と同じ）
type FakeEditorEntry = { editor: { document: any[] }; onChange?: () => void; initialContent: any[] };
const editors = vi.hoisted(() => ({ list: [] as FakeEditorEntry[] }));
vi.mock("../../base/editor", async () => {
  const { useEffect } = await import("react");
  return {
    SandboxEditor: ({
      initialContent,
      onEditorReady,
      onChange,
    }: {
      initialContent?: any[];
      onEditorReady?: (editor: any) => void;
      onChange?: () => void;
    }) => {
      useEffect(() => {
        const editor = {
          document: initialContent ?? [],
          domElement: document.createElement("div"),
          getBlock: (id: string) => editor.document.find((b: any) => b.id === id) ?? null,
          updateBlock: () => {},
        };
        editors.list.push({ editor, onChange, initialContent: initialContent ?? [] });
        onEditorReady?.(editor);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="fake-editor" />;
    },
  };
});

// 保存先（provider）はメモリ上の偽物。書き込みの順番と中身を記録する
const storage = vi.hoisted(() => ({
  files: new Map<string, any>(),
  saves: [] as Array<{ id: string; text: string }>,
  /** saveFile を遅らせるミリ秒（書き込み中にメインが開く状況を作る） */
  saveDelayMs: 0,
}));
vi.mock("../../lib/storage/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage/registry")>();
  return {
    ...actual,
    getActiveProvider: () => ({
      loadFile: async (id: string) => {
        const d = storage.files.get(id);
        if (!d) throw new Error(`not found: ${id}`);
        return structuredClone(d);
      },
      saveFile: async (id: string, doc: any) => {
        if (storage.saveDelayMs) await new Promise((r) => setTimeout(r, storage.saveDelayMs));
        storage.saves.push({ id, text: firstText(doc) });
        storage.files.set(id, structuredClone(doc));
      },
    }),
  };
});

import { render, cleanup, act, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SidePeek } from "./side-peek";
import { flushPeekSaves, hasPendingPeekEdits, pendingPeekSave } from "../../lib/peek-save-queue";
import { usePeekSettledDoc } from "../../hooks/use-peek-settled-doc";
import type { GraphiumDocument } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;
window.matchMedia ??= ((query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

function paragraph(text: string) {
  return {
    id: "b1",
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function makeDoc(text: string, modifiedAt = "2026-09-25T00:00:00.000Z"): GraphiumDocument {
  return {
    version: 6,
    title: "ノート",
    pages: [{ id: "p1", title: "ノート", blocks: [paragraph(text)], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt,
  } as unknown as GraphiumDocument;
}

function firstText(doc: any): string {
  return doc?.pages?.[0]?.blocks?.[0]?.content?.[0]?.text ?? "";
}

/** 親の doc キャッシュ（onSaved → reindexNoteFromDoc の代わり） */
function makeCache(entries: Array<[string, GraphiumDocument]>) {
  const cache = new Map(entries);
  return {
    get: (id: string) => cache.get(id),
    onSaved: (id: string, doc: GraphiumDocument) => void cache.set(id, doc),
  };
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <LocaleProvider>{children}</LocaleProvider>
    </StrictMode>
  );
}

/** ピーク内の最新の偽エディタで「入力」する */
async function typeInPeek(text: string) {
  const entry = editors.list[editors.list.length - 1];
  entry.editor.document = [paragraph(text)];
  await act(async () => {
    entry.onChange?.();
  });
}

const NOTE_IDS = ["m1", "m2", "m3"];

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(NOTE_IDS.every((id) => pendingPeekSave(id) === null)).toBe(true));
  editors.list = [];
  storage.files.clear();
  storage.saves = [];
  storage.saveDelayMs = 0;
});

describe("SidePeek: 同じノートをメインエディタで開く", () => {
  it("開いているピークは、メインが開く前に呼ぶと 3 秒を待たずにその場で書き出す", async () => {
    const v1 = makeDoc("v1");
    storage.files.set("m1", v1);
    const cache = makeCache([["m1", v1]]);
    const { unmount } = render(
      <SidePeek noteId="m1" cachedDoc={v1} getCachedDoc={cache.get} onSaved={cache.onSaved} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("v2");
    expect(hasPendingPeekEdits("m1")).toBe(true);

    // handleOpenFile がクリックの同期処理の中で呼ぶ
    const settled = flushPeekSaves("m1");
    expect(settled).not.toBeNull();
    await act(async () => {
      await settled;
    });

    expect(storage.saves).toEqual([{ id: "m1", text: "v2" }]);
    // onSaved でキャッシュに載っている（メインはここから開く）
    expect(firstText(cache.get("m1"))).toBe("v2");
    expect(hasPendingPeekEdits("m1")).toBe(false);

    // 書き出した後に閉じても、同じ本文を書き直さない
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(storage.saves).toEqual([{ id: "m1", text: "v2" }]);
  });

  it("閉じたピークの口は外れる（書き出すものも待つものも残らない）", async () => {
    const v1 = makeDoc("v1");
    storage.files.set("m2", v1);
    const cache = makeCache([["m2", v1]]);
    const { unmount } = render(
      <SidePeek noteId="m2" cachedDoc={v1} getCachedDoc={cache.get} onSaved={cache.onSaved} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("v2");

    unmount();
    await waitFor(() => expect(pendingPeekSave("m2")).toBeNull());

    expect(hasPendingPeekEdits("m2")).toBe(false);
    expect(flushPeekSaves("m2")).toBeNull();
    expect(storage.saves).toEqual([{ id: "m2", text: "v2" }]);
  });

  it("ピークが消えるのと同じコミットでメインが作られても、書き出しを待って新しい本文で作られる", async () => {
    const v1 = makeDoc("v1");
    storage.files.set("m3", v1);
    const cache = makeCache([["m3", v1]]);
    // 書き込み中にメインが開く状況にする
    storage.saveDelayMs = 30;
    // メインのエディタが作られたときの本文（BlockNote は作ったときの本文を持ち続ける）
    const mainCreatedWith: string[] = [];

    function MainEditorStub({ doc }: { doc: GraphiumDocument | null }) {
      useState(() => mainCreatedWith.push(firstText(doc)));
      return <div data-testid="main-editor" />;
    }
    function MainEditor({ docKey, initialDoc }: { docKey: string; initialDoc: GraphiumDocument }) {
      const settled = usePeekSettledDoc(docKey, initialDoc);
      if (settled.waiting) return <div data-testid="main-waiting" />;
      return <MainEditorStub doc={settled.doc} />;
    }
    // 素材ギャラリーのノートピーク ↔ 本文。activeDoc は onSaved（reindexNoteFromDoc）で進む
    function App({ view }: { view: "gallery" | "editor" }) {
      const [activeDoc, setActiveDoc] = useState<GraphiumDocument>(v1);
      const onSaved = (id: string, doc: GraphiumDocument) => {
        cache.onSaved(id, doc);
        setActiveDoc(doc);
      };
      return view === "gallery" ? (
        <SidePeek noteId="m3" cachedDoc={v1} getCachedDoc={cache.get} onSaved={onSaved} onClose={() => {}} onNavigate={() => {}} inline />
      ) : (
        <MainEditor docKey="m3" initialDoc={activeDoc} />
      );
    }

    const { rerender, queryByTestId } = render(<App view="gallery" />, { wrapper: Wrap });
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("v2");

    // ギャラリーを閉じて本文へ戻る（ピークのアンマウントとメインのマウントが同じコミット）
    rerender(<App view="editor" />);
    expect(queryByTestId("main-waiting")).not.toBeNull();
    await waitFor(() => expect(queryByTestId("main-editor")).not.toBeNull());

    // StrictMode は初期化を 2 回呼ぶので、作られた本文の種類で見る
    expect([...new Set(mainCreatedWith)]).toEqual(["v2"]);
    expect(firstText(storage.files.get("m3"))).toBe("v2");
    expect(storage.saves.map((s) => s.text)).not.toContain("v1");
  });
});
