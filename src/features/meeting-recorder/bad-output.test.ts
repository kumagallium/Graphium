import { describe, expect, it } from "vitest";
import { syncLocale, t } from "../../i18n";
import { badOutputMessage } from "./bad-output";

describe("badOutputMessage", () => {
  syncLocale("ja");
  const res = (body: unknown) => new Response(JSON.stringify(body), { status: 502 });
  it("出力が上限で切れていたら、その理由を出す", async () => {
    expect(await badOutputMessage(res({ code: "AI_OUTPUT_TRUNCATED" }), "fallback")).toBe(t("aiError.outputTruncated"));
  });
  it("それ以外・読めない本文は fallback", async () => {
    expect(await badOutputMessage(res({ error: "x" }), "fallback")).toBe("fallback");
    expect(await badOutputMessage(new Response("oops", { status: 502 }), "fallback")).toBe("fallback");
  });
});
