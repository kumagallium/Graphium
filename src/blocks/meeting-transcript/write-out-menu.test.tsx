// @vitest-environment jsdom
// 「書き出す ▾」: 1 段目で何を（文字起こし → 清書 → 要約）、2 段目でどこへ

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { syncLocale, t } from "../../i18n";
import { WriteOutMenu } from "./artifact-panels";

afterEach(() => cleanup());

const name = (key: string) => new RegExp(t(key).replace(/[()（）.]/g, "."));

describe("WriteOutMenu", () => {
  syncLocale("ja");
  const open = (props: Partial<Parameters<typeof WriteOutMenu>[0]> = {}) => {
    const onPick = vi.fn();
    render(<WriteOutMenu canTranscript canCleanup canSummary={false} canMinutes onPick={onPick} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.writeOut") }));
    return onPick;
  };

  it("1 段目は 文字起こし → 清書 → 要約 の順。選べないものは理由を出して 2 段目を開かない", () => {
    open();
    const items = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(items[0]).toContain(t("meetingBlock.writeOutTranscript"));
    expect(items[1]).toContain(t("meetingBlock.writeOutCleanup"));
    expect(items[2]).toContain(t("meetingBlock.writeOutSummaryNone"));
    fireEvent.click(screen.getByRole("menuitem", { name: name("meetingBlock.writeOutSummary") }));
    expect(screen.queryByRole("menuitem", { name: t("meetingBlock.writeOutToNote") })).toBeNull();
  });

  it("2 段目で行き先を選ぶ（このノート・新しいノート・Markdown・テキスト）", () => {
    const onPick = open();
    fireEvent.click(screen.getByRole("menuitem", { name: name("meetingBlock.writeOutCleanup") }));
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(
      expect.arrayContaining([
        t("meetingBlock.writeOutToNote"),
        t("meetingBlock.writeOutToNewNote"),
        t("meetingBlock.writeOutMarkdown"),
        t("meetingBlock.writeOutText"),
      ]),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: t("meetingBlock.writeOutMarkdown") }));
    expect(onPick).toHaveBeenCalledWith("cleanup", "markdown");
  });

  it("→ で 2 段目を開いてその先頭へ、← で 1 段目に戻る", () => {
    open();
    const transcript = screen.getByRole("menuitem", { name: name("meetingBlock.writeOutTranscript") });
    fireEvent.keyDown(transcript, { key: "ArrowRight" });
    const toNote = screen.getByRole("menuitem", { name: t("meetingBlock.writeOutToNote") });
    expect(document.activeElement).toBe(toNote);
    fireEvent.keyDown(toNote, { key: "ArrowLeft" });
    expect(screen.queryByRole("menuitem", { name: t("meetingBlock.writeOutToNote") })).toBeNull();
    expect(document.activeElement).toBe(transcript);
  });

  it("AI を使わないときは文字起こしだけ、別のノートに書けないときは新しいノートを出さない", () => {
    open({ aiItems: false, canMinutes: false });
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("menuitem", { name: name("meetingBlock.writeOutTranscript") }));
    expect(screen.queryByRole("menuitem", { name: t("meetingBlock.writeOutToNewNote") })).toBeNull();
  });
});
