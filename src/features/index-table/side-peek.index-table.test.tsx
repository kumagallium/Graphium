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
// - note-link 列で @ から既存ノートを選ぶと、その行に紐付く（メインと同じ）。
//   以前はピークだけ @リンクを入れるだけで、行アイコンが「ノートを作成」のまま残り、
//   押すと「@名前」という題の重複ノートができていた
// - 表の外で @ から既存ノートを選ぶと、ピークのノートの noteLinks に派生関係が入る
//   （メインと同じ）。以前はピークだけ記録せず、@ したノートへの線がグラフ・来歴に
//   出なかった。保存を待つ間に選んでも、保存完了で消えない

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
const editorHolder = vi.hoisted(() => ({
  current: null as any,
  onChange: null as (() => void) | null,
  // エディタに渡された @ メニューの口（最新の描画のもの）
  mention: null as null | {
    getMentionSuggestions?: (query: string) => any[];
    onMentionSelect?: (sourceBlockId: string, suggestion: any) => unknown;
  },
  // カーソルのある表のセル。null なら表の外
  cursor: null as null | { tableBlockId: string; rowIndex: number; colIndex: number },
}));
vi.mock("../../base/editor", async () => {
  const { useEffect, useState } = await import("react");
  return {
    SandboxEditor: ({
      initialContent,
      onEditorReady,
      onChange,
      getMentionSuggestions,
      onMentionSelect,
    }: {
      initialContent?: any[];
      onEditorReady?: (editor: any) => void;
      onChange?: () => void;
      getMentionSuggestions?: (query: string) => any[];
      onMentionSelect?: (sourceBlockId: string, suggestion: any) => unknown;
    }) => {
      editorHolder.onChange = onChange ?? null;
      editorHolder.mention = { getMentionSuggestions, onMentionSelect };
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
          // @リンクの挿入。表の外のカーソルは本文の最初の段落の末尾にいる扱い
          // （表のセルへの挿入は linkTableRowToNote がセルを書き換えるので使わない）
          insertInlineContent: (content: any[]) => {
            if (editorHolder.cursor) return;
            const at = blocks.findIndex((b) => b.type === "paragraph");
            if (at < 0) return;
            blocks = blocks.map((b, i) => (i === at ? { ...b, content: [...(b.content ?? []), ...content] } : b));
          },
          // カーソル位置（ProseMirror の $from）。表の中なら blockContainer > table >
          // tableRow > tableCell の入れ子で、index は祖先の中で何番目の子にいるか
          _tiptapEditor: {
            get state() {
              const cursor = editorHolder.cursor;
              const chain = cursor
                ? [
                    { type: { name: "doc" } },
                    { type: { name: "blockContainer" }, attrs: { id: cursor.tableBlockId } },
                    { type: { name: "table" } },
                    { type: { name: "tableRow" } },
                    { type: { name: "tableCell" } },
                    { type: { name: "tableParagraph" } },
                  ]
                : [
                    { type: { name: "doc" } },
                    { type: { name: "blockContainer" }, attrs: { id: "p1" } },
                    { type: { name: "paragraph" } },
                  ];
              const $from = {
                depth: chain.length - 1,
                node: (d: number) => chain[d],
                index: (d: number) => (!cursor ? 0 : d === 2 ? cursor.rowIndex : d === 3 ? cursor.colIndex : 0),
              };
              return { selection: { $from } };
            },
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
import { CREATE_NEW_NOTE_ID } from "../block-link/mention-menu";
import { readCellText } from "../table-meta/table-cells";
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

function makeDoc(tableMeta?: NonNullable<GraphiumDocument["pages"][number]["tableMeta"]>): GraphiumDocument {
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
        ...(tableMeta ? { tableMeta } : {}),
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
  editorHolder.mention = null;
  editorHolder.cursor = null;
});

/** ピークの中にフォーカスを置いて ⌘S で保存し、書き出した doc を返す */
async function saveWithShortcut(): Promise<any> {
  const before = saved.docs.length;
  // inline でないピークは body へポータルで描くので document から引く
  const title = document.querySelector<HTMLTextAreaElement>("[data-side-peek] textarea")!;
  act(() => {
    title.focus();
    fireEvent.keyDown(document, { key: "s", metaKey: true });
  });
  await waitFor(() => expect(saved.docs.length).toBeGreaterThan(before));
  return saved.docs[saved.docs.length - 1];
}

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

/** エディタ上の本文の段落の文字（保存前の状態を見る） */
function editorBodyText(editor: any): string {
  return editor.getBlock(BODY_ID).content.map((c: any) => c.text).join("");
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

  it("note-link 列で @ から既存ノートを選ぶと、その行に紐付けてピークのノートに保存する", async () => {
    const onCreateLinkedNote = vi.fn();
    render(
      <LocaleProvider>
        <SidePeek
          noteId="peek-note"
          cachedDoc={makeDoc({ [TABLE_ID]: { columns: { Name: ["note-link"] } } })}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          onOpenNoteInPeek={vi.fn()}
          onCreateLinkedNote={onCreateLinkedNote}
          files={[]}
          onRefreshFiles={vi.fn()}
        />
      </LocaleProvider>,
    );
    await waitFor(() => expect(editorHolder.current).not.toBeNull());
    const editor = editorHolder.current;
    const offersCreate = (query: string) =>
      editorHolder.mention!.getMentionSuggestions!(query).some((s) => s.id === CREATE_NEW_NOTE_ID);

    // note-link 列（先頭列）で @ を打つと、新規作成の候補は出さない（行アイコンから作る）。
    // 表の注釈は読み込み後に復元されるので、それを待つ
    editorHolder.cursor = { tableBlockId: TABLE_ID, rowIndex: 1, colIndex: 0 };
    await waitFor(() => expect(offersCreate("Brand new")).toBe(false));
    // 他の列では、本文と同じく新規作成も出す
    editorHolder.cursor = { tableBlockId: TABLE_ID, rowIndex: 1, colIndex: 1 };
    expect(offersCreate("Brand new")).toBe(true);

    // note-link 列で既存ノートを選ぶ
    editorHolder.cursor = { tableBlockId: TABLE_ID, rowIndex: 1, colIndex: 0 };
    await act(async () => {
      await editorHolder.mention!.onMentionSelect!(TABLE_ID, {
        type: "note",
        id: "rich-note",
        label: "Rich",
        group: "",
      });
    });
    // セルの書き換えはメニューが片付いてから（少し遅れる）
    await waitFor(() =>
      expect(readCellText(editor.getBlock(TABLE_ID).content.rows[1].cells[0])).toBe("@Rich"),
    );

    const doc = await saveWithShortcut();
    const page = doc.pages[0];
    // 行アイコン層はこの注釈を見て、その行を「ノートを作成」ではなく「開く」にする
    expect(page.tableMeta[TABLE_ID].noteLinks).toEqual({ "@Rich": "rich-note" });
    // noteLinks・リンクはピークのノートに入る
    expect(doc.noteLinks).toEqual([
      { targetNoteId: "rich-note", sourceBlockId: TABLE_ID, type: "derived_from" },
    ]);
    const firstCell = page.blocks[0].content.rows[1].cells[0].content[0];
    expect(firstCell).toMatchObject({ text: "@Rich", styles: { textColor: "blue" } });
    // 打った列だけ書き換わる
    expect(readCellText(page.blocks[0].content.rows[1].cells[1])).toBe("");
    // reference リンクは打った行に紐づく（行の identity を控える）
    const link = [...page.provLinks, ...page.knowledgeLinks].find(
      (l: any) => l.targetNoteId === "rich-note",
    );
    expect(link).toMatchObject({
      sourceBlockId: TABLE_ID,
      type: "reference",
      sourceRowIdentity: firstCell.styles.tableRowIdentity,
    });
    expect(firstCell.styles.tableRowIdentity).toMatch(/^row_/);
    expect(onCreateLinkedNote).not.toHaveBeenCalled();
  });

  it("表の外で @ から既存ノートを選ぶと、@リンク・リンク・noteLinks をピークのノートに保存する", async () => {
    const { editor } = await renderPeek(vi.fn());
    const rich = { type: "note", id: "rich-note", label: "Rich", group: "" };

    // 本文の段落で @ を打って既存ノートを選ぶ（挿入はメニューが片付いてから）
    editorHolder.cursor = null;
    await act(async () => {
      await editorHolder.mention!.onMentionSelect!(BODY_ID, rich);
    });
    await waitFor(() => expect(editorBodyText(editor)).toBe("Body@Rich "));

    const doc = await saveWithShortcut();
    // グラフ・来歴の派生関係はピークのノートに入る（メインの @ と同じ）
    expect(doc.noteLinks).toEqual([
      { targetNoteId: "rich-note", sourceBlockId: BODY_ID, type: "derived_from" },
    ]);
    expect(bodyText(doc)).toBe("Body@Rich ");
    const page = doc.pages[0];
    const link = [...page.provLinks, ...page.knowledgeLinks].find((l: any) => l.targetNoteId === "rich-note");
    expect(link).toMatchObject({ sourceBlockId: BODY_ID, type: "reference" });
    // 表の外なので行の identity は付かない
    expect(link.sourceRowIdentity).toBeUndefined();

    // 同じノートをもう一度入れても、ノートからノートへの線は 1 本のまま
    await act(async () => {
      await editorHolder.mention!.onMentionSelect!(BODY_ID, rich);
    });
    await waitFor(() => expect(editorBodyText(editor)).toBe("Body@Rich @Rich "));
    const again = await saveWithShortcut();
    expect(again.noteLinks).toEqual(doc.noteLinks);
  });

  it("保存を待つ間に @ で入れたノートの noteLinks も、保存完了で消えずに次の保存に乗る", async () => {
    const { editor } = await renderPeek(vi.fn());

    // 1 回目の保存（⌘S）を止めておき、その間に @ で既存ノートを入れる
    let release!: () => void;
    saved.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    editBody(editor, "first");
    await saveWithShortcut();
    editorHolder.cursor = null;
    await act(async () => {
      await editorHolder.mention!.onMentionSelect!(BODY_ID, {
        type: "note",
        id: "rich-note",
        label: "Rich",
        group: "",
      });
    });
    await waitFor(() => expect(editorBodyText(editor)).toBe("first@Rich "));

    // 1 回目は @ の前に組んだ doc を書く。書き終えても、保存を待つ間に積んだ線は残る
    await act(async () => {
      release();
    });
    await waitFor(() => expect(saved.completed).toBe(1));
    expect(saved.docs[0].noteLinks).toBeUndefined();

    const doc = await saveWithShortcut();
    expect(doc.noteLinks).toEqual([
      { targetNoteId: "rich-note", sourceBlockId: BODY_ID, type: "derived_from" },
    ]);
    expect(bodyText(doc)).toBe("first@Rich ");
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
