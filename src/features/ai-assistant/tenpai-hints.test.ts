// computeTenpaiHints の振る舞いを fixture ベースで保証する。
// [[project-tenpai-layer-design]] の note 単位 clustering / dedup / 無音化境界が
// regression しないかをテストする。

import { describe, expect, it } from "vitest";
import { computeTenpaiHints } from "./tenpai-hints";
import type {
  GraphiumDocument,
  GraphiumFile,
  WikiMetaSummary,
} from "../../lib/document-types";
import type { AtomType } from "../../lib/document-types";

/** atom doc を 1 件作る。derivedFromClaims に source claim ID を持たせる。 */
function makeAtomDoc(id: string, title: string, atomType: AtomType, claimIds: string[]): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    source: "ai",
    wikiMeta: {
      kind: "atom",
      atomType,
      derivedFromNotes: [], // context-stripped (PR-B4.5)
      derivedFromChats: [],
      derivedFromClaims: claimIds,
      generatedAt: "2026-05-26T00:00:00.000Z",
      lastIngestedAt: "2026-05-26T00:00:00.000Z",
      generatedBy: { model: "test", version: "1.0.0" },
    },
    createdAt: "2026-05-26T00:00:00.000Z",
    modifiedAt: "2026-05-26T00:00:00.000Z",
  };
}

/** claim doc を 1 件作る。derivedFromNotes に source note ID を持たせる。 */
function makeClaimDoc(id: string, title: string, noteIds: string[]): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    source: "ai",
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: noteIds,
      derivedFromChats: [],
      generatedAt: "2026-05-26T00:00:00.000Z",
      lastIngestedAt: "2026-05-26T00:00:00.000Z",
      generatedBy: { model: "test", version: "1.0.0" },
    },
    createdAt: "2026-05-26T00:00:00.000Z",
    modifiedAt: "2026-05-26T00:00:00.000Z",
  };
}

type Fixture = {
  wikiFiles: GraphiumFile[];
  wikiMetas: Map<string, WikiMetaSummary>;
  getCachedDoc: (key: string) => GraphiumDocument | undefined;
};

/** atom[] と claim[] の宣言から fixture をビルドする。
 *  各 atom: [id, atomType, sourceClaimIds]
 *  各 claim: [id, sourceNoteIds]
 */
function buildFixture(
  atoms: Array<[string, AtomType, string[]]>,
  claims: Array<[string, string[]]>,
): Fixture {
  const wikiFiles: GraphiumFile[] = [];
  const wikiMetas = new Map<string, WikiMetaSummary>();
  const docs = new Map<string, GraphiumDocument>();

  for (const [id, atomType, claimIds] of atoms) {
    wikiFiles.push({ id, name: `atom ${id}`, modifiedTime: "", createdTime: "" });
    wikiMetas.set(id, { title: `atom ${id}`, kind: "atom", atomType });
    docs.set(`wiki:${id}`, makeAtomDoc(id, `atom ${id}`, atomType, claimIds));
  }
  for (const [id, noteIds] of claims) {
    wikiFiles.push({ id, name: `claim ${id}`, modifiedTime: "", createdTime: "" });
    wikiMetas.set(id, { title: `claim ${id}`, kind: "claim" });
    docs.set(`wiki:${id}`, makeClaimDoc(id, `claim ${id}`, noteIds));
  }
  return {
    wikiFiles,
    wikiMetas,
    getCachedDoc: (key) => docs.get(key),
  };
}

