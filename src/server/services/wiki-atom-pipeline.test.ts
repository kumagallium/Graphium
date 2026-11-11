import { describe, expect, it } from "vitest";

import {
  applyFoldVerdicts,
  applyReinforceVerdicts,
  buildReinforceJudgeMessage,
  parseAtomizeReinforcements,
  planReinforceJudge,
  applyReliftRewrites,
  applyTransferVerdicts,
  buildAtomizePrompt,
  parseAtomizeOutput,
  planFoldJudge,
  planReliftAll,
  planReliftResidual,
  planReliftWithHints,
  planTransferJudge,
} from "./wiki-atom-pipeline.js";
import { buildAtomizerSystemPrompt, buildAtomizerUserMessage, type AtomCandidate } from "./wiki-atomizer.js";
import type { ClaimSnapshot } from "./wiki-types.js";

const concepts: ClaimSnapshot[] = [
  { id: "c1", title: "知見1", bodyPreview: "本文1", relatedClaims: [], epistemicStatus: "observation", rebuttalConditions: ["r"] },
  { id: "c2", title: "知見2", bodyPreview: "本文2", relatedClaims: [], epistemicStatus: "speculation", rebuttalConditions: ["r2"] },
  { id: "c3", title: "知見3", bodyPreview: "本文3", relatedClaims: [] },
];

const atom = (over: Partial<AtomCandidate>): AtomCandidate => ({
  title: "題",
  body: "本文",
  derivedFromClaims: ["c1"],
  derivedFromConceptTitles: ["知見1"],
  confidence: 0.8,
  ...over,
});

describe("buildAtomizePrompt / parseAtomizeOutput", () => {
  it("atomizer のプロンプト関数と同じ文を返す", () => {
    const p = buildAtomizePrompt(concepts, ["既存"], "ja");
    expect(p.systemPrompt).toBe(buildAtomizerSystemPrompt("ja"));
    expect(p.userMessage).toBe(buildAtomizerUserMessage(concepts, ["既存"]));
    expect(buildAtomizePrompt(concepts, [], "").systemPrompt).toBe(buildAtomizerSystemPrompt("en"));
  });

  it("配っていない id は落ち、status は最低継承・rebuttal は 2 件以上で伝播する", () => {
    const out = parseAtomizeOutput(
      JSON.stringify({ atoms: [{ title: "T", body: "B", sourceConceptIds: ["c1", "c2", "x"], rebuttalConditions: ["共通"] }, { title: "U", body: "V", sourceConceptIds: ["x"] }] }),
      concepts,
    );
    expect(out).toHaveLength(1);
    expect(out[0].derivedFromClaims).toEqual(["c1", "c2"]);
    expect(out[0].epistemicStatus).toBe("speculation");
    expect(out[0].rebuttalConditions).toEqual(["共通"]);
  });
});

describe("transfer / fold / relift の計画と適用", () => {
  it("transfer: 答えが無い・妥当でない・ジャッジ失敗は外し、妥当なものだけ残す", () => {
    const atoms = [
      atom({ title: "a", transfer: { field: "f", example: "e" } }),
      atom({ title: "b" }),
      atom({ title: "c", transfer: { field: "f2", example: "e2" } }),
    ];
    const plan = planTransferJudge(atoms);
    expect(plan.targets).toEqual([0, 2]);
    const kept = applyTransferVerdicts(atoms, plan, [{ index: 1, valid: true, reason: "" }, { index: 2, valid: false, reason: "" }]);
    expect(kept[0].transfer).toBeDefined();
    expect(kept[2].transfer).toBeUndefined();
    expect(applyTransferVerdicts(atoms, plan, []).every((a) => !a.transfer)).toBe(true);
    expect(applyTransferVerdicts(atoms, plan, null).every((a) => !a.transfer)).toBe(true);
    // 元の配列は書き換えない
    expect(atoms[0].transfer).toBeDefined();
  });

  it("fold: 部分集合に絞って foldDroppedClaims を残す。答えが無ければそのまま（fail-open）", () => {
    const atoms = [atom({ derivedFromClaims: ["c1", "c2", "c3"], derivedFromConceptTitles: ["知見1", "知見2", "知見3"] }), atom({})];
    const plan = planFoldJudge(atoms, concepts);
    expect(plan.targets).toEqual([{ atomIndex: 0, ids: ["c1", "c2", "c3"] }]);
    expect(plan.items[0].claims[1]).toEqual({ id: "c2", title: "知見2", preview: "本文2" });
    const out = applyFoldVerdicts(atoms, plan, [{ index: 1, coherentClaimIds: ["c1", "c3", "送っていない"], reason: "" }], concepts);
    expect(out[0].derivedFromClaims).toEqual(["c1", "c3"]);
    expect(out[0].derivedFromConceptTitles).toEqual(["知見1", "知見3"]);
    expect(out[0].foldDroppedClaims).toBe(1);
    expect(applyFoldVerdicts(atoms, plan, [], concepts)[0].derivedFromClaims).toHaveLength(3);
    expect(applyFoldVerdicts(atoms, plan, null, concepts)[0].derivedFromClaims).toHaveLength(3);
  });

  it("relift: 1 パス目は全洞察、2 パス目は式・略語を検出した洞察だけ。ヒントつきは全洞察に jargon を添える", () => {
    const atoms = [atom({ title: "ふつうの題", body: "ふつうの本文" }), atom({ title: "Sr3Al2Ge2 の性質", body: "SPS で焼結する" })];
    expect(planReliftAll(atoms).map((t) => t.atomIndex)).toEqual([0, 1]);
    expect(planReliftAll(atoms).every((t) => t.jargon.length === 0)).toBe(true);
    const residual = planReliftResidual(atoms);
    expect(residual.map((t) => t.atomIndex)).toEqual([1]);
    expect(residual[0].jargon.length).toBeGreaterThan(0);
    const hinted = planReliftWithHints(atoms);
    expect(hinted.map((t) => t.atomIndex)).toEqual([0, 1]);
    expect(hinted[0].jargon).toEqual([]);
    expect(hinted[1].jargon).toEqual(residual[0].jargon);

    // index 1 の答えだけ → 1 件目だけ差し替わり、2 件目は元の文のまま
    const out = applyReliftRewrites(atoms, hinted, [{ index: 1, title: "平易な題", body: "平易な本文" }]);
    expect(out[0].title).toBe("平易な題");
    expect(out[1].title).toBe("Sr3Al2Ge2 の性質");
    // title か body が空の答えは差し替えない
    expect(applyReliftRewrites(atoms, hinted, [{ index: 1, title: "", body: "x" }])[0].title).toBe("ふつうの題");
  });
});

