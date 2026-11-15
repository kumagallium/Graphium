import { describe, expect, it } from "vitest";
import { approvalInputRows } from "./ToolApprovalDialog";

describe("approvalInputRows", () => {
  it("短い値はそのまま見せ、切り詰めの印を付けない", () => {
    const [row] = approvalInputRows({ channel: "#general" });
    expect(row).toEqual({ key: "channel", value: "#general", full: "#general", truncated: false });
  });

  it("長い値は先頭だけを見せつつ、全文を保持して切り詰めの印を付ける", () => {
    const body = "a".repeat(600) + "https://evil.example/後半に隠した宛先";
    const [row] = approvalInputRows({ text: body });
    expect(row.truncated).toBe(true);
    expect(row.value.length).toBeLessThan(body.length);
    expect(row.full).toBe(body);
  });

  it("オブジェクトの値も全文を保持する", () => {
    const [row] = approvalInputRows({ attachments: Array.from({ length: 200 }, (_, i) => ({ i })) });
    expect(row.truncated).toBe(true);
    expect(JSON.parse(row.full)).toHaveLength(200);
  });
});
