// @vitest-environment jsdom
// 設定の「これまでのノートも A4 にする」がファイルを直接書き換えたあと、開いているサイドピークが
// 古い幅で書き戻さない（applyLiveBodyWidth の受け口）。
//
// - 知らせを受けても未保存にならず、書き込みも起きない（開いただけで書き込まない不変条件）
// - そのあと本文を変えて保存しても、新しい幅（paperSize: a4）のまま書く
// - 知らせなければ、本文を変えた保存は古い幅（標準）で書き戻す（このテストが守る理由）
// ハーネスは side-peek.no-write-on-open.test.tsx と同じ（偽エディタ・メモリ上の provider）。

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

// 保存先（provider）はメモリ上の偽物。saveFile が呼ばれた回数と中身を記録する
const storage = vi.hoisted(() => ({
  files: new Map<string, any>(),
  saves: [] as any[],
}));
vi.mock("../../lib/storage/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage/registry")>();
  return {
    ...actual,
    getActiveProvider: () => ({
      loadFile: async (id: string) => structuredClone(storage.files.get(id)),
      saveFile: async (id: string, doc: any) => {
        storage.saves.push(structuredClone(doc));
        storage.files.set(id, structuredClone(doc));
      },
    }),
  };
});

import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SidePeek } from "./side-peek";
import { applyLiveBodyWidth, pendingPeekSave } from "../../lib/peek-save-queue";
import type { GraphiumDocument } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;
// AlignmentStyleLayer が center/right の配置がある時に CSS.escape を使う（jsdom に無い）
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {} as any;
(globalThis.CSS as { escape?: (s: string) => string }).escape ??= (s: string) => s;
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

/** 付加情報（ラベル・リンク・表の注釈・配置）を持つノート */
function docWithAnnotations(): GraphiumDocument {
  return {
    version: 6,
    title: "ノート",
    pages: [
      {
        id: "p1",
        title: "ノート",
        blocks: [paragraph("本文")],
        labels: { b1: "procedure" },
        provLinks: [
          {
            id: "l1",
            sourceBlockId: "b1",
            targetBlockId: "b1",
            type: "derived_from",
            layer: "prov",
            createdBy: "human",
          },
        ],
        knowledgeLinks: [],
        tableMeta: { b1: { columnTypes: {} } } as any,
        blockAlignments: { b1: "center" },
      },
    ],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt: "2026-09-25T00:00:00.000Z",
  } as unknown as GraphiumDocument;
}

/** 付加情報を 1 つも持たないノート */
function docWithoutAnnotations(): GraphiumDocument {
  return {
    version: 6,
    title: "ノート",
    pages: [
      { id: "p1", title: "ノート", blocks: [paragraph("本文")], labels: {}, provLinks: [], knowledgeLinks: [] },
    ],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt: "2026-09-25T00:00:00.000Z",
  } as unknown as GraphiumDocument;
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <LocaleProvider>{children}</LocaleProvider>
    </StrictMode>
  );
}

async function typeInPeek(text: string) {
  const entry = editors.list[editors.list.length - 1];
  entry.editor.document = [paragraph(text)];
  await act(async () => {
    entry.onChange?.();
  });
}

async function pressSave(container: HTMLElement) {
  const titleBox = container.querySelector("textarea") as HTMLTextAreaElement;
  titleBox.focus();
  await act(async () => {
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 設定の操作がファイルへ書いた形（幅の項目だけ差し替えた doc） */
function withA4(doc: GraphiumDocument): GraphiumDocument {
  return { ...doc, paperSize: "a4" } as GraphiumDocument;
}

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(pendingPeekSave("n1")).toBeNull());
  editors.list = [];
  storage.files.clear();
  storage.saves = [];
});

async function openPeek(doc: GraphiumDocument) {
  storage.files.set("n1", doc);
  const view = render(
    <SidePeek noteId="n1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
    { wrapper: Wrap },
  );
  await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe("SidePeek: 本文の幅が外から変わった", () => {
  it("知らせを受けても未保存にならず、書き込みもしない", async () => {
    const doc = docWithoutAnnotations();
    const { container } = await openPeek(doc);

    const saved = withA4(doc);
    storage.files.set("n1", saved);
    act(() => {
      expect(applyLiveBodyWidth("n1", { fullWidth: false, paperSize: "a4" }, saved)).toBe(1);
    });

    expect(container.textContent).not.toContain("Unsaved");
    await pressSave(container);
    expect(storage.saves).toEqual([]);
  });

  it("そのあと本文を変えて保存しても、新しい幅のまま書く（古い幅で書き戻さない）", async () => {
    const doc = docWithoutAnnotations();
    const { container } = await openPeek(doc);

    const saved = withA4(doc);
    storage.files.set("n1", saved);
    act(() => {
      applyLiveBodyWidth("n1", { fullWidth: false, paperSize: "a4" }, saved);
    });
    await typeInPeek("変えた");
    await pressSave(container);

    await waitFor(() => expect(storage.saves).toHaveLength(1));
    expect(storage.saves[0].paperSize).toBe("a4");
  });

  it("標準に戻した知らせも同じ: 本文を変えて保存しても paperSize は付かない", async () => {
    const doc = withA4(docWithoutAnnotations());
    const { container } = await openPeek(doc);

    const { paperSize: _p, ...restored } = doc as unknown as Record<string, unknown>;
    const saved = restored as unknown as GraphiumDocument;
    storage.files.set("n1", saved);
    act(() => {
      applyLiveBodyWidth("n1", { fullWidth: false, paperSize: undefined }, saved);
    });
    await typeInPeek("変えた");
    await pressSave(container);

    await waitFor(() => expect(storage.saves).toHaveLength(1));
    expect("paperSize" in storage.saves[0]).toBe(false);
  });

  it("知らせなければ、本文を変えた保存は古い幅で書き戻す（知らせが要る理由）", async () => {
    const doc = docWithoutAnnotations();
    const { container } = await openPeek(doc);

    storage.files.set("n1", withA4(doc));
    await typeInPeek("変えた");
    await pressSave(container);

    await waitFor(() => expect(storage.saves).toHaveLength(1));
    expect(storage.saves[0].paperSize).toBeUndefined();
  });
});