describe("buildAtomizePrompt — 既存の洞察の 2 つの形", () => {
  it("題だけなら従来の一覧、{id,title} なら ref つきの一覧", () => {
    expect(buildAtomizePrompt(concepts, ["既存の題"], "ja").userMessage).toContain("- 既存の題");
    const withRef = buildAtomizePrompt(concepts, [{ id: "x1", title: "既存の題" }], "ja");
    expect(withRef.userMessage).toContain("- [a1] 既存の題");
    expect(withRef.systemPrompt).toContain("reinforcements");
  });
});

describe("parseAtomizeReinforcements / planReinforceJudge / applyReinforceVerdicts — 補強", () => {
  const existing = [
    { id: "x1", title: "洞察1" },
    { id: "x2", title: "洞察2" },
  ];
  const text = JSON.stringify({
    atoms: [],
    reinforcements: [
      { atomRef: "a1", sourceConceptIds: ["c1", "c2"] },
      { atomRef: "a2", sourceConceptIds: ["c3", "nope"] },
    ],
  });
  const load = (id: string) => ({ id, title: `題-${id}`, shape: "s", body: `本文-${id}` });

  it("配った束の知見 id だけを通して申し出を読む", () => {
    expect(parseAtomizeReinforcements(text, concepts, existing)).toEqual([
      { atomId: "x1", claimIds: ["c1", "c2"] },
      { atomId: "x2", claimIds: ["c3"] },
    ]);
  });

  it("読めない洞察（null）・束に無い知見だけの申し出は審査に出さない", () => {
    const plan = planReinforceJudge(
      [
        { atomId: "x1", claimIds: ["c1", "ghost"] },
        { atomId: "gone", claimIds: ["c2"] },
        { atomId: "x2", claimIds: ["ghost"] },
      ],
      (id) => (id === "gone" ? null : load(id)),
      concepts,
    );
    expect(plan.targets).toEqual([{ atomId: "x1", claimIds: ["c1"] }]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ title: "題-x1", shape: "s", body: "本文-x1" });
    expect(plan.items[0].claims).toEqual([{ id: "c1", title: "知見1", preview: "本文1" }]);
  });

  it("buildReinforceJudgeMessage は審査の本文を組む", () => {
    const plan = planReinforceJudge([{ atomId: "x1", claimIds: ["c1"] }], load, concepts);
    const msg = buildReinforceJudgeMessage(plan);
    expect(msg).toContain('[1] existing Atom: "題-x1"');
    expect(msg).toContain("(id: c1)");
  });

  const plan2 = () =>
    planReinforceJudge(
      [
        { atomId: "x1", claimIds: ["c1", "c2"] },
        { atomId: "x2", claimIds: ["c3"] },
      ],
      load,
      concepts,
    );

  it("審査が確かめた id のうち、出した id の部分集合だけ残す（出していない id は無視）", () => {
    const r = applyReinforceVerdicts(plan2(), [
      { index: 1, coherentClaimIds: ["c2", "other"], reason: "" },
      { index: 2, coherentClaimIds: ["c3"], reason: "" },
    ]);
    expect(r).toEqual([
      { atomId: "x1", claimIds: ["c2"] },
      { atomId: "x2", claimIds: ["c3"] },
    ]);
  });

  it("答えが無い申し出・空の答え・verdicts が null は捨てる（fail-closed。先頭 1 件への縮退はしない）", () => {
    expect(applyReinforceVerdicts(plan2(), null)).toEqual([]);
    expect(applyReinforceVerdicts(plan2(), [{ index: 2, coherentClaimIds: ["c3"], reason: "" }])).toEqual([
      { atomId: "x2", claimIds: ["c3"] },
    ]);
    expect(applyReinforceVerdicts(plan2(), [{ index: 1, coherentClaimIds: [], reason: "" }])).toEqual([]);
  });

  it("確認 0 件（targets が空）は空", () => {
    const empty = planReinforceJudge([], load, concepts);
    expect(applyReinforceVerdicts(empty, [{ index: 1, coherentClaimIds: ["c1"], reason: "" }])).toEqual([]);
  });

  it("index が合わないときは位置で対応する", () => {
    const r = applyReinforceVerdicts(plan2(), [
      { index: 0, coherentClaimIds: ["c1"], reason: "" },
      { index: 0, coherentClaimIds: ["c3"], reason: "" },
    ]);
    expect(r).toEqual([
      { atomId: "x1", claimIds: ["c1"] },
      { atomId: "x2", claimIds: ["c3"] },
    ]);
  });
});
