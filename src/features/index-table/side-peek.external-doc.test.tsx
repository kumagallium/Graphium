// @vitest-environment jsdom
// ナレッジの保守の取り消しが、開いているサイドピークのページをストレージ・キャッシュへ書き戻したあと
// （applyLiveExternalDoc の受け口）。
//
// - 表示のエディタが新しい内容で作り直される
// - 差し替えても未保存にならず、書き込みも起きない（開いただけで書き込まない不変条件）
// - 前の内容のラベル・リンクが次の保存に混ざらない
// - 未保存の編集が残っていれば断る（差し替えない）
// - 差し替えたあとの編集は、新しい内容を土台に保存する（古い内容で書き戻さない）
// ハーネスは side-peek.bulk-body-width.test.tsx と同じ（偽エディタ・メモリ上の provider）。

import { StrictMode, type ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

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
import { applyLiveExternalDoc, pendingPeekSave, queuePeekSave, registerLivePeek } from "../../lib/peek-save-queue";
import type { GraphiumDocument } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;
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

/** ラベルを持つ、取り消し前（保守のあと）のノート */
function docAfterMaintenance(): GraphiumDocument {
  return {
    version: 6,
    title: "統合後",
    pages: [
      { id: "p1", title: "統合後", blocks: [paragraph("統合後の本文")], labels: { b1: "procedure" }, provLinks: [], knowledgeLinks: [] },
    ],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt: "2026-10-05T00:00:00.000Z",
  } as unknown as GraphiumDocument;
}

/** 取り消しで戻した内容（ラベルなし） */
function docRestored(): GraphiumDocument {
  return {
    version: 6,
    title: "統合前",
    pages: [{ id: "p1", title: "統合前", blocks: [paragraph("統合前の本文")], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt: "2026-10-05T01:00:00.000Z",
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

/** 差し替えを知らせ、作り直されたエディタが出るまで待つ */
async function applyExternal(doc: GraphiumDocument): Promise<number> {
  const before = editors.list.length;
  let applied = 0;
  await act(async () => {
    applied = applyLiveExternalDoc("n1", doc);
  });
  if (applied > 0) await waitFor(() => expect(editors.list.length).toBeGreaterThan(before));
  await act(async () => {
    await Promise.resolve();
  });
  return applied;
}

describe("SidePeek: 開いているページが外から書き換わった", () => {
  it("表示のエディタが新しい内容で作り直され、未保存にならず、書き込みもしない", async () => {
    const { container } = await openPeek(docAfterMaintenance());

    storage.files.set("n1", docRestored());
    expect(await applyExternal(docRestored())).toBe(1);

    const latest = editors.list[editors.list.length - 1];
    expect(latest.initialContent[0].content[0].text).toBe("統合前の本文");
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("統合前");
    expect(container.textContent).not.toContain("Unsaved");

    await pressSave(container);
    expect(storage.saves).toEqual([]);
  });

  it("差し替えたあとの編集は、新しい内容を土台に保存する（前のラベル・タイトルが混ざらない）", async () => {
    const { container } = await openPeek(docAfterMaintenance());

    storage.files.set("n1", docRestored());
    await applyExternal(docRestored());
    await typeInPeek("あとから打った");
    await pressSave(container);

    await waitFor(() => expect(storage.saves).toHaveLength(1));
    const saved = storage.saves[0];
    expect(saved.title).toBe("統合前");
    expect(saved.pages[0].labels ?? {}).toEqual({});
    expect(saved.pages[0].blocks[0].content[0].text).toBe("あとから打った");
  });

  it("未保存の編集が残っていれば断る（差し替えず、エディタも作り直さない）", async () => {
    const { container } = await openPeek(docAfterMaintenance());
    await typeInPeek("打った");
    const before = editors.list.length;

    let applied = -1;
    await act(async () => {
      applied = applyLiveExternalDoc("n1", docRestored());
    });
    expect(applied).toBe(0);
    expect(editors.list.length).toBe(before);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("統合後");
  });

  it("保存が列に残っていれば断る（エディタも作り直さない）", async () => {
    await openPeek(docAfterMaintenance());
    const before = editors.list.length;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    void queuePeekSave("n1", docAfterMaintenance(), async () => {
      await gate;
    });
    let applied = -1;
    await act(async () => {
      applied = applyLiveExternalDoc("n1", docRestored());
    });
    expect(applied).toBe(0);
    expect(editors.list.length).toBe(before);
    release();
    await waitFor(() => expect(pendingPeekSave("n1")).toBeNull());
  });

  it("差し替えが決まった後に届く変更は保存を張らない（前の内容を書かない）", async () => {
    const { container } = await openPeek(docAfterMaintenance());
    const oldEntry = editors.list[editors.list.length - 1];
    storage.files.set("n1", docRestored());
    await applyExternal(docRestored());
    // 古い内側のエディタからの変更通知（アンマウント後・隙間のどちらでも書かない）
    await act(async () => {
      oldEntry.onChange?.();
    });
    await pressSave(container);
    expect(storage.saves).toEqual([]);
  });

  it("同じページを開いているメイン（口なし）と並んでいても、ピークだけを数える", async () => {
    await openPeek(docAfterMaintenance());
    const unregisterMain = registerLivePeek("n1", { hasUnsaved: () => false, flush: () => {} });

    storage.files.set("n1", docRestored());
    expect(await applyExternal(docRestored())).toBe(1);
    unregisterMain();
  });

  it("差し替えを 2 回続けても、最後の内容で開く", async () => {
    await openPeek(docAfterMaintenance());
    await applyExternal(docRestored());
    const again = { ...docAfterMaintenance(), title: "もう一度" } as GraphiumDocument;
    again.pages = [{ ...again.pages[0], blocks: [paragraph("もう一度の本文")] }];
    expect(await applyExternal(again)).toBe(1);
    const latest = editors.list[editors.list.length - 1];
    expect(latest.initialContent[0].content[0].text).toBe("もう一度の本文");
  });
});
