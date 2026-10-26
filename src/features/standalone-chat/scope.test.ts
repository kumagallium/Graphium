import { describe, expect, it } from "vitest";
import { DEFAULT_STANDALONE_CHAT_SCOPE, STANDALONE_CHAT_SCOPES, toStandaloneChatScope } from "./scope";

describe("toStandaloneChatScope", () => {
  it("外部参照はそのまま通す", () => {
    expect(toStandaloneChatScope("external")).toBe("external");
  });

  it("内部参照はそのまま通す", () => {
    expect(toStandaloneChatScope("internal")).toBe("internal");
  });

  it("ノート内参照はこのチャットでは成立しないので内部参照に読み替える", () => {
    expect(toStandaloneChatScope("notes")).toBe("internal");
  });

  it("未指定は既定（内部参照）", () => {
    expect(toStandaloneChatScope(undefined)).toBe(DEFAULT_STANDALONE_CHAT_SCOPE);
    expect(DEFAULT_STANDALONE_CHAT_SCOPE).toBe("internal");
  });

  it("チップに出す選択肢は外部参照と内部参照の 2 つで、既定が含まれる", () => {
    expect(STANDALONE_CHAT_SCOPES).toEqual(["external", "internal"]);
    expect(STANDALONE_CHAT_SCOPES).toContain(DEFAULT_STANDALONE_CHAT_SCOPE);
  });
});
