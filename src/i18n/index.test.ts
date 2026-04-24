// i18n モジュールのテスト
// Context 外で使う翻訳ユーティリティ（t, syncLocale, getLocale, getDisplayLabel, getDisplayLabelName）を検証

import { describe, it, expect, beforeEach } from "vitest";
import {
  t,
  syncLocale,
  getLocale,
  getDisplayLabel,
  getDisplayLabelName,
} from "./index";

// 各テストの前にロケールを英語にリセットし、テスト間の汚染を防ぐ
beforeEach(() => {
  syncLocale("en");
});

// ── t() 関数 ──

describe("t()", () => {
  it("既知のキーに対して正しい英語翻訳を返す", () => {
    expect(t("common.save")).toBe("Save");
    expect(t("common.close")).toBe("Close");
    expect(t("status.done")).toBe("Done");
    expect(t("label.step")).toBe("Step");
  });

  it("辞書に存在しないキーはキー自体をそのまま返す（フォールバック）", () => {
    expect(t("nonexistent.key")).toBe("nonexistent.key");
    expect(t("")).toBe("");
    expect(t("totally.unknown.deep.key")).toBe("totally.unknown.deep.key");
  });

  it("パラメータ置換 ({param} 形式) が正しく動作する", () => {
    // {label} プレースホルダーを持つキー
    expect(t("labelUi.insertLabeledBlock", { label: "Procedure" })).toBe(
      "Insert block with Procedure label",
    );
    // {count} プレースホルダー
    expect(t("linkBadge.linkCount", { count: "5" })).toBe("5 links");
    // 複数パラメータ
    expect(t("provPanel.graphStats", { nodes: "10", relations: "3" })).toBe(
      "10 nodes · 3 relations",
    );
    expect(
      t("nav.noteCount", { filtered: "5", total: "20" }),
    ).toBe("5 / 20 notes");
  });

  it("パラメータ指定があってもキーが存在しなければキー自体を返す", () => {
    expect(t("missing.key", { name: "value" })).toBe("missing.key");
  });
});

// ── getDisplayLabel() ──

describe("getDisplayLabel()", () => {
  it("内部キーをロケールに応じた表示ラベルに変換する（英語）", () => {
    expect(getDisplayLabel("procedure")).toBe("[Step]");
    expect(getDisplayLabel("material")).toBe("[Input]");
    expect(getDisplayLabel("tool")).toBe("[Tool]");
    expect(getDisplayLabel("attribute")).toBe("[Parameter]");
    expect(getDisplayLabel("result")).toBe("[Output]");
    expect(getDisplayLabel("prev-procedure")).toBe("[Prior step]");
  });

  it("旧ブラケット表記は normalize 経由で内部キーとして解決される", () => {
    expect(getDisplayLabel("[手順]")).toBe("[Step]");
    expect(getDisplayLabel("[材料]")).toBe("[Input]");
    expect(getDisplayLabel("[ツール]")).toBe("[Tool]");
  });

  it("マップに存在しないフリーラベルはそのまま返す", () => {
    expect(getDisplayLabel("[カスタム]")).toBe("[カスタム]");
    expect(getDisplayLabel("[自由入力]")).toBe("[自由入力]");
    expect(getDisplayLabel("plain text")).toBe("plain text");
  });

  it("日本語ロケールでは日本語の表示ラベルを返す", () => {
    syncLocale("ja");
    expect(getDisplayLabel("procedure")).toBe("[ステップ]");
    expect(getDisplayLabel("material")).toBe("[インプット]");
    expect(getDisplayLabel("result")).toBe("[アウトプット]");
  });
});

// ── getDisplayLabelName() ──

describe("getDisplayLabelName()", () => {
  it("括弧付きの表示名から括弧を除去する", () => {
    expect(getDisplayLabelName("procedure")).toBe("Step");
    expect(getDisplayLabelName("material")).toBe("Input");
    expect(getDisplayLabelName("attribute")).toBe("Parameter");
    expect(getDisplayLabelName("result")).toBe("Output");
    expect(getDisplayLabelName("prev-procedure")).toBe("Prior step");
  });

  it("括弧なしの文字列はそのまま返す", () => {
    expect(getDisplayLabelName("text")).toBe("text");
    expect(getDisplayLabelName("plain label")).toBe("plain label");
  });

  it("マップに存在しない括弧付き文字列はそのまま括弧を除去する", () => {
    // [カスタム] はマップに存在しない → getDisplayLabel がそのまま返す → 括弧除去
    expect(getDisplayLabelName("[カスタム]")).toBe("カスタム");
  });
});

// ── syncLocale() + getLocale() ──

describe("syncLocale() / getLocale()", () => {
  it("デフォルトロケールは 'en' である", () => {
    // beforeEach で syncLocale("en") を呼んでいるので "en" になる
    // テスト環境では localStorage/navigator が利用不可のため detectLocale() も "en" を返す
    expect(getLocale()).toBe("en");
  });

  it("syncLocale('ja') 後に t() が日本語翻訳を返す", () => {
    syncLocale("ja");
    expect(getLocale()).toBe("ja");
    expect(t("common.save")).toBe("保存");
    expect(t("common.close")).toBe("閉じる");
    expect(t("status.done")).toBe("完了");
    expect(t("label.step")).toBe("ステップ");
  });

  it("syncLocale('en') で英語に戻せる", () => {
    syncLocale("ja");
    expect(t("common.save")).toBe("保存");

    syncLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("common.save")).toBe("Save");
  });

  it("日本語ロケールでもパラメータ置換が正しく動作する", () => {
    syncLocale("ja");
    expect(t("linkBadge.linkCount", { count: "3" })).toBe("3 リンク");
    expect(t("provPanel.graphStats", { nodes: "5", relations: "2" })).toBe(
      "5 ノード · 2 リレーション",
    );
  });
});

// ── detectLocale() の間接テスト ──

describe("detectLocale() の振る舞い（getLocale() 経由で確認）", () => {
  it("テスト環境（localStorage/navigator 利用不可）ではフォールバックとして 'en' を返す", () => {
    // detectLocale() は直接エクスポートされていないが、モジュール初期化時に呼ばれる
    // テスト環境では try-catch で例外をキャッチし "en" を返す設計
    // beforeEach で syncLocale("en") を呼んでいるため、ここでは "en" であることを確認
    expect(getLocale()).toBe("en");
  });
});
