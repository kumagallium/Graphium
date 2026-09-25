// @vitest-environment jsdom
// サイドピークの保存を待つ間に docRef へ入った書き換えを、保存の完了で消さない
// （StrictMode で描画する。main.tsx と同じ）。
//
// 対象の不変条件:
// - 保存の書き込みを待つ間に変えたタイトルが、次の保存に乗る（保存の完了で docRef を
//   保存した doc に置き換えない。peek-save-merge.ts の applySavedToPeekDoc）
// - 文脈ラベルを変えたときに一覧へ知らせる doc は、その保存で書いた doc。保存を待つ間に
//   打ったまだ保存していないタイトルを混ぜない（混ぜると、そのタイトルを保存したときの
//   onSaved が旧タイトルを取り違えて @メンションの改名伝播を飛ばす）

import { StrictMode, type ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

// pdf ビューアは jsdom に無い API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

// BlockNote 実体は jsdom で描けないので、本文（document）だけを持つ偽エディタに差し替える
const editors = vi.hoisted(() => ({ list: [] as Array<{ document: any[] }> }));
vi.mock("../../base/editor", async () => {
  const { useEffect } = await import("react");
  return {
    SandboxEditor: ({
      initialContent,
      onEditorReady,
    }: {
      initialContent?: any[];
      onEditorReady?: (editor: any) => void;
    }) => {
      useEffect(() => {
        const editor = {
          document: initialContent ?? [],
          domElement: document.createElement("div"),
          getBlock: (id: string) => editor.document.find((b: any) => b.id === id) ?? null,
          updateBlock: () => {},
          focus: () => {},
        };
        editors.list.push(editor);
        onEditorReady?.(editor);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="fake-editor" />;
    },
  };
});

// 保存先（provider）はメモリ上の偽物。hold の間は書き込みを 1 本ずつ止め、呼ばれた順に
// 再開口を pending へ積む（Google Drive のように保存に時間がかかる状況を作る）
const storage = vi.hoisted(() => ({
  files: new Map<string, any>(),
  saves: [] as any[],
  hold: false,
  pending: [] as Array<(ok: boolean) => void>,
}));
vi.mock("../../lib/storage/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage/registry")>();
  return {
    ...actual,
    getActiveProvider: () => ({
      loadFile: async (id: string) => structuredClone(storage.files.get(id)),
      saveFile: async (id: string, doc: any) => {
        if (storage.hold) {
          const ok = await new Promise<boolean>((resolve) => storage.pending.push(resolve));
          if (!ok) throw new Error("offline");
        }
        storage.saves.push(structuredClone(doc));
        storage.files.set(id, structuredClone(doc));
      },
    }),
  };
});

import { render, cleanup, act, fireEvent, waitFor, screen } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SidePeek } from "./side-peek";
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

function makeDoc(extra?: Partial<GraphiumDocument>): GraphiumDocument {
  return {
    version: 6,
    title: "旧タイトル",
    pages: [
      {
        id: "p1",
        title: "",
        blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "本文", styles: {} }], children: [] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt: "2026-09-25T00:00:00.000Z",
    ...extra,
  } as unknown as GraphiumDocument;
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <LocaleProvider>{children}</LocaleProvider>
    </StrictMode>
  );
}

/** 止めていた書き込みを 1 本進める（index は呼ばれた順。ok=false なら書き込みに失敗させる） */
async function finishSave(index: number, ok = true) {
  await waitFor(() => expect(storage.pending.length).toBeGreaterThan(index));
  await act(async () => {
    storage.pending[index](ok);
  });
}

/** ピークの中にフォーカスを置いて ⌘S（自動保存の 3 秒を待たずに保存する） */
function pressSave(titleBox: HTMLTextAreaElement) {
  titleBox.focus();
  fireEvent.keyDown(document, { key: "s", metaKey: true });
}

async function renderPeek(doc: GraphiumDocument, props?: { onNoteContextsChange?: (id: string, d: GraphiumDocument | null) => void }) {
  storage.files.set("n1", doc);
  const utils = render(
    <SidePeek
      noteId="n1"
      cachedDoc={doc}
      onClose={() => {}}
      onNavigate={() => {}}
      onNoteContextsChange={props?.onNoteContextsChange}
      inline
    />,
    { wrapper: Wrap },
  );
  await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
  const titleBox = utils.container.querySelector("textarea") as HTMLTextAreaElement;
  expect(titleBox.value).toBe("旧タイトル");
  return titleBox;
}

