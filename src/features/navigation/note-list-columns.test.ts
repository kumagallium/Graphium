// ノート一覧・ナレッジ一覧の列計画（幅と隠す順）のテスト
import { describe, expect, it } from "vitest";
import {
  SCROLLBAR_SLACK,
  requiredWidth,
  resolveHiddenCount,
  tableMinWidth,
} from "../../lib/responsive-columns";
import {
  NOTE_LIST_COLUMN_WIDTH as W,
  NOTE_LIST_TITLE_COMPACT_MIN_WIDTH,
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
  it("隠す順は 作者 → 作成日 → フォルダ → ラベル → 本アイコン", () => {
    expect(buildNoteListColumnPlan(FULL).hideable.map((c) => c.key)).toEqual([
      "author",
      "createdAt",
      "folder",
      "labels",
      "knowledge",
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

  it("全部隠した幅 = タイトル最小幅 + 参照先・被参照・更新日 + チェック・操作（本アイコンも隠れる）", () => {
    expect(tableMinWidth(buildNoteListColumnPlan(FULL))).toBe(
      NOTE_LIST_TITLE_MIN_WIDTH + 72 + 72 + 126 + 36 + 72,
    );
  });

  it("全部隠した後だけ、表の下限はタイトルを 150 まで詰めた幅になる", () => {
    const plan = buildNoteListColumnPlan(FULL);
    expect(tableMinWidth(plan, true)).toBe(
      NOTE_LIST_TITLE_COMPACT_MIN_WIDTH + 72 + 72 + 126 + 36 + 72,
    );
    expect(tableMinWidth(plan, true)).toBe(528);
    // 詰める前（隠す途中）の幅は変わらない
    expect(tableMinWidth(plan, false)).toBe(618);
  });

  it("絞り込み中の列は隠さず、幅を隠さない側に数える", () => {
    const pinned = new Set<NoteListHideableColumn>(["author"]);
    const plan = buildNoteListColumnPlan({ ...FULL, pinned });
    expect(plan.hideable.map((c) => c.key)).toEqual(["createdAt", "folder", "labels", "knowledge"]);
    expect(plan.baseWidth).toBe(buildNoteListColumnPlan(FULL).baseWidth + W.author);
  });

  it("本アイコンの並べ替え中は隠さず、幅を隠さない側に数える", () => {
    const pinned = new Set<NoteListHideableColumn>(["knowledge"]);
    const plan = buildNoteListColumnPlan({ ...FULL, pinned });
    expect(plan.hideable.map((c) => c.key)).toEqual(["author", "createdAt", "folder", "labels"]);
    expect(plan.baseWidth).toBe(buildNoteListColumnPlan(FULL).baseWidth + W.knowledge);
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
    expect(at(requiredWidth(buildNoteListColumnPlan(FULL), 4) - 1)).toEqual([
      "author",
      "createdAt",
      "folder",
      "labels",
      "knowledge",
    ]);
  });

  it("境目の幅（ストーリーのコメントと同じ値）", () => {
    const plan = buildNoteListColumnPlan(FULL);
    expect([0, 1, 2, 3, 4, 5].map((k) => requiredWidth(plan, k))).toEqual([
      1203, 1107, 981, 831, 691, 635,
    ]);
  });

  it("Windows 既定（150%）の実質 1280 幅・サイドバー展開（枠 976px）では、作者・作成日・フォルダが隠れる", () => {
    // 枠 = 1280 − サイドバー 256 − 左右余白 24×2。ラベルは残る
    expect(hiddenAt(976, FULL)).toEqual(["author", "createdAt", "folder"]);
  });

  it("1024 幅・サイドバー開き（枠 720px）は、ラベルまで隠れ、本アイコンは残る（見た目は従来どおり）", () => {
    expect(hiddenAt(720, FULL)).toEqual(["author", "createdAt", "folder", "labels"]);
  });

  it("853 幅・サイドバー開き（枠 549px）は、本アイコンまで隠しタイトルを詰めて、スクロールバー込みでも収まる", () => {
    const plan = buildNoteListColumnPlan(FULL);
    expect(resolveHiddenCount(549, plan)).toBe(plan.hideable.length);
    // 詰めた表の下限 + スクロールバーが枠に収まる = 横スクロールが出ない
    expect(tableMinWidth(plan, true) + SCROLLBAR_SLACK).toBeLessThanOrEqual(549);
    // 詰める前の幅（618 + 17）は 549 に収まらない = 詰める段が要る
    expect(requiredWidth(plan, plan.hideable.length)).toBeGreaterThan(549);
  });
});

describe("buildWikiListColumnPlan", () => {
  it("隠す順は モデル → 作成日（→ 世界照合の列があるときだけ世界照合）→ 出典数。出典照合は隠さず幅に数える", () => {
    const plan = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: true });
    expect(plan.hideable.map((c) => c.key)).toEqual(["model", "createdAt", "sources"]);
    const both = buildWikiListColumnPlan({ hasWorldVerdict: true, hasSourceVerdict: true });
    expect(both.hideable.map((c) => c.key)).toEqual(["model", "createdAt", "worldVerdict", "sources"]);
    const noSource = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: false });
    expect(plan.baseWidth - noSource.baseWidth).toBe(120);
  });

  it("境目の幅（ストーリーのコメントと同じ値）", () => {
    const noWorld = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: true });
    expect([0, 1, 2, 3].map((k) => requiredWidth(noWorld, k))).toEqual([1199, 1077, 951, 871]);
    const withWorld = buildWikiListColumnPlan({ hasWorldVerdict: true, hasSourceVerdict: true });
    expect([0, 1, 2, 3, 4].map((k) => requiredWidth(withWorld, k))).toEqual([
      1309, 1187, 1061, 951, 871,
    ]);
  });

  it("枠が狭いと モデル → 作成日 → 出典数 の順に隠れる", () => {
    const plan = buildWikiListColumnPlan({ hasWorldVerdict: false, hasSourceVerdict: true });
    expect(resolveHiddenCount(requiredWidth(plan, 0) - 1, plan)).toBe(1);
    expect(resolveHiddenCount(requiredWidth(plan, 1) - 1, plan)).toBe(2);
    expect(resolveHiddenCount(requiredWidth(plan, 2) - 1, plan)).toBe(3);
    expect(resolveHiddenCount(5000, plan)).toBe(0);
  });

  it("全部隠した後だけ、表の下限はタイトルを 200 まで詰めた幅になる", () => {
    const plan = buildWikiListColumnPlan({ hasWorldVerdict: true, hasSourceVerdict: true });
    expect(tableMinWidth(plan, false)).toBe(854);
    expect(tableMinWidth(plan, true)).toBe(814);
  });

  // 1164 幅・サイドバー開き（枠 908 − 余白 48 = 860px）。種別ごとに、隠せるだけ隠して
  // タイトルを詰めれば、スクロールバー込みで収まる（横スクロールが出ない）
  it.each([
    ["知見（世界・出典とも有り）", { hasWorldVerdict: true, hasSourceVerdict: true }],
    ["知見（世界照合を切った）", { hasWorldVerdict: false, hasSourceVerdict: true }],
    ["洞察（世界照合のみ）", { hasWorldVerdict: true, hasSourceVerdict: false }],
    ["要約・問答（どちらも無し）", { hasWorldVerdict: false, hasSourceVerdict: false }],
    ["トピック（出典照合のみ）", { hasWorldVerdict: false, hasSourceVerdict: true }],
  ])("%s: 1164 幅（内側 860px）でも横スクロールが出ない", (_name, opts) => {
    const plan = buildWikiListColumnPlan(opts);
    const hidden = resolveHiddenCount(860, plan);
    const all = hidden === plan.hideable.length;
    const need = all && requiredWidth(plan, hidden) > 860 ? tableMinWidth(plan, true) : requiredWidth(plan, hidden);
    expect(need + (all ? SCROLLBAR_SLACK : 0)).toBeLessThanOrEqual(860);
  });

  it("知見（世界・出典とも有り）の 1164 幅では、出典数まで隠れる", () => {
    const plan = buildWikiListColumnPlan({ hasWorldVerdict: true, hasSourceVerdict: true });
    const hidden = plan.hideable.slice(0, resolveHiddenCount(860, plan)).map((c) => c.key);
    expect(hidden).toEqual(["model", "createdAt", "worldVerdict", "sources"]);
  });

  it("1280 幅・サイドバー開き（内側 976px）の知見は、出典数が残る（見た目は従来どおり）", () => {
    const plan = buildWikiListColumnPlan({ hasWorldVerdict: true, hasSourceVerdict: true });
    const hidden = plan.hideable.slice(0, resolveHiddenCount(976, plan)).map((c) => c.key);
    expect(hidden).toEqual(["model", "createdAt", "worldVerdict"]);
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
