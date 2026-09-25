// @vitest-environment jsdom
// サイドピークがピークの外の操作で消えるときの保存（StrictMode で描画する。main.tsx と同じ）。
//
// 対象の不変条件:
// - キャッシュから開いたピークでも API から読んだピークでも、消える瞬間に直前 3 秒の
//   未保存の編集を書き出す（素材ギャラリーで素材を切り替える・サイドバーで別の画面へ移る）
// - 同じノートのピークを作り直すと（素材を切り替えると全画面ごと作り直す）、新しいピークは
//   書き出しの完了を待ち、開いた時点の古い cachedDoc ではなく書き出した本文で開く
// - 版スナップショット（snapshot:）は消えるときにも書かない
// - StrictMode の試しのアンマウントでは書き出さない

import { StrictMode, type ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

// pdf ビューアは jsdom に無い API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

// BlockNote 実体は jsdom で描けないので、本文（document）と変更通知だけを持つ偽エディタに
// 差し替える。テストは document を書き換えてから onChange を呼んで「入力」を再現する
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
  /** saveFile を遅らせるミリ秒（書き込み中に作り直す状況を作る） */
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
import { pendingPeekSave } from "../../lib/peek-save-queue";
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

async function waitForQueueToDrain(noteId: string) {
  await waitFor(() => expect(pendingPeekSave(noteId)).toBeNull());
}

const NOTE_IDS = ["n1", "n2", "n3", "n4", "n5", "snapshot:s1"];

afterEach(async () => {
  // 後片付けのアンマウントでも書き出すので、その保存が次のテストの記録に紛れないよう待つ
  cleanup();
  await waitFor(() => expect(NOTE_IDS.every((id) => pendingPeekSave(id) === null)).toBe(true));
  editors.list = [];
  storage.files.clear();
  storage.saves = [];
  storage.saveDelayMs = 0;
});

describe("SidePeek: ピークの外の操作で消えるときの保存", () => {
  it("キャッシュから開いたピークが消えると、直前の編集をその場で書き出す（3 秒待たない）", async () => {
    const v1 = makeDoc("v1");
    storage.files.set("n1", v1);
    const cache = makeCache([["n1", v1]]);
    const { unmount } = render(
      <SidePeek noteId="n1" cachedDoc={v1} getCachedDoc={cache.get} onSaved={cache.onSaved} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("v2");

    unmount();
    await waitForQueueToDrain("n1");

    expect(storage.saves[storage.saves.length - 1]).toEqual({ id: "n1", text: "v2" });
    expect(firstText(cache.get("n1"))).toBe("v2");
  });

  it("API から読んだピーク（cachedDoc なし）でも、消えるときに直前の編集を落とさない", async () => {
    storage.files.set("n2", makeDoc("v1"));
    const cache = makeCache([]);
    const { unmount } = render(
      <SidePeek noteId="n2" getCachedDoc={cache.get} onSaved={cache.onSaved} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("v2");

    unmount();
    await waitForQueueToDrain("n2");

    expect(firstText(storage.files.get("n2"))).toBe("v2");
  });

  it("同じノートのピークを作り直すと、書き出しの完了を待って新しい本文で開く（古い cachedDoc を使わない）", async () => {
    const v1 = makeDoc("v1");
    storage.files.set("n3", v1);
    const cache = makeCache([["n3", v1]]);
    // 書き出しが書き込み中のうちに作り直す
    storage.saveDelayMs = 30;
    const peek = (generation: number) => (
      // 素材ギャラリーの全画面は素材ごとに key が変わり、中のノートピークも作り直される
      <div key={generation}>
        <SidePeek noteId="n3" cachedDoc={v1} getCachedDoc={cache.get} onSaved={cache.onSaved} onClose={() => {}} onNavigate={() => {}} inline />
      </div>
    );
    const { rerender } = render(peek(1), { wrapper: Wrap });
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("v2");
    const editorsBefore = editors.list.length;

    // 作り直す。新しいピークに渡る cachedDoc は親のキャッシュ（まだ v1）
    rerender(peek(2));
    // 書き出しを待つ間は開かない（読み込み中）
    expect(editors.list.length).toBe(editorsBefore);
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(editorsBefore));

    const reopened = editors.list[editors.list.length - 1];
    expect(firstText({ pages: [{ blocks: reopened.initialContent }] })).toBe("v2");
    expect(firstText(storage.files.get("n3"))).toBe("v2");
    // v1 が後から書き戻されていない（書き込みは v2 だけ）
    expect(storage.saves.map((s) => s.text)).not.toContain("v1");
  });

  it("キャッシュに無いノートでも、作り直したピークは書き出しの完了を待ってから開く（書き込み中のファイルを読まない）", async () => {
    storage.files.set("n5", makeDoc("v1"));
    const cache = makeCache([]);
    storage.saveDelayMs = 30;
    const peek = (generation: number) => (
      <div key={generation}>
        <SidePeek noteId="n5" getCachedDoc={cache.get} onClose={() => {}} onNavigate={() => {}} inline />
      </div>
    );
    const { rerender } = render(peek(1), { wrapper: Wrap });
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("v2");
    const editorsBefore = editors.list.length;

    // onSaved を渡していないので親のキャッシュは空のまま。待たずに読むと書き込み前の v1 を読む
    rerender(peek(2));
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(editorsBefore));

    const reopened = editors.list[editors.list.length - 1];
    expect(firstText({ pages: [{ blocks: reopened.initialContent }] })).toBe("v2");
    expect(firstText(storage.files.get("n5"))).toBe("v2");
  });

  it("版スナップショット（snapshot:）は消えるときにも書かない", async () => {
    const snap = makeDoc("frozen");
    const { unmount } = render(
      <SidePeek noteId="snapshot:s1" cachedDoc={snap} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("changed");

    unmount();
    await new Promise((r) => setTimeout(r, 0));

    expect(storage.saves).toEqual([]);
    expect(pendingPeekSave("snapshot:s1")).toBeNull();
  });

  it("StrictMode の試しのアンマウントでは書き出さない（開いただけでは書かない）", async () => {
    const v1 = makeDoc("v1");
    storage.files.set("n4", v1);
    const cache = makeCache([["n4", v1]]);
    render(
      <SidePeek noteId="n4" cachedDoc={v1} getCachedDoc={cache.get} onSaved={cache.onSaved} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));

    expect(storage.saves.filter((s) => s.id === "n4")).toEqual([]);
  });
});
