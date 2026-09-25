// @vitest-environment jsdom
// メインエディタのアンマウント時の書き出し（use-auto-save）。StrictMode で描画する（main.tsx と同じ）。
//
// 対象の不変条件:
// - 最後の入力から 3 秒以内にアンマウントされたら（ノートを切り替えた・一覧へ移った）、
//   未保存の編集を 1 回だけ書き出す。タイマーの保存は後から走らない
// - 書き出しはエディタが外される前に呼ばれ、本文を同期で読める（BlockNote は子の div の
//   ref の解除で外れる。親のレイアウト段階の後片付けはその前に走る）
// - ノートを key で作り直したとき、書き出す本文は切り替え前のノートのもの
// - StrictMode の試しのアンマウントでは書かない。その後も自動保存は生きている
// - 書き込み中の保存があれば、それが終わってから書く（古い保存が後から届いて巻き戻さない）
// - 保存が書かなかった（保存中で捨てた）編集は未保存のまま残り、アンマウント時に書き出す

import { StrictMode, useEffect, useRef, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useAutoSave, type AutoSaveHandler } from "./use-auto-save";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** BlockNote の代わり: 子の div の ref で付け外しされ、外れた後は本文を読めない */
class FakeEditor {
  mounted = false;
  private text: string;
  constructor(text: string) {
    this.text = text;
  }
  get document(): string {
    if (!this.mounted) throw new Error("外されたエディタの本文を読んだ");
    return this.text;
  }
  type(text: string) {
    this.text = text;
  }
}

type Written = { noteId: string; text: string; unmounting: boolean };

type Api = { editor: FakeEditor; markDirty: () => void; saveNow: () => void };

/** NoteEditorInner と同じ形: 保存先は開いたときのノートに固定し、アンマウント時は本文をその場で読む */
function Editor({
  noteId,
  initialText,
  apiRef,
  write,
  dirtyOnMount = false,
}: {
  noteId: string;
  initialText: string;
  apiRef: { current: Api | null };
  write: (w: Written) => Promise<boolean> | boolean;
  dirtyOnMount?: boolean;
}) {
  const editorRef = useRef<FakeEditor | null>(null);
  if (!editorRef.current) editorRef.current = new FakeEditor(initialText);
  const editor = editorRef.current;
  const pinnedNoteId = useRef(noteId).current;

  const handleSave: AutoSaveHandler = () =>
    write({ noteId: pinnedNoteId, text: editor.document, unmounting: false });
  const { markDirty, saveNow } = useAutoSave(handleSave, (ready) => {
    const captured = editor.document; // エディタが外される前に同期で読む
    void ready.then((ok) => {
      if (ok) void write({ noteId: pinnedNoteId, text: captured, unmounting: true });
    });
  });
  apiRef.current = { editor, markDirty, saveNow };

  // 開いた直後に変更扱いになる初期化（ラベルの復元など）
  useEffect(() => {
    if (dirtyOnMount) markDirty();
  }, [dirtyOnMount, markDirty]);

  return (
    <div>
      <div
        ref={(el) => {
          editor.mounted = !!el;
        }}
      />
    </div>
  );
}

