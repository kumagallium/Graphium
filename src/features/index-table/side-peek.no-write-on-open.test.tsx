// @vitest-environment jsdom
// no-write-on-open: ノートを開いただけで書き込まない・「未保存」を出さない
// （StrictMode で描画する。main.tsx と同じ）。
//
// 対象の不変条件:
// - 開いて何もしなければ、付加情報（ラベル・リンク・表の注釈・配置）の有無に関わらず、
//   保存先への書き込みが 0 回。ヘッダーは「未保存」にならない
// - 開いたあと本文を変えれば、通常どおり書き込む（更新日時が進む）
// - 変えて保存したあと、何もしないでもう一度保存を呼んでも 2 回目は書かない
// - 変えて、元に戻してから保存すると書かない（「保存される形」が同じ）

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
import { pendingPeekSave } from "../../lib/peek-save-queue";
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

/** ピーク内の最新の偽エディタで「入力」する */
async function typeInPeek(text: string) {
  const entry = editors.list[editors.list.length - 1];
  entry.editor.document = [paragraph(text)];
  await act(async () => {
    entry.onChange?.();
  });
}

/** ⌘S で即時保存を試みる（自動保存の 3 秒を待たない） */
async function pressSave(container: HTMLElement) {
  const titleBox = container.querySelector("textarea") as HTMLTextAreaElement;
  titleBox.focus();
  await act(async () => {
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    // doSave は async。書き込み・スキップのどちらでも、内部の await が解決するまで進める
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(pendingPeekSave("n1")).toBeNull());
  editors.list = [];
  storage.files.clear();
  storage.saves = [];
});

describe("SidePeek: no-write-on-open", () => {
  it("付加情報を持つノートを開いて何もしない → 書き込みが 0 回。未保存にならない", async () => {
    const doc = docWithAnnotations();
    storage.files.set("n1", doc);
    const { container } = render(
      <SidePeek noteId="n1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    // ラベル・リンク・表の注釈・配置の復元 effect が一巡するのを待つ
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Unsaved");

    await pressSave(container);
    expect(storage.saves).toEqual([]);
  });

  it("付加情報を持たないノートを開いて何もしない → 書き込みが 0 回。未保存にならない", async () => {
    const doc = docWithoutAnnotations();
    storage.files.set("n1", doc);
    const { container } = render(
      <SidePeek noteId="n1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Unsaved");

    await pressSave(container);
    expect(storage.saves).toEqual([]);
  });

  it("開いたあと本文を 1 文字変えると書き込む。更新日時が進む", async () => {
    const doc = docWithoutAnnotations();
    storage.files.set("n1", doc);
    const { container } = render(
      <SidePeek noteId="n1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("変えた");

    await pressSave(container);
    await waitFor(() => expect(storage.saves).toHaveLength(1));
    expect(storage.saves[0].modifiedAt).not.toBe(doc.modifiedAt);
  });

  it("変えて保存したあと、何もしないでもう一度保存を呼んでも 2 回目は書かない", async () => {
    const doc = docWithoutAnnotations();
    storage.files.set("n1", doc);
    const { container } = render(
      <SidePeek noteId="n1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("変えた");
    await pressSave(container);
    await waitFor(() => expect(storage.saves).toHaveLength(1));

    await pressSave(container);
    await act(async () => {
      await Promise.resolve();
    });
    expect(storage.saves).toHaveLength(1);
  });

  it("変えて、元に戻してから保存すると書かない（保存される形が同じ）", async () => {
    const doc = docWithoutAnnotations();
    storage.files.set("n1", doc);
    const { container } = render(
      <SidePeek noteId="n1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await typeInPeek("変えた");
    await typeInPeek("本文"); // 元のテキストへ戻す

    await pressSave(container);
    await act(async () => {
      await Promise.resolve();
    });
    expect(storage.saves).toEqual([]);
  });
});
