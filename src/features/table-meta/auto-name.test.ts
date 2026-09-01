// テーブル表示名（キャプション + 自動名）の採番
import { describe, expect, it } from "vitest";
import { computeTableDisplayNames } from "./auto-name";
import { t } from "../../i18n";

const table = (id: string) => ({ id, type: "table" });
const auto = (n: number) => t("tableMeta.autoName", { n: String(n) });

describe("computeTableDisplayNames", () => {
  it("すべての表に文書順で自動名を振り、キャプションが勝つ", () => {
    const names = computeTableDisplayNames(
      [table("a"), table("b"), { id: "s", type: "step", children: [table("c")] }],
      (id) => (id === "b" ? "秤量表" : "")
    );
    expect(names.get("a")).toBe(auto(1));
    expect(names.get("b")).toBe("秤量表");
    expect(names.get("c")).toBe(auto(2));
  });

  it("キャプションに固定済みの自動名は採番から飛ばす（参照の乗っ取り防止）", () => {
    // 「表 1」で参照された表が名前を固定した後、上に新しい表を追加したケース。
    // 新しい表へ同じ「表 1」を振ると既存の参照が別の表を指してしまう
    const names = computeTableDisplayNames(
      [table("new"), table("fixed")],
      (id) => (id === "fixed" ? auto(1) : "")
    );
    expect(names.get("fixed")).toBe(auto(1));
    expect(names.get("new")).toBe(auto(2));
  });
});
