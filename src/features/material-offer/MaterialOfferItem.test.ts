import { describe, expect, it } from "vitest";
import { shortenSourcePath } from "./MaterialOfferItem";

describe("shortenSourcePath", () => {
  it("ホームフォルダを ~ に縮める", () => {
    expect(shortenSourcePath("/Users/someone/Downloads/a.pdf")).toBe("~/Downloads/a.pdf");
    expect(shortenSourcePath("C:\\Users\\someone\\Downloads\\a.pdf")).toBe("~\\Downloads\\a.pdf");
  });

  it("長いパスは最後の 2 段だけ残す", () => {
    expect(shortenSourcePath("/tmp/codex-remote-attachments/01a0feb9-7662/CA5DE6B8-3A9E/1-photo.jpg")).toBe(
      "…/CA5DE6B8-3A9E/1-photo.jpg",
    );
  });

  it("短いパスはそのまま", () => {
    expect(shortenSourcePath("/tmp/a.png")).toBe("/tmp/a.png");
  });
});
