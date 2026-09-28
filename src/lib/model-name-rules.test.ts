// isDuplicateModelName の判定テスト。追加・改名・無変更編集・既存の重複・前後の空白を押さえる。

import { describe, expect, it } from "vitest";
import { isDuplicateModelName } from "./model-name-rules.js";

const existing = [
  { id: "a", name: "GPT-4o" },
  { id: "b", name: "Claude Sonnet" },
];

describe("isDuplicateModelName", () => {
  it("追加（selfId が空文字）で同じ名前があれば true", () => {
    expect(isDuplicateModelName("GPT-4o", "", existing)).toBe(true);
  });

  it("追加で違う名前なら false", () => {
    expect(isDuplicateModelName("Gemini", "", existing)).toBe(false);
  });

  it("編集で名前を変えた先を別モデルが持っていれば true", () => {
    // id: b を Claude Sonnet → GPT-4o に改名しようとしている
    expect(isDuplicateModelName("GPT-4o", "b", existing)).toBe(true);
  });

  it("編集で名前を変えない（自分自身の名前と同じ）なら false（自分を除外するため）", () => {
    expect(isDuplicateModelName("GPT-4o", "a", existing)).toBe(false);
  });

  it("既に重なっている名前が 2 件あれば、どちらの id を self にしても true — 「名前を変えていない」の判定は呼び出し側の責務", () => {
    // この関数は「自分以外が同じ名前を持っているか」だけを見る。既に重複したデータを
    // 持つ利用者の無変更編集を通す責務は、呼び出し側（サーバー PUT / modal.tsx）が
    // 「新しい名前が今の名前と同じなら、この関数を呼ぶ前にスキップする」ことで担う。
    const dup = [
      { id: "a", name: "Same Name" },
      { id: "b", name: "Same Name" },
    ];
    expect(isDuplicateModelName("Same Name", "a", dup)).toBe(true);
    expect(isDuplicateModelName("Same Name", "b", dup)).toBe(true);
  });

  it("前後の空白を trim してから比較する", () => {
    expect(isDuplicateModelName("  GPT-4o  ", "", existing)).toBe(true);
    expect(isDuplicateModelName("GPT-4o", "", [{ id: "a", name: "  GPT-4o  " }])).toBe(true);
  });

  it("大文字・小文字は区別する", () => {
    expect(isDuplicateModelName("gpt-4o", "", existing)).toBe(false);
  });

  it("空文字は重複と判定しない", () => {
    expect(isDuplicateModelName("", "", existing)).toBe(false);
    expect(isDuplicateModelName("   ", "", existing)).toBe(false);
  });
});
