// @vitest-environment jsdom
// 作業フォルダを選ぶ一覧のテスト

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { WorkdirSummary } from "@/lib/conversation/render";
import { ConversationWorkdirList } from "./ConversationWorkdirList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

function item(name: string, sessions: number, unattended: number, ownChars = 1234): WorkdirSummary {
  return {
    workdir: `/Users/example/${name}`,
    sessions,
    unattendedSessions: unattended,
    candidateSessions: 0,
    ownTurns: 1,
    ownChars,
    startedAt: "2026-03-04T12:00:00",
    endedAt: "2026-03-04T13:00:00",
  };
}

const ITEMS = [item("bakery-notes", 5, 0), item("curry-lab", 4, 3), item("spice-ledger", 2, 2, 0)];

function setup(selected: string[], items = ITEMS, status: "loading" | "ready" = "ready") {
  const onToggle = vi.fn();
  const onToggleAll = vi.fn();
  render(
    <LocaleProvider>
      <ConversationWorkdirList
        status={status}
        items={items}
        selected={new Set(selected)}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
      />
    </LocaleProvider>,
  );
  return { onToggle, onToggleAll };
}

describe("ConversationWorkdirList", () => {
  it("行を押すと onToggle に workdir が渡る", () => {
    const { onToggle } = setup([]);
    fireEvent.click(screen.getByText("bakery-notes"));
    expect(onToggle).toHaveBeenCalledWith("/Users/example/bakery-notes");
  });

  it("取り込む本数 = sessions − unattendedSessions を出す", () => {
    setup([]);
    // curry-lab は 4 本のうち 3 本が発言なし → 1 本
    expect(screen.getByText("Conversations: 1")).toBeTruthy();
    // 発言の量は bakery-notes と curry-lab の 2 行に出る（見本の字数が同じ）
    expect(screen.getAllByText("You wrote: 1,234 characters").length).toBe(2);
    expect(screen.getByText(/Not brought in: 3 with no message from you/)).toBeTruthy();
  });

  it("取り込む本数が 0 の行は無効で、「すべて選ぶ」の対象にしない", () => {
    const { onToggleAll } = setup([]);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // [0] すべて選ぶ, [1] bakery, [2] curry, [3] spice
    expect(boxes[3].disabled).toBe(true);
    expect(screen.getByText("No conversation here has a message from you")).toBeTruthy();
    fireEvent.click(boxes[0]);
    expect(onToggleAll).toHaveBeenCalledWith(true);
  });

  it("対象の行がすべて選ばれていれば「すべて選ぶ」は checked で、押すと外す", () => {
    const { onToggleAll } = setup(["/Users/example/bakery-notes", "/Users/example/curry-lab"]);
    const all = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    fireEvent.click(all);
    expect(onToggleAll).toHaveBeenCalledWith(false);
  });

  it("一部だけ選ぶと indeterminate になり、選んだ本数の 1 行が出る", () => {
    setup(["/Users/example/bakery-notes"]);
    const all = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    expect(screen.getByText("Bringing in 5 conversation(s) from 1 folder(s)")).toBeTruthy();
  });

  it("何も選んでいなければ案内を出す", () => {
    setup([]);
    expect(screen.getByText("Choose the folders to bring in")).toBeTruthy();
  });

  it("1 件も無ければ空の文と探した場所を出す", () => {
    setup([], []);
    expect(screen.getByText(/No Claude Code conversation records/)).toBeTruthy();
    expect(screen.getByText("Looked in: ~/.claude/projects")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("読み込み中は一覧を出さず、確認中の文を出す", () => {
    setup([], [], "loading");
    expect(screen.getByText("Looking through the conversation records…")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
