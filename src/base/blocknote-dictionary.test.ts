import { describe, expect, it } from "vitest";
import { en as bnEn, ja as bnJa } from "@blocknote/core/locales";
import { getBlockNoteDictionary } from "./blocknote-dictionary";

describe("getBlockNoteDictionary", () => {
  it("en は BlockNote 既定の英語辞書を返す", () => {
    expect(getBlockNoteDictionary("en")).toBe(bnEn);
  });

  it("ja はアプリの語彙に合わせた上書きが効いている", () => {
    const ja = getBlockNoteDictionary("ja");
    // 全角数字 → 半角（editor.turnIntoType.* と同じ表記）
    expect(ja.slash_menu.heading.title).toBe("見出し1");
    // ビデオ/オーディオ → 動画/音声（asset.type.* と同じ表記）
    expect(ja.file_blocks.add_button_text.video).toBe("動画を追加");
    expect(ja.file_panel.upload.file_placeholder.audio).toBe("音声をアップロード");
    // 表 → テーブル（common.table と同じ表記）
    expect(ja.slash_menu.table.title).toBe("テーブル");
  });

  it("ja のスラッシュ項目は英語・日本語どちらの入力でも検索でヒットする", () => {
    const ja = getBlockNoteDictionary("ja");
    const matches = (item: { title: string; aliases?: string[] }, q: string) =>
      item.title.toLowerCase().includes(q.toLowerCase()) ||
      (item.aliases ?? []).some((a) => a.toLowerCase().includes(q.toLowerCase()));
    // 同梱 ja が落としている英語 alias が en からマージされている
    expect(matches(ja.slash_menu.emoji, "emoji")).toBe(true);
    expect(matches(ja.slash_menu.toggle_list, "toggle")).toBe(true);
    expect(matches(ja.slash_menu.heading, "heading1")).toBe(true);
    // 全項目について、en の英語 alias と ja のタイトルの両方でヒットする
    for (const [key, enItem] of Object.entries(bnEn.slash_menu)) {
      const jaItem = ja.slash_menu[key as keyof typeof ja.slash_menu];
      for (const alias of enItem.aliases ?? []) {
        expect(matches(jaItem, alias), `${key} を英語 alias "${alias}" で検索`).toBe(true);
      }
      expect(matches(jaItem, jaItem.title), `${key} を日本語タイトルで検索`).toBe(true);
    }
  });

  it("ja の上書きしていない項目は BlockNote 同梱の訳のまま", () => {
    const ja = getBlockNoteDictionary("ja");
    expect(ja.table_handle.delete_column_menuitem).toBe(
      bnJa.table_handle.delete_column_menuitem,
    );
    expect(ja.color_picker.text_title).toBe(bnJa.color_picker.text_title);
  });

  it("ja は en と同じキー構造を持つ（欠けキーによる英語混在・undefined 表示を防ぐ）", () => {
    // placeholders.emptyDocument は en 側も undefined の宣言のみなので除外
    const walk = (en: any, ja: any, path: string) => {
      for (const key of Object.keys(en)) {
        if (en[key] === undefined) continue;
        const p = path ? `${path}.${key}` : key;
        expect(ja[key], `missing: ${p}`).toBeDefined();
        if (typeof en[key] === "object" && !Array.isArray(en[key])) {
          walk(en[key], ja[key], p);
        }
      }
    };
    walk(bnEn, getBlockNoteDictionary("ja"), "");
  });
});
