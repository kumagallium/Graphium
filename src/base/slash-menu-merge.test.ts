import { describe, it, expect } from "vitest";
import { mergeSlashMenuItems } from "./slash-menu-merge";

const item = (title: string, group: string) => ({ title, group });
const keys = (items: { title: string; group?: string }[]) =>
  items.map((i) => `${i.group}/${i.title}`);

describe("mergeSlashMenuItems", () => {
  it("同じグループの項目を隣接させ、グループの中は渡した順を保つ", () => {
    const defaults = [item("見出し1", "見出し"), item("テーブル", "高度"), item("ファイル", "メディア")];
    const extras = [item("画像", "メディア"), item("チャート", "高度"), item("計算", "高度")];
    expect(keys(mergeSlashMenuItems(defaults, extras))).toEqual([
      "見出し/見出し1",
      "高度/テーブル",
      "高度/チャート",
      "高度/計算",
      "メディア/ファイル",
      "メディア/画像",
    ]);
  });

  it("groupOrder に挙げたグループを先頭からその順に、無いグループは現れた順で後ろに続ける", () => {
    const defaults = [item("見出し1", "見出し"), item("テーブル", "高度"), item("絵文字", "その他")];
    const extras = [item("新しいノート", "ノート"), item("知見", "知見")];
    const merged = mergeSlashMenuItems(defaults, extras, ["見出し", "高度", "ノート"]);
    expect(merged.map((i) => i.group)).toEqual(["見出し", "高度", "ノート", "その他", "知見"]);
  });

  it("groupOrder に挙がったグループの項目が無くても落ちない", () => {
    const merged = mergeSlashMenuItems([item("a", "x")], [item("b", "y")], ["z", "y", "x"]);
    expect(merged.map((i) => i.group)).toEqual(["y", "x"]);
  });

  it("同じ題名 + グループは既定側を 1 つ残す", () => {
    const d = item("テーブル", "高度");
    const e = item("テーブル", "高度");
    const merged = mergeSlashMenuItems([d], [e]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(d);
  });

  it("グループ名が getter の項目（言語切替で引き直す独自項目）も並べられる", () => {
    let lang = "ja";
    const lazy = {
      title: "計算",
      get group() {
        return lang === "ja" ? "高度" : "Advanced";
      },
    };
    expect(mergeSlashMenuItems([item("テーブル", "高度")], [lazy]).map((i) => i.group)).toEqual([
      "高度",
      "高度",
    ]);
    lang = "en";
    expect(mergeSlashMenuItems([item("Table", "Advanced")], [lazy]).map((i) => i.group)).toEqual([
      "Advanced",
      "Advanced",
    ]);
  });
});
