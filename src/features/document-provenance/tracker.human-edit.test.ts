import { describe, it, expect } from "vitest";
import type { DocumentProvenance, EditActivity } from "./types";
import { isHumanActivityType, hasHumanEditHistory, createEmptyProvenance } from "./tracker";

/** activityType だけを持つ最小 EditActivity */
function makeActivity(type: EditActivity["type"]): EditActivity {
  return { id: "edit_001", type, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:00Z", wasAssociatedWith: "agent_human" };
}

describe("isHumanActivityType", () => {
  it("human_edit / human_derivation / derive_source / snapshot_restore / proposal_adopt は人間の操作", () => {
    expect(isHumanActivityType("human_edit")).toBe(true);
    expect(isHumanActivityType("human_derivation")).toBe(true);
    expect(isHumanActivityType("derive_source")).toBe(true);
    expect(isHumanActivityType("snapshot_restore")).toBe(true);
    expect(isHumanActivityType("proposal_adopt")).toBe(true);
  });

  it("wiki_* や ai_generation は AI の操作", () => {
    expect(isHumanActivityType("ai_generation")).toBe(false);
    expect(isHumanActivityType("ai_derivation")).toBe(false);
    expect(isHumanActivityType("wiki_ingest")).toBe(false);
    expect(isHumanActivityType("wiki_merge")).toBe(false);
    expect(isHumanActivityType("wiki_cross_update")).toBe(false);
    expect(isHumanActivityType("wiki_dedup_merge")).toBe(false);
    expect(isHumanActivityType("wiki_regenerate")).toBe(false);
    expect(isHumanActivityType("wiki_atomize")).toBe(false);
    expect(isHumanActivityType("wiki_reinforce")).toBe(false);
    expect(isHumanActivityType("skill_default_update")).toBe(false);
  });
});

describe("hasHumanEditHistory", () => {
  it("provenance が無ければ false", () => {
    expect(hasHumanEditHistory(undefined)).toBe(false);
  });

  it("activities が空なら false", () => {
    expect(hasHumanEditHistory(createEmptyProvenance())).toBe(false);
  });

  it("AI 操作しか無ければ false", () => {
    const provenance: DocumentProvenance = {
      ...createEmptyProvenance(),
      activities: [makeActivity("wiki_ingest"), makeActivity("wiki_cross_update")],
    };
    expect(hasHumanEditHistory(provenance)).toBe(false);
  });

  it("人間の操作が 1 件でもあれば true", () => {
    const provenance: DocumentProvenance = {
      ...createEmptyProvenance(),
      activities: [makeActivity("wiki_ingest"), makeActivity("human_edit"), makeActivity("wiki_cross_update")],
    };
    expect(hasHumanEditHistory(provenance)).toBe(true);
  });
});
