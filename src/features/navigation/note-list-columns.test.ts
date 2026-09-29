// ノート一覧・ナレッジ一覧の列計画（幅と隠す順）のテスト
import { describe, expect, it } from "vitest";
import { requiredWidth, resolveHiddenCount, tableMinWidth } from "../../lib/responsive-columns";
import {
  NOTE_LIST_COLUMN_WIDTH as W,
  NOTE_LIST_TITLE_MIN_WIDTH,
  buildNoteListColumnPlan,
  type NoteListHideableColumn,
} from "./note-list-columns";
import { buildWikiListColumnPlan } from "../wiki/wiki-list-columns";

const FULL = { hasCheckbox: true, hasActions: true, hasLabels: true } as const;

function hiddenAt(width: number, opts: Parameters<typeof buildNoteListColumnPlan>[0]): string[] {
  const plan = buildNoteListColumnPlan(opts);
  return plan.hideable.slice(0, resolveHiddenCount(width, plan)).map((c) => c.key);
}

describe("buildNoteListColumnPlan", () => {
  it("隠す順は 作者 → 作成日 → フォルダ → ラベル", () => {
    expect(buildNoteListColumnPlan(FULL).hideable.map((c) => c.key)).toEqual([
      "author",
      "createdAt",
      "folder",
      "labels",
    ]);
  });

  it("ラベル列が無い一覧では、ラベルを隠す候補にも幅にも入れない", () => {
    const withLabels = buildNoteListColumnPlan(FULL);
    const without = buildNoteListColumnPlan({ ...FULL, hasLabels: false });
    expect(without.hideable.map((c) => c.key)).not.toContain("labels");
    expect(requiredWidth(withLabels, 0) - requiredWidth(without, 0)).toBe(W.labels);
  });

  it("チェック列・操作列が無いときはその幅を含めない", () => {
    const full = buildNoteListColumnPlan(FULL);
    const bare = buildNoteListColumnPlan({ hasCheckbox: false, hasActions: false, hasLabels: true });
    expect(full.baseWidth - bare.baseWidth).toBe(W.checkbox + W.actions);
  });

  it("全部隠した幅 = タイトル最小幅 + 参照先・被参照・本アイコン・更新日 + チェック・操作", () => {
    expect(tableMinWidth(buildNoteListColumnPlan(FULL))).toBe(
      NOTE_LIST_TITLE_MIN_WIDTH + 72 + 72 + 56 + 126 + 36 + 72,
    );
  });

  it("絞り込み中の列は隠さず、幅を隠さない側に数える", () => {
    const pinned = new Set<NoteListHideableColumn>(["author"]);
    const plan = buildNoteListColumnPlan({ ...FULL, pinned });
    expect(plan.hideable.map((c) => c.key)).toEqual(["createdAt", "folder", "labels"]);
    expect(plan.baseWidth).toBe(buildNoteListColumnPlan(FULL).baseWidth + W.author);
  });

  it("枠の幅に応じて 作者 → 作成日 → フォルダ → ラベル の順に隠れる", () => {
    const at = (w: number) => hiddenAt(w, FULL);
    expect(at(1300)).toEqual([]);
    expect(at(requiredWidth(buildNoteListColumnPlan(FULL), 0) - 1)).toEqual(["author"]);
    expect(at(requiredWidth(buildNoteListColumnPlan(FULL), 1) - 1)).toEqual(["author", "createdAt"]);
    expect(at(requiredWidth(buildNoteListColumnPlan(FULL), 2) - 1)).toEqual([
      "author",
      "createdAt",
      "folder",
    ]);
    expect(at(requiredWidth(buildNoteListColumnPlan(FULL), 3) - 1)).toEqual([
      "author",
      "createdAt",
      "folder",
      "labels",
    ]);
  });

  it("境目の幅（ストーリーのコメントと同じ値）", () => {
    const plan = buildNoteListColumnPlan(FULL);
    expect([0, 1, 2, 3, 4].map((k) => requiredWidth(plan, k))).toEqual([1203, 1107, 981, 831, 691]);
  });

  it("Windows 既定（150%）の実質 1280 幅・サイドバー展開（枠 976px）では、作者・作成日・フォルダが隠れる", () => {
    // 枠 = 1280 − サイドバー 256 − 左右余白 24×2。ラベルは残る
    expect(hiddenAt(976, FULL)).toEqual(["author", "createdAt", "folder"]);
  });
});

describe("buildWikiListColumnPlan", () => {
  it("隠す順は モデル → 作成日（→ 世界照合の列があるときだけ世界照合）。出典照合は隠さず幅に数える", () => {
    const plan = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: true });
    expect(plan.hideable.map((c) => c.key)).toEqual(["model", "createdAt"]);
    const both = buildWikiListColumnPlan({ hasWorldVerdict: true, hasSourceVerdict: true });
    expect(both.hideable.map((c) => c.key)).toEqual(["model", "createdAt", "worldVerdict"]);
    const noSource = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: false });
    expect(plan.baseWidth - noSource.baseWidth).toBe(120);
  });

  it("境目の幅（ストーリーのコメントと同じ値）", () => {
    const noWorld = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: true });
    expect([0, 1, 2].map((k) => requiredWidth(noWorld, k))).toEqual([1199, 1077, 951]);
    const withWorld = buildWikiListColumnPlan({ hasWorldVerdict: true, hasSourceVerdict: true });
    expect([0, 1, 2, 3].map((k) => requiredWidth(withWorld, k))).toEqual([1309, 1187, 1061, 951]);
  });

  it("枠が狭いと モデル → 作成日 の順に隠れる", () => {
    const plan = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: true });
    expect(resolveHiddenCount(requiredWidth(plan, 0) - 1, plan)).toBe(1);
    expect(resolveHiddenCount(requiredWidth(plan, 1) - 1, plan)).toBe(2);
    expect(resolveHiddenCount(5000, plan)).toBe(0);
  });

  it.each([
    ["知見（世界・出典とも有り）", { hasWorldVerdict: true, hasSourceVerdict: true }],
    ["知見（世界照合を切った）", { hasWorldVerdict: false, hasSourceVerdict: true }],
    ["洞察（世界照合のみ）", { hasWorldVerdict: true, hasSourceVerdict: false }],
    ["トピック・問答（どちらも無し）", { hasWorldVerdict: false, hasSourceVerdict: false }],
  ])("%s: Windows 既定の枠（内側 976px）では、隠せば収まり横スクロールが出ない", (_name, opts) => {
    const plan = buildWikiListColumnPlan(opts);
    const hidden = resolveHiddenCount(976, plan);
    expect(requiredWidth(plan, hidden)).toBeLessThanOrEqual(976);
  });
});
