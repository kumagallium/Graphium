import { describe, it, expect } from "vitest";
import { singleModelForAssignment } from "./assignment-collapse";

const base = { modelsLoaded: true, modelNames: ["研究室のサーバー"], model: "", standardModel: "", preciseModel: "" };

describe("singleModelForAssignment", () => {
  it("モデルが 1 つで、どの段も選んでいなければ、その名前を返す", () => {
    expect(singleModelForAssignment(base)).toBe("研究室のサーバー");
  });

  it("軽い処理の欄にその 1 つを選んであっても 1 行にする（答えは同じ）", () => {
    expect(singleModelForAssignment({ ...base, model: "研究室のサーバー" })).toBe("研究室のサーバー");
  });

  it("モデルが 2 つ以上なら 1 行にしない（段ごとに選ぶものがある）", () => {
    expect(singleModelForAssignment({ ...base, modelNames: ["研究室のサーバー", "claude-opus-5"] })).toBeNull();
  });

  it("モデルが無い・読み込み中なら判定しない", () => {
    expect(singleModelForAssignment({ ...base, modelNames: [] })).toBeNull();
    expect(singleModelForAssignment({ ...base, modelsLoaded: false })).toBeNull();
  });

  it("標準・高度の段に何か選んであれば、今の 3 段で見せる（消したモデルの名前が残っている場合も）", () => {
    expect(singleModelForAssignment({ ...base, standardModel: "研究室のサーバー" })).toBeNull();
    expect(singleModelForAssignment({ ...base, preciseModel: "消したモデル" })).toBeNull();
    expect(singleModelForAssignment({ ...base, model: "消したモデル" })).toBeNull();
  });
});
