// @vitest-environment jsdom
// 一覧の行の計画の印: 種類が計画のノートにだけ出る（v0.154.0 でフォルダの名前では分からなくなったため）
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { NoteListView } from "./NoteListView";
import type { GraphiumIndex, NoteIndexEntry } from "./index-file";

afterEach(cleanup);

const at = new Date().toISOString();
function entry(noteId: string, title: string, extra: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return { noteId, title, modifiedAt: at, createdAt: at, headings: [], labels: [], outgoingLinks: [], ...extra };
}

function rowOf(container: HTMLElement, title: string): HTMLElement {
  const cell = [...container.querySelectorAll("td")].find((td) => td.textContent?.includes(title));
  if (!cell) throw new Error(`row not found: ${title}`);
  return cell;
}

describe("一覧の計画の印", () => {
  it("kind が plan のノートにだけ印が出る", async () => {
    const index: GraphiumIndex = {
      version: 1,
      updatedAt: at,
      notes: [
        entry("p", "焼結条件を詰める", { kind: "plan" }),
        entry("n", "焼成 1 回目", { kind: "note" }),
        // 種類を持たない旧ノートは、旧「計画」フォルダにあれば計画として読む
        entry("legacy", "旧い計画", { noteContexts: ["計画"] }),
      ],
    };
    const { container } = render(
      <LocaleProvider><NoteListView noteIndex={index} onOpenNote={() => {}} onBack={() => {}} /></LocaleProvider>,
    );
    // 一覧は索引を非同期に読み込んでから行を描く
    await screen.findByText("焼結条件を詰める");
    expect(rowOf(container, "焼結条件を詰める").querySelector('[data-testid="note-list-plan-mark"]')).not.toBeNull();
    expect(rowOf(container, "焼成 1 回目").querySelector('[data-testid="note-list-plan-mark"]')).toBeNull();
    expect(rowOf(container, "旧い計画").querySelector('[data-testid="note-list-plan-mark"]')).not.toBeNull();
  });
});