afterEach(() => {
  cleanup();
  editors.list = [];
  storage.files.clear();
  storage.saves = [];
  storage.hold = false;
  storage.pending = [];
});

describe("SidePeek: 保存を待つ間の書き換え", () => {
  it("書き込みを待つ間に変えたタイトルが、次の保存に乗る", async () => {
    const titleBox = await renderPeek(makeDoc());

    // 1 本目の保存を書き込み中で止め、その間にタイトルを変える
    storage.hold = true;
    pressSave(titleBox);
    fireEvent.change(titleBox, { target: { value: "新タイトル" } });
    await finishSave(0);
    await waitFor(() => expect(storage.saves).toHaveLength(1));
    expect(storage.saves[0].title).toBe("旧タイトル");

    // 2 本目の保存（本来は 3 秒後の自動保存）
    storage.hold = false;
    pressSave(titleBox);
    await waitFor(() => expect(storage.saves).toHaveLength(2));
    expect(storage.saves[1].title).toBe("新タイトル");
    expect(storage.files.get("n1").title).toBe("新タイトル");
  });

  it("保存が 2 本重なっても（先に始めた方が先に終わる）、書き込み中の書き換えが次の保存に乗る", async () => {
    const titleBox = await renderPeek(makeDoc());

    storage.hold = true;
    // 1 本目（旧タイトル）を書き込み中で止め、その間にタイトルを変える
    pressSave(titleBox);
    fireEvent.change(titleBox, { target: { value: "新タイトル" } });
    // 1 本目が終わる前に 2 本目（新タイトル）が始まり、その書き込み中にもう一度変える
    pressSave(titleBox);
    fireEvent.change(titleBox, { target: { value: "三つ目のタイトル" } });
    await finishSave(0);
    await finishSave(1);
    await waitFor(() => expect(storage.saves).toHaveLength(2));

    storage.hold = false;
    pressSave(titleBox);
    await waitFor(() => expect(storage.saves).toHaveLength(3));
    expect(storage.saves.map((d) => d.title)).toEqual(["旧タイトル", "新タイトル", "三つ目のタイトル"]);
  });

  it("文脈ラベルを外したときに一覧へ渡す doc は、その保存で書いた doc（保存を待つ間のタイトルを混ぜない）", async () => {
    const onNoteContextsChange = vi.fn();
    const titleBox = await renderPeek(makeDoc({ noteContexts: ["実験"] }), { onNoteContextsChange });

    // 文脈ラベルを外すと、その場で保存が走る。書き込み中に止めてタイトルを変える
    storage.hold = true;
    fireEvent.click(screen.getByRole("button", { name: /Remove from folder|フォルダから出す/ }));
    fireEvent.change(titleBox, { target: { value: "新タイトル" } });
    await finishSave(0);
    await waitFor(() => expect(onNoteContextsChange).toHaveBeenCalledTimes(1));

    const [notifiedId, notifiedDoc] = onNoteContextsChange.mock.calls[0];
    expect(notifiedId).toBe("n1");
    expect(notifiedDoc).toEqual(storage.saves[0]);
    expect(notifiedDoc.title).toBe("旧タイトル");
    expect(notifiedDoc.noteContexts ?? []).toEqual([]);

    // 次の保存にはタイトルも外した文脈ラベルも乗る
    storage.hold = false;
    pressSave(titleBox);
    await waitFor(() => expect(storage.saves).toHaveLength(2));
    expect(storage.saves[1].title).toBe("新タイトル");
    expect(storage.saves[1].noteContexts ?? []).toEqual([]);
  });

  it("保存に失敗したら、文脈ラベルの変更を一覧へ知らせない", async () => {
    const onNoteContextsChange = vi.fn();
    await renderPeek(makeDoc({ noteContexts: ["実験"] }), { onNoteContextsChange });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    storage.hold = true;
    fireEvent.click(screen.getByRole("button", { name: /Remove from folder|フォルダから出す/ }));
    await finishSave(0, false);
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    await act(async () => {});

    expect(storage.saves).toHaveLength(0);
    expect(onNoteContextsChange).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
