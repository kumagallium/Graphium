// @vitest-environment jsdom
// 共有ノートの全画面表示のテスト。
//
// 対象の不変条件:
// - 開いた直後はコメントのパネルが出ている（読んですぐ返せる状態で始まる）
// - 右レールのアイコンでパネルを切り替えられる / 同じアイコンで閉じられる
// - 本文の段落をクリックすると詳細パネル（サイドピーク）と同じ強調が付き、
//   コメントの入力欄に「この段落に」が出る（部品を共有していることの確認）
// - パンくずの「ライブラリ」で一覧へ戻れる
// - 開いた時点で既読（graphium-shared-seen）を記録する ＝ 一覧の印が消える

import { describe, it, expect, afterEach, vi } from "vitest";

// 本文は SharedEntryBody 経由でブロック registry を読み込む。pdf ビューアは
// jsdom に無い API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
// BlockNote 実体は jsdom で描けないので、ブロックの外枠だけを持つ偽エディタに差し替える。
// 段落の指定はこの外枠（data-id + data-node-type="blockOuter"）を起点にしている
// StepFlowView 実体は ELK / measure を伴い jsdom で動かせないので、マウント回数だけ
// 数える偽物に差し替える（key で作り直しているかを確認するため）
const stepFlow = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("../network-graph/step-flow-view", async () => {
  const { useEffect } = await import("react");
  return {
    StepFlowView: ({ graph }: { graph: { steps: unknown[] } }) => {
      useEffect(() => {
        stepFlow.mounts += 1;
      }, []);
      return <div data-testid="step-flow-mock">{graph.steps.length}</div>;
    },
  };
});
vi.mock("../../base/editor", () => ({
  SandboxEditor: ({ initialContent }: { initialContent: any[] }) => (
    <div>
      {initialContent.map((b) => (
        <div key={b.id} data-id={b.id} data-node-type="blockOuter">
          {b.content?.[0]?.text ?? ""}
        </div>
      ))}
    </div>
  ),
}));

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedNoteView } from "./SharedNoteView";
import { createEmptySharedProjection, projectSharedNote } from "./shared-projection";
import { SHARED_SEEN_KEY, parseSeenStore } from "./shared-seen";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };

const NOTE: SharedEntry = {
  id: "note-1",
  type: "note",
  author: { name: "佐藤 学生", email: "sato@example.ac.jp" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  hash: "sha256:aaa",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結の記録" },
} as SharedEntry;

const DOC: GraphiumDocument = {
  version: 6,
  title: "焼結の記録",
  pages: [
    {
      id: "p1",
      title: "焼結の記録",
      blocks: [
        {
          id: "b-weigh",
          type: "paragraph",
          content: [{ type: "text", text: "Cu 粉末を秤量した", styles: {} }],
          children: [],
        },
        {
          id: "b-sinter",
          type: "paragraph",
          content: [{ type: "text", text: "1050 ℃ で 2 時間保持した", styles: {} }],
          children: [],
        },
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

const NOOP_ASYNC = async () => {};

function viewElement(overrides: Partial<React.ComponentProps<typeof SharedNoteView>> = {}) {
  return (
    <LocaleProvider>
      <SharedNoteView
        entry={NOTE}
        currentIdentity={TEACHER}
        sharedRoot="/tmp/shared-root"
        onBack={() => {}}
        onForkNote={NOOP_ASYNC}
        onForkKnowledge={NOOP_ASYNC}
        onUnshare={NOOP_ASYNC}
        entries={[]}
        projection={createEmptySharedProjection()}
        readEntryBody={async () => ({
          body: new TextEncoder().encode(JSON.stringify(DOC)),
          verified: true,
        })}
        {...overrides}
      />
    </LocaleProvider>
  );
}

function renderView(overrides: Partial<React.ComponentProps<typeof SharedNoteView>> = {}) {
  return render(viewElement(overrides));
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** 手順ブロックだけを持つ本文（プロセスのパネル用） */
function stepDoc(steps: { id: string; text: string }[]): GraphiumDocument {
  return {
    version: 6,
    title: "焼結の記録",
    pages: [
      {
        id: "p1",
        title: "焼結の記録",
        blocks: steps.map((s) => ({
          id: s.id,
          type: "step",
          props: {},
          content: [{ type: "text", text: s.text, styles: {} }],
          children: [],
        })),
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  } as any;
}

/** プレビュー用に差し込まれた動的 <style> の中身（無ければ空文字） */
function highlightCss(): string {
  return Array.from(document.head.querySelectorAll("style[data-shared-preview-highlight]"))
    .map((el) => el.textContent ?? "")
    .join("\n");
}

afterEach(() => {
  cleanup();
  stepFlow.mounts = 0;
  document.head.querySelectorAll("style[data-shared-preview-highlight]").forEach((el) => el.remove());
  localStorage.clear();
});

describe("SharedNoteView の右レール", () => {
  it("開いた直後はコメントのパネルが出ている", async () => {
    renderView();
    await screen.findByText("1050 ℃ で 2 時間保持した");

    expect(screen.getByTestId("shared-note-panel-comments")).toBeTruthy();
    expect(screen.getByPlaceholderText(t("comment.composerPlaceholder"))).toBeTruthy();
  });

  it("アイコンでパネルを切り替えられ、同じアイコンで閉じられる", async () => {
    renderView();
    await screen.findByText("1050 ℃ で 2 時間保持した");

    // 版: メタ（ID / 作成日 / 更新日 / ハッシュ）と履歴
    fireEvent.click(screen.getByTestId("shared-note-rail-version"));
    expect(screen.getByTestId("shared-note-panel-version")).toBeTruthy();
    expect(screen.getByText(t("library.detail.id"))).toBeTruthy();
    expect(screen.queryByTestId("shared-note-panel-comments")).toBeNull();

    // プロセス: 投影に手順が無ければ「手順はありません」
    fireEvent.click(screen.getByTestId("shared-note-rail-process"));
    expect(screen.getByText(t("sharedNote.processEmpty"))).toBeTruthy();

    // 逆引き: 0 件でも「無い」と断言しない案内を出す
    fireEvent.click(screen.getByTestId("shared-note-rail-links"));
    expect(screen.getByText(t("sharedNote.backlinksEmpty"))).toBeTruthy();

    // 同じアイコンをもう一度 = 閉じる（本文を広く読む）
    fireEvent.click(screen.getByTestId("shared-note-rail-links"));
    expect(screen.queryByTestId("shared-note-panel-links")).toBeNull();
  });
});

describe("SharedNoteView の段落コメント", () => {
  it("段落をクリックすると強調が付き、入力欄に「この段落に」が出る", async () => {
    renderView();
    const block = await screen.findByText("1050 ℃ で 2 時間保持した");

    // 押せることが分かるよう、本文には常時 cursor が付く（詳細パネルと同じ）
    expect(highlightCss()).toContain("cursor: pointer");

    fireEvent.click(block);

    const css = highlightCss();
    expect(css).toContain('[data-id="b-sinter"][data-node-type="blockOuter"]');
    expect(css).toContain("background: rgba(59, 130, 246, 0.08)");
    expect(css).not.toContain('data-id="b-weigh"');
    expect(screen.getByText(t("comment.anchorPrefix"))).toBeTruthy();

    // もう一度クリックで指定を外す
    fireEvent.click(block);
    expect(highlightCss()).not.toContain('data-id="b-sinter"');
    expect(screen.queryByText(t("comment.anchorPrefix"))).toBeNull();
  });
});

describe("SharedNoteView の戻る・既読", () => {
  it("パンくずの「ライブラリ」で一覧へ戻る", async () => {
    const onBack = vi.fn();
    renderView({ onBack });
    await screen.findByText("1050 ℃ で 2 時間保持した");

    fireEvent.click(screen.getByText(t("sidebar.library")));
    expect(onBack).toHaveBeenCalled();
  });

  it("開いた時点で既読（hash とコメント数）を控える", async () => {
    const onSeenRecorded = vi.fn();
    renderView({ onSeenRecorded });
    await screen.findByText("1050 ℃ で 2 時間保持した");

    const seen = parseSeenStore(localStorage.getItem(SHARED_SEEN_KEY));
    expect(seen["note-1"]?.hash).toBe("sha256:aaa");
    expect(seen["note-1"]?.comments).toBe(0);
    expect(onSeenRecorded).toHaveBeenCalled();
  });
});

describe("SharedNoteView のプロセス", () => {
  it("共有ノートが更新されたらフローを作り直す（新旧ノードの混在を防ぐ）", async () => {
    const v1 = stepDoc([
      { id: "s1", text: "圧粉" },
      { id: "s2", text: "焼結" },
    ]);
    const p1 = createEmptySharedProjection();
    p1.entries[NOTE.id] = projectSharedNote(NOTE, v1);
    const args = {
      initialRailTab: "process" as const,
      projection: p1,
      readEntryBody: async () => ({ body: encode(v1), verified: true }),
    };

    const { rerender } = render(viewElement(args));
    await screen.findByTestId("step-flow-mock");
    expect(stepFlow.mounts).toBe(1);

    // 中身が同じうちは作り直さない（レイアウト計算をやり直させない）
    rerender(viewElement(args));
    expect(stepFlow.mounts).toBe(1);

    // 同じ id のまま手順構成が入れ替わったら作り直す
    const updated = { ...NOTE, hash: "sha256:bbb", updated_at: "2026-08-25T00:00:00.000Z" } as SharedEntry;
    const v2 = stepDoc([
      { id: "s3", text: "混合" },
      { id: "s4", text: "成形" },
      { id: "s5", text: "焼結" },
    ]);
    const p2 = createEmptySharedProjection();
    p2.entries[updated.id] = projectSharedNote(updated, v2);
    rerender(
      viewElement({
        ...args,
        entry: updated,
        projection: p2,
        readEntryBody: async () => ({ body: encode(v2), verified: true }),
      }),
    );
    expect(stepFlow.mounts).toBe(2);
  });
});

describe("SharedNoteView の余白・トーン（個人のノートとの揃え）", () => {
  it("本文カラムの内側に余分な余白を足さない（左右の余白は箱の外側で取る）", async () => {
    renderView();
    await screen.findByText("1050 ℃ で 2 時間保持した");

    // 828px = 本文テキスト 720px + .bn-editor の padding-inline 54px×2。
    // 箱の内側に px を足すと本文だけが個人のノートより狭くなる
    const column = screen.getByTestId("shared-note-body");
    expect(column.className).toContain("max-w-[828px]");
    expect(column.className).not.toMatch(/(?:^|\s)px-/);
    expect(column.parentElement?.className).toContain("px-6");
  });

  it("右パネルの背景は個人のノートの右パネルと同じトーン", async () => {
    renderView();
    await screen.findByText("1050 ℃ で 2 時間保持した");

    const panel = screen.getByTestId("shared-note-panel-comments");
    expect(panel.className).toContain("bg-muted");
  });
});
