// @vitest-environment jsdom
// 取り込み完了画面の「次に」のボタンのテスト
//
// 対象の不変条件:
// - 取り込んだものが 1 件なら、主ボタンは「開く」で、押すとその 1 件が渡る
// - 1 件のときは探す・つながりを出さない（入れたばかりの 1 件には用が無い）
// - 登録済みの素材を入れ直しても、初回と同じボタンが出る（ナレッジ化が消えない）
// - 複数なら、AI があれば主ボタンは「まとめてナレッジ化」で、登録済みも対象に含む

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { IntakeModal, singleIntakeTarget, type IntakeState } from "./IntakeModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

type DoneState = Extract<IntakeState, { kind: "done" }>;

function doneState(over: Partial<DoneState> = {}): DoneState {
  return {
    kind: "done",
    notes: 0,
    notesExisting: 0,
    materials: 0,
    materialsExisting: 0,
    linksResolved: 0,
    linksUnresolved: 0,
    failed: [],
    skipped: 0,
    skippedByExt: {},
    folders: 0,
    createdNoteIds: [],
    mediaFileIds: [],
    ocrPending: 0,
    officeDerived: 0,
    officeSkipped: 0,
    aiAvailable: true,
    ...over,
  };
}

function renderDone(state: DoneState) {
  const handlers = {
    onOpen: vi.fn(),
    onIngestAll: vi.fn(),
    onSearch: vi.fn(),
    onShowGraph: vi.fn(),
    onAskAi: vi.fn(),
    onSetupAi: vi.fn(),
  };
  const utils = render(
    <LocaleProvider>
      <IntakeModal open onClose={() => {}} onFilesSelected={() => {}} state={state} {...handlers} />
    </LocaleProvider>,
  );
  return { ...utils, ...handlers };
}

/** モーダル内のボタンの文言を、画面に並んだ順で返す（主ボタンが先頭に来るかを見る） */
function buttonLabels(container: HTMLElement): string[] {
  return Array.from(container.ownerDocument.querySelectorAll("[role='dialog'] button, .fixed button"))
    .map((b) => b.textContent?.trim() ?? "")
    .filter((s) => s.length > 0);
}

describe("singleIntakeTarget", () => {
  it("素材がちょうど 1 件ならその素材", () => {
    expect(singleIntakeTarget({ createdNoteIds: [], notesExisting: 0, mediaFileIds: ["f1"] })).toEqual({
      kind: "media",
      id: "f1",
    });
  });
  it("ノートがちょうど 1 件ならそのノート", () => {
    expect(singleIntakeTarget({ createdNoteIds: ["n1"], notesExisting: 0, mediaFileIds: [] })).toEqual({
      kind: "note",
      id: "n1",
    });
  });
  it("2 件以上・既存ノートだけ・0 件なら null", () => {
    expect(singleIntakeTarget({ createdNoteIds: ["n1"], notesExisting: 0, mediaFileIds: ["f1"] })).toBeNull();
    expect(singleIntakeTarget({ createdNoteIds: [], notesExisting: 1, mediaFileIds: [] })).toBeNull();
    expect(singleIntakeTarget({ createdNoteIds: [], notesExisting: 0, mediaFileIds: [] })).toBeNull();
  });
});