describe("computeTenpaiHints", () => {
  it("returns no hints when total atom count is below TENPAI_MIN_ATOM_COUNT", () => {
    // 5 atom (6 未満) → 無音
    const fx = buildFixture(
      [
        ["a1", "causal", ["c1"]],
        ["a2", "mechanistic", ["c1"]],
        ["a3", "mechanistic", ["c1"]],
        ["a4", "methodological", ["c1"]],
        ["a5", "methodological", ["c1"]],
      ],
      [["c1", ["n1"]]],
    );
    const hints = computeTenpaiHints({ ...fx, now: "T" });
    expect(hints).toEqual([]);
  });

  it("returns no hints when no note cluster has >= TENPAI_MIN_ATOM_COUNT atoms", () => {
    // 6 atom 全体だが、各 note クラスター 3 atom ずつ → クラスター単位で無音
    const fx = buildFixture(
      [
        ["a1", "causal", ["c1"]],
        ["a2", "mechanistic", ["c1"]],
        ["a3", "mechanistic", ["c1"]],
        ["a4", "causal", ["c2"]],
        ["a5", "mechanistic", ["c2"]],
        ["a6", "mechanistic", ["c2"]],
      ],
      [
        ["c1", ["n1"]],
        ["c2", ["n2"]],
      ],
    );
    const hints = computeTenpaiHints({ ...fx, now: "T" });
    expect(hints).toEqual([]);
  });

  it("fires a dialectic tenpai when a note cluster has exactly 1 causal atom and >= 6 total", () => {
    // 1 note に 6 atom (causal=1, mechanistic=3, methodological=2) → dialectic 発火
    const fx = buildFixture(
      [
        ["causal1", "causal", ["c1"]],
        ["mech1", "mechanistic", ["c1"]],
        ["mech2", "mechanistic", ["c1"]],
        ["mech3", "mechanistic", ["c1"]],
        ["meth1", "methodological", ["c1"]],
        ["meth2", "methodological", ["c1"]],
      ],
      [["c1", ["n1"]]],
    );
    const hints = computeTenpaiHints({ ...fx, now: "T" });
    expect(hints).toHaveLength(1);
    expect(hints[0].mode).toBe("dialectic");
    expect(hints[0].involvedAtoms.map((a) => a.id)).toEqual(["causal1"]);
    expect(hints[0].generatedAt).toBe("T");
  });

  it("dedupes hints when the same causal atom appears in multiple note clusters", () => {
    // 同じ causal atom を 2 note が共有 → 両クラスターで dialectic 候補
    // → 同じ hint id (mode + atomIds) で dedupe → 1 件のみ
    // 各クラスターを TENPAI_MIN_ATOM_COUNT=6 以上にするため methodological を増やす
    const fx = buildFixture(
      [
        ["causal1", "causal", ["c1", "c2"]], // c1/c2 両方の source claim
        ["m1", "mechanistic", ["c1"]],
        ["m2", "mechanistic", ["c1"]],
        ["m3", "mechanistic", ["c1"]],
        ["meth1", "methodological", ["c1"]],
        ["meth2", "methodological", ["c1"]],
        ["m4", "mechanistic", ["c2"]],
        ["m5", "mechanistic", ["c2"]],
        ["m6", "mechanistic", ["c2"]],
        ["meth3", "methodological", ["c2"]],
        ["meth4", "methodological", ["c2"]],
      ],
      [
        ["c1", ["n1"]], // n1 cluster: causal1, m1, m2, m3, meth1, meth2 (6)
        ["c2", ["n2"]], // n2 cluster: causal1, m4, m5, m6, meth3, meth4 (6)
      ],
    );
    const hints = computeTenpaiHints({ ...fx, now: "T" });
    // n1 と n2 のクラスターが両方とも causal=1 → 2 候補出るが atom id 同じなので 1 件
    expect(hints).toHaveLength(1);
    expect(hints[0].mode).toBe("dialectic");
    expect(hints[0].involvedAtoms.map((a) => a.id)).toEqual(["causal1"]);
  });

  it("fires multiple distinct hints when different note clusters have different causal atoms", () => {
    const fx = buildFixture(
      [
        ["causalA", "causal", ["c1"]],
        ["mA1", "mechanistic", ["c1"]],
        ["mA2", "mechanistic", ["c1"]],
        ["mA3", "mechanistic", ["c1"]],
        ["methA1", "methodological", ["c1"]],
        ["methA2", "methodological", ["c1"]],
        ["causalB", "causal", ["c2"]],
        ["mB1", "mechanistic", ["c2"]],
        ["mB2", "mechanistic", ["c2"]],
        ["mB3", "mechanistic", ["c2"]],
        ["methB1", "methodological", ["c2"]],
        ["methB2", "methodological", ["c2"]],
      ],
      [
        ["c1", ["n1"]],
        ["c2", ["n2"]],
      ],
    );
    const hints = computeTenpaiHints({ ...fx, now: "T" });
    expect(hints).toHaveLength(2);
    expect(hints.map((h) => h.mode)).toEqual(["dialectic", "dialectic"]);
    const atomIds = hints.flatMap((h) => h.involvedAtoms.map((a) => a.id));
    expect(atomIds).toEqual(expect.arrayContaining(["causalA", "causalB"]));
  });

  it("falls back to wikiFile.name when cached doc is missing", () => {
    // doc cache が空でも atomEntries 構築は走るが、derivedFromClaims が取れないので
    // sourceNotes は空 → どのクラスターにも入らず → 0 件
    const wikiFiles: GraphiumFile[] = Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`,
      name: `name-${i}`,
      modifiedTime: "",
      createdTime: "",
    }));
    const wikiMetas = new Map<string, WikiMetaSummary>(
      wikiFiles.map((f, i) => [
        f.id,
        { title: f.name, kind: "atom" as const, atomType: (i === 0 ? "causal" : "mechanistic") as AtomType },
      ]),
    );
    const hints = computeTenpaiHints({
      wikiFiles,
      wikiMetas,
      getCachedDoc: () => undefined, // 全 cache miss
      now: "T",
    });
    expect(hints).toEqual([]);
  });

  it("uses provided `now` for generatedAt timestamp", () => {
    const fx = buildFixture(
      [
        ["causal1", "causal", ["c1"]],
        ["m1", "mechanistic", ["c1"]],
        ["m2", "mechanistic", ["c1"]],
        ["m3", "mechanistic", ["c1"]],
        ["meth1", "methodological", ["c1"]],
        ["meth2", "methodological", ["c1"]],
      ],
      [["c1", ["n1"]]],
    );
    const hints = computeTenpaiHints({ ...fx, now: "2030-01-01T00:00:00.000Z" });
    expect(hints[0].generatedAt).toBe("2030-01-01T00:00:00.000Z");
  });
});
