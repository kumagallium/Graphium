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
  | "pure-observation"
  // Phase μ-2 additions: cross-language + cross-domain expansion
  | "clean-en-technical"
  | "casual-musing-en"
  | "bio-note"
  | "econ-note"
  | "humanities-note"
  | "cross-language-pair";

// Phase μ-2: ドメインタグ。domain_balance_score の集計で使う。
// 既存ノートは category から後方互換的に推定できるが、新規ノートは明示する。
export type CorpusDomain =
  | "materials"
  | "software"
  | "biology"
  | "economics"
  | "humanities"
  | "misc";

export type CorpusNote = {
  noteId: string;
  category: CorpusCategory;
  language: "ja" | "en";
  title: string;
  body: string;
  /** cross-domain-pair / cross-language-pair の対応関係を示す ID */
  pairId?: string;
  /** Phase μ-2 で追加。未指定なら category から推定（後方互換）。 */
  domain?: CorpusDomain;
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
  /**
   * Toulmin Backing（Phase γ）。Ingester が抽出した教科書 / 外部論文 / 内部 Claim
   * 裏付け配列。dry-run / heuristic では空。live mode で Ingester 出力から拾う。
   */
  backing?: { source: string; citation: string; url?: string; internalClaimId?: string }[];
};

export type BenchAtom = {
  title: string;
  body: string;
  atomType?: string;
  derivedFromClaims: string[]; // source claim 配列のインデックス参照
  derivedFromNoteIds: string[];
  epistemicStatus: string; // 入力 Claim の最低 status
  liftLevel: "rung-0" | "rung-1" | "rung-2";
  /** Phase γ: 2+ Claim 共通の Toulmin Rebuttal を Atom 層に伝播したもの（atomizer 出力から拾う） */
  rebuttalConditions?: string[];
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
  /** 実行した独立サンプル数（n=3 averaging）。1 なら従来の単発実行。 */
  n: number;
  /** 代表サンプル（median 採用 run）の生データ。1ノートあたりの Claim 一覧。 */
  pipelineByNote: BenchPipelineOutput[];
  allClaims: BenchClaim[];
  allAtoms: BenchAtom[];
  allSyntheses: BenchSynthesis[];
  /** 集約後の代表値（n=1 なら唯一の run、n≥2 なら下記 aggregate に従う） */
  metrics: BenchMetrics;
  probeResults: ProbeResult[];
  liftJudgments?: { passed: boolean; reason: string; atomTitle: string }[];
  noveltyJudgments?: { passed: boolean; reason: string; synthesisTitle: string }[];
  /** n≥2 の場合のみ。各 run の素の metric を残し、ばらつき判断に使える。 */
  runs?: BenchRunSample[];
  /** n≥2 の場合のみ。代表 metric の決め方と分布の要約を残す。 */
  aggregate?: BenchAggregate;
  notes: string[];
};

/** 1 サンプル分の素データ。代表 run の pipelineByNote 等は BenchRunOutput 側に残す。 */
export type BenchRunSample = {
  index: number;            // 0-based
  startedAt: string;
  durationMs: number;
  metrics: BenchMetrics;
  probePassCount: number;   // probeResults は LLM stub 抜きなので冗長を避けて件数のみ
};

/** metric ごとに median / mean / min / max を残す。代表値 (metrics) と等価ではない: aggregate.statistic で示す */
export type BenchAggregate = {
  /** 代表値の選び方。"median" がデフォルト */
  statistic: "median" | "mean";
  /** 代表値が n run のうち何番目の run のものか（パイプライン素データの選定基準） */
  representativeRunIndex: number;
  /** メトリクスごとの分布。runs.length と同じ長さの配列 */
  distribution: Record<keyof BenchMetrics, BenchMetricSummary>;
};

export type BenchMetricSummary = {
  median: number;
  mean: number;
  min: number;
  max: number;
  /** ばらつきの読み取りやすさのため、絶対範囲 (max - min) も持っておく */
  range: number;
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
  // Phase μ-2 で追加
  /** 同一概念の JP / EN ペア (pairId) が同じ Atom クラスタに集約された割合 */
  cross_language_consistency: number;
  /** 全ドメインで発見品質 (lift × novelty × epistemic_preservation の domain 別積) が均等な度合い */
  domain_balance_score: number;
};

export type ProbeResult = {
  name: string;
  passed: boolean;
  reason: string;
};
