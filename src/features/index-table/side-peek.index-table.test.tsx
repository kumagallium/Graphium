// @vitest-environment jsdom
// SidePeek のインデックステーブル配線のテスト。
//
// 対象の不変条件:
// - ピークは自分のエディタに受け口を登録する。スラッシュで挿入した表の登録（先頭列に
//   note-link）と、行から作ったノートの noteLinks はピークのノートに入る
// - 行から作った直後にノートを開かない（onNoteCreated を渡さない＝表に留まる）
// - タイトルを変えても、このピークで足した表の注釈は読み込み時点に戻らない。
//   以前は setDoc のたびに復元 effect が読み込み時点の page で注釈・リンクを戻し、
//   次のオートセーブでそのまま書き出していた（行の紐付けが消えて、行アイコンが
//   「ノートを作成」に戻る）

import { describe, it, expect, afterEach, vi } from "vitest";

// 本文は SidePeek 経由でブロック registry を読み込む。pdf ビューアは jsdom に無い
// API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

// BlockNote 実体は jsdom で描けないので、ブロックの外枠だけを持つ偽エディタに差し替える
const editorHolder = vi.hoisted(() => ({ current: null as any }));
vi.mock("../../base/editor", async () => {
  const { useEffect, useState } = await import("react");
  return {
    SandboxEditor: ({
      initialContent,
      onEditorReady,
    }: {
      initialContent?: any[];
      onEditorReady?: (editor: any) => void;
    }) => {
      // 実物と同じく、エディタはマウント時に 1 回だけ作る（initialContent は
      // ピークの描画ごとに作り直される配列なので、変化で作り直すと無限に回る）
      const [editor] = useState(() => {
        let blocks: any[] = structuredClone(initialContent ?? []);
        return {
          get document() {
            return blocks;
          },
          getBlock: (id: string) => blocks.find((b) => b.id === id) ?? null,
          updateBlock: (idOrBlock: any, patch: any) => {
            const id = typeof idOrBlock === "string" ? idOrBlock : idOrBlock?.id;
            blocks = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
          },
        };
      });
      useEffect(() => {
        editorHolder.current = editor;
        onEditorReady?.(editor);
      }, [editor, onEditorReady]);
      return <div data-testid="peek-editor" />;
    },
  };
});

// 保存はストレージに行かず、書き出す doc を控える
const saved = vi.hoisted(() => ({ docs: [] as any[] }));
vi.mock("@features/note-save", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@features/note-save")>()),
  saveNoteDoc: async ({
    noteId,
    doc,
    onSaved,
  }: {
    noteId: string;
    doc: any;
    onSaved?: (id: string, doc: any) => void;
  }) => {
    saved.docs.push(doc);
    onSaved?.(noteId, doc);
  },
}));

import { render, act, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SidePeek } from "./side-peek";
import { getEditorIndexTableCallbacks, registerIndexTable } from "./context";
import type { GraphiumDocument } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

// jsdom は matchMedia を持たない。useIsDesktop が落ちるので常に false（overlay）にする
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const TABLE_ID = "peek-table";
const cell = (text: string) => ({
  type: "tableCell",
  content: [{ type: "text", text, styles: {} }],
  props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1 },
});

function makeDoc(): GraphiumDocument {
  const now = "2026-09-25T00:00:00.000Z";
  return {
    version: 2,
    title: "Plan",
    pages: [
      {
        id: "page-1",
        title: "Main",
        blocks: [
          {
            id: TABLE_ID,
            type: "table",
            props: { textColor: "default" },
            content: {
              type: "tableContent",
              columnWidths: [undefined, undefined],
              rows: [{ cells: [cell("Name"), cell("Cond")] }, { cells: [cell("Sample A"), cell("")] }],
            },
            children: [],
          } as any,
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: now,
    modifiedAt: now,
  };
}

afterEach(() => {
  cleanup();
  saved.docs = [];
  editorHolder.current = null;
});

describe("SidePeek のインデックステーブル", () => {
  it("表の登録と行の紐付けはピークのノートに入り、タイトルを変えても戻らない", async () => {
    render(
      <LocaleProvider>
        <SidePeek
          noteId="peek-note"
          cachedDoc={makeDoc()}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          onOpenNoteInPeek={vi.fn()}
          files={[]}
          onRefreshFiles={vi.fn()}
        />
      </LocaleProvider>,
    );
    await waitFor(() => expect(editorHolder.current).not.toBeNull());
    const editor = editorHolder.current;
    // ピークは自分のエディタに受け口を登録する（派生元はピークのノート、作った直後には開かない）
    await waitFor(() => expect(getEditorIndexTableCallbacks(editor)).not.toBeNull());
    const callbacks = getEditorIndexTableCallbacks(editor)!;
    expect(callbacks.currentFileId).toBe("peek-note");
    expect(callbacks.onNoteCreated).toBeUndefined();

    // スラッシュで挿入した表の登録（先頭列に note-link）と、行から作ったノートの紐付け
    act(() => {
      expect(registerIndexTable(editor, TABLE_ID)).toBe(true);
      callbacks.onAddNoteLink("child-note", TABLE_ID);
    });

    // タイトルを変える（setDoc で doc が差し替わる）。inline でないピークは body へ
    // ポータルで描くので document から引く
    const title = document.querySelector<HTMLTextAreaElement>("[data-side-peek] textarea")!;
    act(() => {
      fireEvent.change(title, { target: { value: "Plan 2" } });
    });

    // ⌘S で保存する（ピークの中にフォーカスがあるときだけ効く）
    act(() => {
      title.focus();
      fireEvent.keyDown(document, { key: "s", metaKey: true });
    });
    await waitFor(() => expect(saved.docs.length).toBeGreaterThan(0));

    const doc = saved.docs[saved.docs.length - 1];
    expect(doc.title).toBe("Plan 2");
    expect(doc.pages[0].tableMeta?.[TABLE_ID]?.columns).toEqual({ Name: ["note-link"] });
    expect(doc.noteLinks).toEqual([
      { targetNoteId: "child-note", sourceBlockId: TABLE_ID, type: "derived_from" },
    ]);
  });
});