function Strict({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe("useAutoSave: アンマウント時の書き出し（StrictMode）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(write: (w: Written) => Promise<boolean> | boolean = () => true) {
    const writes: Written[] = [];
    const apiRef: { current: Api | null } = { current: null };
    const writer = (w: Written) => {
      writes.push(w);
      return write(w);
    };
    const view = (noteId: string, text: string, dirtyOnMount = false) => (
      <Strict>
        <Editor key={noteId} noteId={noteId} initialText={text} apiRef={apiRef} write={writer} dirtyOnMount={dirtyOnMount} />
      </Strict>
    );
    return { writes, apiRef, view };
  }

  it("入力から 3 秒以内に別のノートへ切り替えると、切り替え前のノートへ入力を 1 回書き出す", async () => {
    const { writes, apiRef, view } = setup();
    const { rerender } = render(view("note-a", "A の本文"));
    await act(async () => {
      apiRef.current!.editor.type("A の本文（切替直前に編集）");
      apiRef.current!.markDirty();
      vi.advanceTimersByTime(1000);
    });

    await act(async () => {
      rerender(view("note-b", "B の本文"));
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(writes).toEqual([
      { noteId: "note-a", text: "A の本文（切替直前に編集）", unmounting: true },
    ]);
  });

  it("未保存が無ければアンマウントで書かない", async () => {
    const { writes, view } = setup();
    const { unmount } = render(view("note-a", "A"));
    await act(async () => {
      unmount();
      vi.advanceTimersByTime(10_000);
    });
    expect(writes).toEqual([]);
  });

  it("StrictMode の試しのアンマウントでは書かず、開いた直後の変更は 3 秒後に通常どおり保存する", async () => {
    const { writes, view } = setup();
    render(view("note-a", "A の本文", true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writes).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(writes).toEqual([{ noteId: "note-a", text: "A の本文", unmounting: false }]);
  });

  it("試しのアンマウントの後も、アンマウント時の書き出しは効く（フラグが戻っている）", async () => {
    const { writes, apiRef, view } = setup();
    const { unmount } = render(view("note-a", "A"));
    await act(async () => {
      apiRef.current!.editor.type("A 編集");
      apiRef.current!.markDirty();
    });
    await act(async () => {
      unmount();
    });
    expect(writes).toEqual([{ noteId: "note-a", text: "A 編集", unmounting: true }]);
  });

  it("書き込み中の保存が終わってから書き出す", async () => {
    let release!: () => void;
    const held = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
    let calls = 0;
    const { writes, apiRef, view } = setup(() => (++calls === 1 ? held : true));
    const { unmount } = render(view("note-a", "A"));
    await act(async () => {
      apiRef.current!.editor.type("A 1 回目");
      apiRef.current!.markDirty();
      vi.advanceTimersByTime(3000); // 1 回目の保存が始まり、書き込み中で止まる
    });
    await act(async () => {
      apiRef.current!.editor.type("A 2 回目");
      apiRef.current!.markDirty();
    });
    await act(async () => {
      unmount();
    });
    // まだ 1 回目が書き込み中なので、書き出しは待っている
    expect(writes.map((w) => w.text)).toEqual(["A 1 回目"]);

    await act(async () => {
      release();
      await held;
    });
    expect(writes.map((w) => [w.text, w.unmounting])).toEqual([
      ["A 1 回目", false],
      ["A 2 回目", true],
    ]);
  });

  it("保存が書かなかった（保存中で捨てた）編集は未保存のまま残り、アンマウント時に書き出す", async () => {
    const { writes, apiRef, view } = setup((w) => w.unmounting);
    const { unmount } = render(view("note-a", "A"));
    await act(async () => {
      apiRef.current!.editor.type("A 捨てられた保存");
      apiRef.current!.markDirty();
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      unmount();
    });
    expect(writes.map((w) => [w.text, w.unmounting])).toEqual([
      ["A 捨てられた保存", false],
      ["A 捨てられた保存", true],
    ]);
  });

  it("アンマウント後の markDirty / saveNow は保存を張らない", async () => {
    const { writes, apiRef, view } = setup();
    const { unmount } = render(view("note-a", "A"));
    const api = apiRef.current!;
    await act(async () => {
      unmount();
    });
    await act(async () => {
      api.markDirty();
      api.saveNow();
      vi.advanceTimersByTime(10_000);
    });
    expect(writes).toEqual([]);
  });
});

describe("useAutoSave: 開いたまま今すぐ書き出す口（takeUnsaved / restoreUnsaved）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("未保存を受け取るとタイマーは止まり、書けなかったら未保存に戻してアンマウント時に書き出す", async () => {
    const saves: string[] = [];
    const flushes: string[] = [];
    let api!: ReturnType<typeof useAutoSave>;
    function Probe() {
      api = useAutoSave(
        () => {
          saves.push("timer");
        },
        (ready) => {
          void ready.then((ok) => {
            if (ok) flushes.push("unmount");
          });
        },
      );
      return null;
    }
    const { unmount } = render(<Strict><Probe /></Strict>);

    expect(api.takeUnsaved()).toBeNull();
    await act(async () => {
      api.markDirty();
    });
    expect(api.hasUnsaved()).toBe(true);
    let ready: Promise<boolean> | null = null;
    await act(async () => {
      ready = api.takeUnsaved();
    });
    expect(ready).not.toBeNull();
    expect(await ready!).toBe(true);
    expect(api.hasUnsaved()).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(saves).toEqual([]); // 受け取った分をタイマーが二重に書かない

    // 受け取った書き出しが失敗 → 未保存に戻す → アンマウントで書き出す
    await act(async () => {
      api.restoreUnsaved();
    });
    expect(api.hasUnsaved()).toBe(true);
    await act(async () => {
      unmount();
    });
    expect(flushes).toEqual(["unmount"]);
  });
});