describe("IntakeModal の完了画面", () => {
  it("PDF 1 本: 主ボタンは「開く」で、押すとその素材が渡る。探す・つながりは出さない", () => {
    const { getByRole, queryByRole, onOpen } = renderDone(doneState({ materials: 1, mediaFileIds: ["pdf-1"] }));
    fireEvent.click(getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "media", id: "pdf-1" });
    expect(queryByRole("button", { name: "Search your notes" })).toBeNull();
    expect(queryByRole("button", { name: "See connections" })).toBeNull();
  });

  it("登録済みの PDF を入れ直しても「開く」と「ナレッジ化」が出る", () => {
    const { getByRole, onIngestAll } = renderDone(
      doneState({ materials: 1, materialsExisting: 1, mediaFileIds: ["pdf-1"] }),
    );
    expect(getByRole("button", { name: "Open" })).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Add to knowledge" }));
    expect(onIngestAll).toHaveBeenCalledWith([], ["pdf-1"]);
  });

  it("1 件でも AI 未設定なら、ナレッジ化は出さず「AI を設定する」に任せる", () => {
    const { getByRole, queryByRole } = renderDone(
      doneState({ materials: 1, mediaFileIds: ["pdf-1"], aiAvailable: false }),
    );
    expect(getByRole("button", { name: "Open" })).toBeTruthy();
    expect(queryByRole("button", { name: "Add to knowledge" })).toBeNull();
    expect(getByRole("button", { name: "Set up AI" })).toBeTruthy();
  });

  it("複数: 主ボタンは「まとめてナレッジ化」で先頭に来て、登録済みの素材も対象に含む", () => {
    const { getByRole, queryByRole, onIngestAll, container } = renderDone(
      doneState({
        notes: 2,
        materials: 3,
        materialsExisting: 1,
        createdNoteIds: ["n1", "n2"],
        mediaFileIds: ["f1", "f2", "f-existing"],
      }),
    );
    expect(queryByRole("button", { name: "Open" })).toBeNull();
    const labels = buttonLabels(container);
    expect(labels.indexOf("Add all to knowledge")).toBeLessThan(labels.indexOf("Search your notes"));
    fireEvent.click(getByRole("button", { name: "Add all to knowledge" }));
    expect(onIngestAll).toHaveBeenCalledWith(["n1", "n2"], ["f1", "f2", "f-existing"]);
  });
});

describe("IntakeModal の AI との会話の区画", () => {
  type Conv = NonNullable<React.ComponentProps<typeof IntakeModal>["conversation"]>;
  function conv(state: Conv["state"], section: Conv["section"] = "conversations"): Conv {
    return {
      state,
      section,
      onSectionChange: vi.fn(),
      onToggle: vi.fn(),
      onToggleAll: vi.fn(),
      onImport: vi.fn(),
      onRetry: vi.fn(),
      onViewMaterials: vi.fn(),
    };
  }
  function renderIdle(conversation?: Conv) {
    return render(
      <LocaleProvider>
        <IntakeModal open onClose={() => {}} onFilesSelected={() => {}} state={{ kind: "idle" }} conversation={conversation} />
      </LocaleProvider>,
    );
  }
  const ITEM = {
    workdir: "/Users/example/bakery-notes",
    sessions: 3,
    unattendedSessions: 0,
    candidateSessions: 1,
    ownTurns: 10,
    ownChars: 1200,
    startedAt: "2026-03-04T09:12:00",
    endedAt: "2026-03-05T09:12:00",
    sessionRefs: [{ dirName: "d", fileName: "a.jsonl" }],
  };

  it("conversation を渡さないとタブが出ない", () => {
    renderIdle();
    expect(document.querySelector("[role='tablist']")).toBeNull();
  });

  it("渡すとタブが出る", () => {
    renderIdle(conv({ kind: "idle" }, "files"));
    expect(document.querySelector("[role='tablist']")).not.toBeNull();
  });

  it("ready で何も選んでいないと「取り込む」が押せない", () => {
    renderIdle(conv({ kind: "ready", items: [ITEM], selected: new Set(), searchedPath: "~/x" }));
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Bring in");
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("unavailable で 1 行が出る", () => {
    renderIdle(conv({ kind: "unavailable" }));
    expect(document.body.textContent).toContain("desktop app");
  });

  it("done で 4 行と「素材で見る」が出て、「まとめてナレッジ化」は出ない", () => {
    const c = conv({ kind: "done", created: 2, updated: 1, unchanged: 0, failed: 1 });
    renderIdle(c);
    expect(document.querySelectorAll("dl > div")).toHaveLength(4);
    const labels = Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(labels).toContain("See them in Materials");
    expect(document.body.textContent).not.toContain("knowledge");
    expect(document.body.textContent).not.toContain("まとめてナレッジ化");
  });
});
