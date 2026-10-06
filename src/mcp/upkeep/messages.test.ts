import { describe, expect, it } from "vitest";

import type {
  MaintenanceOperation,
  MaintenanceOperationKind,
  MaintenanceOperationState,
} from "../../features/knowledge-maintenance/types";
import type { UndoRefusal } from "../../features/knowledge-maintenance/undo";
import { describeActorJa, describeOperationJa, describeRefusalJa, describeStateJa } from "./messages";

const baseOp = (kind: MaintenanceOperationKind, extra: Partial<MaintenanceOperation> = {}): MaintenanceOperation => ({
  id: "o1",
  kind,
  startedAt: "2026-10-07T00:00:00.000Z",
  related: [],
  pages: [],
  flags: [],
  status: "applied",
  ...extra,
});

describe("describeOperationJa", () => {
  const kinds: MaintenanceOperationKind[] = ["merge_topics", "merge_atoms", "regenerate", "archive", "restore_version", "undo"];
  it("全 kind で空文字にならない", () => {
    for (const kind of kinds) {
      const op = baseOp(kind, {
        subject: { wikiId: "w", title: "題" },
        related: [{ wikiId: "x", title: "X", role: kind === "archive" ? "archived" : "absorbed" }],
      });
      expect(describeOperationJa(op).length).toBeGreaterThan(0);
    }
    expect(describeOperationJa(baseOp("undo"))).toContain("操作を取り消しました");
    expect(describeOperationJa(baseOp("archive", { related: [{ wikiId: "a", title: "A", role: "archived" }, { wikiId: "b", title: "B", role: "archived" }] }))).toBe("2 件をアーカイブしました");
  });
  it("統合の文に題と件数が入る", () => {
    const s = describeOperationJa(
      baseOp("merge_topics", { subject: { wikiId: "k", title: "残す" }, related: [{ wikiId: "a", title: "A", role: "absorbed" }] }),
    );
    expect(s).toBe("「残す」に 1 件のトピックを統合しました");
  });
});

describe("describeStateJa", () => {
  it("全 state で空文字にならない", () => {
    const states: MaintenanceOperationState[] = ["applied", "undone", "undo_partial", "interrupted", "running"];
    for (const s of states) expect(describeStateJa(s).length).toBeGreaterThan(0);
  });
});

describe("describeRefusalJa", () => {
  it("全 code で先頭に安定した語が付く", () => {
    const op = baseOp("regenerate", { subject: { wikiId: "w", title: "題" } });
    const cases: [UndoRefusal, string][] = [
      [{ code: "blocked", blockers: [{ runId: "r", operationId: "o", op }] }, "BLOCKED:"],
      [{ code: "not_found" }, "NOT_FOUND:"],
      [{ code: "already_undone" }, "ALREADY_UNDONE:"],
      [{ code: "in_progress" }, "IN_PROGRESS:"],
      [{ code: "unsupported" }, "UNSUPPORTED:"],
      [{ code: "copy_unreadable", copyKeys: ["k"] }, "COPY_UNREADABLE:"],
    ];
    for (const [r, head] of cases) expect(describeRefusalJa(r).startsWith(head)).toBe(true);
    expect(describeRefusalJa(cases[0][0])).toContain("再生成しました");
  });
});

describe("describeActorJa", () => {
  it("経路を返す", () => {
    expect(describeActorJa({ via: "app" })).toBe("Graphium");
    expect(describeActorJa({ via: "mcp", client: "claude-desktop" })).toBe("MCP (claude-desktop)");
    expect(describeActorJa({ via: "mcp" })).toBe("MCP");
  });
});
