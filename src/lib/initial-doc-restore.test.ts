import { describe, it, expect } from "vitest";
import { decideInitialDocAction } from "./initial-doc-restore";

describe("decideInitialDocAction", () => {
  it("復元済みなら何もしない", () => {
    expect(decideInitialDocAction({ initialized: true, hasInitialDoc: true, openedBlank: false })).toBe("skip");
    expect(decideInitialDocAction({ initialized: true, hasInitialDoc: true, openedBlank: true })).toBe("skip");
  });
  it("initialDoc がまだ無ければ何もしない", () => {
    expect(decideInitialDocAction({ initialized: false, hasInitialDoc: false, openedBlank: true })).toBe("skip");
    expect(decideInitialDocAction({ initialized: false, hasInitialDoc: false, openedBlank: false })).toBe("skip");
  });
  it("既存のノートとして開いたなら、ストアを復元する", () => {
    expect(decideInitialDocAction({ initialized: false, hasInitialDoc: true, openedBlank: false })).toBe("restore");
  });
  it("白紙の新規ノートとして開いたなら、最初の保存の本文では置き換えない", () => {
    expect(decideInitialDocAction({ initialized: false, hasInitialDoc: true, openedBlank: true })).toBe("notify-only");
  });
});
