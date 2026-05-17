// Phase μ-1: bench 共通の型定義
//
// runner / metrics / judge / report / compare で共有する。
// pipeline 出力は実 LLM (live mode) と dry-run mock の両方で互換性を保つ。

export type BenchProfile =
  | "baseline"
  | "with-alpha"
  | "with-alpha-beta"
  | "with-alpha-beta-eta"
  | "with-alpha-beta-eta-gamma"
  | "with-alpha-beta-eta-gamma-delta"
  | "with-alpha-beta-eta-gamma-delta-epsilon"
  | "with-alpha-beta-eta-gamma-delta-epsilon-zeta";

export type CorpusCategory =
  | "clean-lab"
  | "clean-software"
  | "casual-musing"
  | "wrong-speculation"
  | "cross-domain-pair"
  | "contradiction-pair"
  | "pure-observation";

export type CorpusNote = {
  noteId: string;
  category: CorpusCategory;
  language: "ja" | "en";
  title: string;
  body: string;
  pairId?: string;
};

export type GroundTruth = {
  noteId: string;
  expected: {
    claimCount?: { min?: number; max?: number };
    claimRoles?: string[];
    epistemicStatus?: string[];
    atomLiftLevel?: "rung-0" | "rung-1" | "rung-2";
    rebuttalConditionsCount?: number;
    synthesisMode?: string[];
  };
  notes?: string;
};

export type Probe = {
  name: string;
  inputs: string[];
  expected: Record<string, unknown>;
  rationale: string;
};

// パイプライン中間出力。実 LLM / dry-run mock の両方で同じ shape を出す。
export type BenchClaim = {
  sourceNoteId: string;
  title: string;
  body: string;
  claimRoles: string[];
  epistemicStatus: string; // Phase μ-1 では heuristic で推定（Phase η で正式採用）
  rebuttalConditions: string[];
  modalQualifier?: string;
};

export type BenchAtom = {
  title: string;
  body: string;
  atomType?: string;
  derivedFromClaims: string[]; // source claim 配列のインデックス参照
  derivedFromNoteIds: string[];
  epistemicStatus: string; // 入力 Claim の最低 status
  liftLevel: "rung-0" | "rung-1" | "rung-2";
};

export type BenchSynthesis = {
  title: string;
  body: string;
  mode: "deductive" | "abductive" | "analogical" | "dialectic";
  sourceAtomIndices: number[];
  hypothesisStatus: "speculative" | "tested" | "confirmed" | "refuted";
  externalSources: { title: string; url?: string }[];
};

export type BenchPipelineOutput = {
  noteId: string;
  claims: BenchClaim[];
};

export type BenchRunOutput = {
  profile: BenchProfile;
  mode: "live" | "dry-run";
  modelId: string;
  modelProvider: string;
  judge?: { kind: "heuristic" | "live"; provider: string; modelId: string; modelName: string };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  corpusSize: number;
  probeCount: number;
  pipelineByNote: BenchPipelineOutput[];
  allClaims: BenchClaim[];
  allAtoms: BenchAtom[];
  allSyntheses: BenchSynthesis[];
  metrics: BenchMetrics;
  probeResults: ProbeResult[];
  liftJudgments?: { passed: boolean; reason: string; atomTitle: string }[];
  noveltyJudgments?: { passed: boolean; reason: string; synthesisTitle: string }[];
  notes: string[];
};

export type BenchMetrics = {
  lift_score: number;
  mode_distribution_entropy: number;
  epistemic_preservation: number;
  adversarial_pass_rate: number;
  novelty_score: number;
  // 補助統計
  claim_count_total: number;
  atom_count_total: number;
  synthesis_count_total: number;
  observation_atom_ratio: number;
};

export type ProbeResult = {
  name: string;
  passed: boolean;
  reason: string;
};
