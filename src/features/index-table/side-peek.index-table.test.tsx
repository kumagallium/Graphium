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
// - つながった行を開く前に、待っている編集を保存し終える。行を押すとピークは別ノートへ
//   切り替わり（親の key={noteId} で作り直し）、3 秒待ちの自動保存はアンマウントで
//   流れない。保存中に打った分（表示は「保存済み」でもタイマーが待っている）も含む

import { describe, it, expect, afterEach, vi } from "vitest";

// 本文は SidePeek 経由でブロック registry を読み込む。pdf ビューアは jsdom に無い
// API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

// BlockNote 実体は jsdom で描けないので、ブロックの外枠だけを持つ偽エディタに差し替える。
// onChange は本文の編集を再現するために控える
const editorHolder = vi.hoisted(() => ({ current: null as any, onChange: null as (() => void) | null }));
vi.mock("../../base/editor", async () => {
  const { useEffect, useState } = await import("react");
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
      editorHolder.onChange = onChange ?? null;
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

// 保存はストレージに行かず、書き出す doc を控える。hold を置くと次の保存を
// それが解決するまで止める（保存中の打鍵を再現する）。completed は書き終えた数
const saved = vi.hoisted(() => ({
  docs: [] as any[],
  hold: null as Promise<void> | null,
  completed: 0,
}));
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
    const hold = saved.hold;
    saved.hold = null;
    if (hold) await hold;
    onSaved?.(noteId, doc);
    saved.completed += 1;
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
const BODY_ID = "peek-body";
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
          {
            id: BODY_ID,
            type: "paragraph",
            props: {},
            content: [{ type: "text", text: "Body", styles: {} }],
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
  saved.hold = null;
  saved.completed = 0;
  editorHolder.current = null;
  editorHolder.onChange = null;
});

/** 本文の段落を書き換え、エディタの変更として通知する（打鍵と同じく自動保存のタイマーが動く） */
function editBody(editor: any, text: string) {
  act(() => {
    editor.updateBlock(BODY_ID, { content: [{ type: "text", text, styles: {} }] });
    editorHolder.onChange?.();
  });
}

function bodyText(doc: GraphiumDocument | undefined): string | undefined {
  const block = doc?.pages[0].blocks.find((b: any) => b.id === BODY_ID) as any;
  return block?.content?.map((c: any) => c.text).join("");
}

/** 行を開いた時点で保存し終えていた最後の doc を控える onOpenNoteInPeek */
function recordOpens() {
  const opens: { id: string; lastSaved: GraphiumDocument | undefined }[] = [];
  const onOpenNoteInPeek = vi.fn((id: string) => {
    opens.push({ id, lastSaved: saved.docs[saved.docs.length - 1] });
  });
  return { opens, onOpenNoteInPeek };
}

async function renderPeek(onOpenNoteInPeek: (id: string) => void) {
  render(
    <LocaleProvider>
      <SidePeek
        noteId="peek-note"
        cachedDoc={makeDoc()}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onOpenNoteInPeek={onOpenNoteInPeek}
        files={[]}
        onRefreshFiles={vi.fn()}
      />
    </LocaleProvider>,
  );
  await waitFor(() => expect(editorHolder.current).not.toBeNull());
  const editor = editorHolder.current;
  await waitFor(() => expect(getEditorIndexTableCallbacks(editor)).not.toBeNull());
  return { editor, callbacks: getEditorIndexTableCallbacks(editor)! };
}

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

  it("編集の直後につながった行を押しても、保存し終えてから開く", async () => {
    const { opens, onOpenNoteInPeek } = recordOpens();
    const { editor, callbacks } = await renderPeek(onOpenNoteInPeek);

    // 打ってから 3 秒待たずに行を押す（行アイコン層の覆いは onOpenSidePeek を呼ぶ）
    editBody(editor, "edited right before the switch");
    act(() => callbacks.onOpenSidePeek("row-note"));

    await waitFor(() => expect(onOpenNoteInPeek).toHaveBeenCalledTimes(1));
    expect(opens[0].id).toBe("row-note");
    expect(bodyText(opens[0].lastSaved)).toBe("edited right before the switch");
  });

  it("保存中に打った分も、つながった行を開く前に保存する", async () => {
    const { opens, onOpenNoteInPeek } = recordOpens();
    const { editor, callbacks } = await renderPeek(onOpenNoteInPeek);

    // 1 回目の保存（⌘S）を止めておき、その間に打つ
    let release!: () => void;
    saved.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    editBody(editor, "first");
    const title = document.querySelector<HTMLTextAreaElement>("[data-side-peek] textarea")!;
    act(() => {
      title.focus();
      fireEvent.keyDown(document, { key: "s", metaKey: true });
    });
    await waitFor(() => expect(saved.docs.length).toBe(1));
    editBody(editor, "typed while saving");

    // 1 回目が書き終わると表示は「保存済み」に戻るが、後から打った分はタイマーで待っている
    await act(async () => {
      release();
    });
    await waitFor(() => expect(saved.completed).toBe(1));

    act(() => callbacks.onOpenSidePeek("row-note"));

    await waitFor(() => expect(onOpenNoteInPeek).toHaveBeenCalledTimes(1));
    expect(bodyText(opens[0].lastSaved)).toBe("typed while saving");
  });
});
