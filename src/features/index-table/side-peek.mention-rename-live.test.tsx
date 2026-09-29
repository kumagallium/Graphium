// @vitest-environment jsdom
// mention-live（追記分）: 開いた直後でまだ準備ができていない（エディタの実体が無い）
// サイドピークに改名が届いた場合の取りこぼし対策。
//
// 対象の不変条件:
// - 準備ができる前（エディタの実体がまだ無い）に口（applyMentionRename）を呼ぶと false
//   を返し、覚えておく（呼び出し側はファイルを直接書き換える）
// - 準備ができた（エディタが実体化した）時点で、覚えていた改名を自動でエディタに当てる。
//   当てるとそのピークは未保存になる
// - そのあと保存すると、ファイルに書かれる本文のラベルが新しいタイトルになる

import { StrictMode, type ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

// pdf ビューアは jsdom に無い API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

// BlockNote 実体は jsdom で描けないので偽エディタに差し替える。mountDelayMs を挟んで
// onEditorReady を遅らせ、「準備ができる前」の窓を作る（side-peek.main-open.test.tsx と
// 同じ構造。updateBlock は本物同様 document を書き換えて onChange を発火する）
type FakeEditorEntry = { editor: { document: any[] }; onChange?: () => void };
// readySync: true にすると、エディタの実体を setTimeout を挟まずマウントの effect 内で
// 即時に通知する（本物の onEditorReady と同じ、editor 実体はレンダー本体で作る plain
// useEffect）。doc の読み込み（loadFile）側をわざと遅らせる（storage.loadDelayMs）ことで、
// 「エディタの実体が先にでき、リンクの復元（doc effect）が後から終わる」という、
// mountDelayMs だけでは作れない逆順を再現するために使う
const editors = vi.hoisted(() => ({ list: [] as FakeEditorEntry[], mountDelayMs: 0, readySync: false }));
vi.mock("../../base/editor", async () => {
  const { useEffect, useRef } = await import("react");
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
      // 本物の BlockNote と同じく、editor 実体はレンダー本体で 1 度だけ作る（StrictMode の
      // 二重 effect 実行があっても作り直さない）。onEditorReady は「実体ができたことの
      // 通知」のみを担う passive effect（本物の src/base/editor.tsx と同じ形）
      const editorObjRef = useRef<{ document: any[]; domElement: HTMLDivElement; getBlock: any; updateBlock: any } | null>(null);
      if (!editorObjRef.current) {
        const editor = {
          document: initialContent ?? [],
          domElement: document.createElement("div"),
          getBlock: (id: string) => editor.document.find((b: any) => b.id === id) ?? null,
          updateBlock: (block: { id: string }, update: { content: unknown }) => {
            editor.document = editor.document.map((b: any) =>
              b.id === block.id ? { ...b, content: update.content } : b,
            );
            onChange?.();
          },
        };
        editorObjRef.current = editor;
      }
      const notify = () => {
        editors.list.push({ editor: editorObjRef.current!, onChange });
        onEditorReady?.(editorObjRef.current);
      };
      useEffect(() => {
        if (editors.readySync) {
          notify();
          return;
        }
        const timer = setTimeout(notify, editors.mountDelayMs);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="fake-editor" />;
    },
  };
});

// 保存先（provider）はメモリ上の偽物
const storage = vi.hoisted(() => ({
  files: new Map<string, any>(),
  saves: [] as any[],
  loadDelayMs: 0,
}));
vi.mock("../../lib/storage/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage/registry")>();
  return {
    ...actual,
    getActiveProvider: () => ({
      loadFile: async (id: string) => {
        if (storage.loadDelayMs > 0) {
          await new Promise((r) => setTimeout(r, storage.loadDelayMs));
        }
        return structuredClone(storage.files.get(id));
      },
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
import { applyLiveMentionRename } from "../../lib/peek-save-queue";
import { pendingPeekSave } from "../../lib/peek-save-queue";
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

function blueMention(label: string) {
  return { type: "text", text: `@${label}`, styles: { textColor: "blue" } };
}

function docWithMention(label: string): GraphiumDocument {
  return {
    version: 6,
    title: "参照元ノート",
    pages: [
      {
        id: "p1",
        title: "参照元ノート",
        blocks: [
          { id: "b1", type: "paragraph", props: {}, content: [blueMention(label)], children: [] },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [
          {
            id: "l1",
            sourceBlockId: "b1",
            targetBlockId: "",
            type: "reference",
            layer: "knowledge",
            createdBy: "human",
            targetNoteId: "target-note",
          },
        ],
      },
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
  await waitFor(() => expect(pendingPeekSave("r1")).toBeNull());
  editors.list = [];
  editors.mountDelayMs = 0;
  editors.readySync = false;
  storage.files.clear();
  storage.saves = [];
  storage.loadDelayMs = 0;
});

describe("SidePeek: mention-live（準備待ちの改名）", () => {
  it("エディタの実体ができる前に口を呼ぶと false（改名は覚えるだけで、エディタには触らない）", async () => {
    editors.mountDelayMs = 30;
    const doc = docWithMention("旧タイトル");
    storage.files.set("r1", doc);
    render(
      <SidePeek noteId="r1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );

    // まだエディタの実体が無いはず（mountDelayMs 経過前）
    expect(editors.list.length).toBe(0);
    const applied = applyLiveMentionRename("r1", "target-note", "旧タイトル", "新タイトル", false);
    expect(applied).toBe(false);
    expect(editors.list.length).toBe(0);

    // 準備ができた時点で、覚えていた改名が自動で当たる
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await waitFor(() => {
      const entry = editors.list[editors.list.length - 1];
      expect((entry.editor.document[0].content as any[])[0].text).toBe("@新タイトル");
    });
  });

  it("準備ができてから当てた改名は、そのピークを未保存にする。保存するとファイルのラベルが新しい", async () => {
    editors.mountDelayMs = 30;
    const doc = docWithMention("旧タイトル");
    storage.files.set("r1", doc);
    const { container } = render(
      <SidePeek noteId="r1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );

    applyLiveMentionRename("r1", "target-note", "旧タイトル", "新タイトル", false);
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await waitFor(() => expect(container.textContent).toContain("Unsaved"));

    await pressSave(container);
    await waitFor(() => expect(storage.saves).toHaveLength(1));
    const savedLabel = (storage.saves[0].pages[0].blocks[0].content[0] as any).text;
    expect(savedLabel).toBe("@新タイトル");
  });

  it("準備ができている（エディタの実体が既にある）ときは、今までどおりその場で当たる", async () => {
    editors.mountDelayMs = 0;
    const doc = docWithMention("旧タイトル");
    storage.files.set("r1", doc);
    render(
      <SidePeek noteId="r1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    // リンクの復元 effect が一巡するのを待つ（no-write-on-open と同じ作法）
    await act(async () => {
      await Promise.resolve();
    });

    const applied = applyLiveMentionRename("r1", "target-note", "旧タイトル", "新タイトル", false);
    expect(applied).toBe(true);
    const entry = editors.list[editors.list.length - 1];
    expect((entry.editor.document[0].content as any[])[0].text).toBe("@新タイトル");
  });

  it("エディタの実体がリンクの復元と同じコミットで先にできても、覚えていた改名を取りこぼさない（順序が逆でも当たる）", async () => {
    // SandboxEditor は本物同様、setTimeout を挟まず effect 内で同期的に実体化させる
    // （readySync）。doc がまだ読み込み中の間はエディタは存在しない（SandboxEditor は
    // !loading && doc の分岐でのみ描画される）ので、cachedDoc を渡さず loadFile を
    // 経由させる。doc が読めた瞬間の 1 コミットの中で、子（SandboxEditor の実体化）→
    // 親（restore-links effect）の順に走る本番の実効ぶりを再現する
    editors.readySync = true;
    const doc = docWithMention("旧タイトル");
    storage.files.set("r1", doc);
    render(
      <SidePeek noteId="r1" onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );

    // まだ doc の読み込み中（loadFile はマイクロタスク経由）なので、エディタは存在しない。
    // この時点で口を呼んでも false（覚えるだけ）
    expect(editors.list.length).toBe(0);
    const applied = applyLiveMentionRename("r1", "target-note", "旧タイトル", "新タイトル", false);
    expect(applied).toBe(false);

    // doc の読み込みが終わると、同じコミットの中で SandboxEditor（子）が先に実体化し、
    // そのあと restore-links effect（親）が editorRef.current の分岐から覚えていた改名を
    // 自動で当てる（handleEditorReady 側では、この時点ではまだリンク復元が済んでいないため
    // 当てない — そちらの分岐は使われない）
    await waitFor(() => {
      expect(editors.list.length).toBeGreaterThan(0);
      const entry = editors.list[editors.list.length - 1];
      expect((entry.editor.document[0].content as any[])[0].text).toBe("@新タイトル");
    });
  });

  it("保存を1回終えたピークにも、その後の改名がその場で当たる（保存後も ready が保たれる）", async () => {
    editors.mountDelayMs = 0;
    const doc = docWithMention("旧タイトル");
    storage.files.set("r1", doc);
    const { container } = render(
      <SidePeek noteId="r1" cachedDoc={doc} onClose={() => {}} onNavigate={() => {}} inline />,
      { wrapper: Wrap },
    );
    await waitFor(() => expect(editors.list.length).toBeGreaterThan(0));
    await act(async () => {
      await Promise.resolve();
    });

    // 1 回目の改名を当ててから保存する（doSave が docRef.current を新しい pages を
    // 持つ doc に置き換える）
    expect(applyLiveMentionRename("r1", "target-note", "旧タイトル", "新タイトル1", false)).toBe(true);
    await pressSave(container);
    await waitFor(() => expect(storage.saves).toHaveLength(1));

    // 保存後の 2 回目の改名も、ready のまま その場で当たる（restoredPagesRef の
    // pages 参照比較に戻すと、保存で pages の参照が入れ替わり、ここが false に戻ってしまう）
    const applied = applyLiveMentionRename("r1", "target-note", "新タイトル1", "新タイトル2", false);
    expect(applied).toBe(true);
    const entry = editors.list[editors.list.length - 1];
    expect((entry.editor.document[0].content as any[])[0].text).toBe("@新タイトル2");
  });
});
