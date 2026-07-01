// Graphium ドキュメントのドメイン型定義
// ストレージプロバイダーに依存しない、アプリケーション固有の型

import type { DocumentProvenance } from "../features/document-provenance/types";

// AI Wiki ドキュメントの種類
// summary  : 1 ノートに対する内部向け要約
// claim    : 複数ノート横断で抽出された事実ベースの主張（実施文脈をある程度残す）
//            ※ 旧名称 "concept" は事実層を哲学的概念のように誤読させていたため、
//              提案 v4 で「Claim（主張）」に改名した。旧 kind: "concept" は
//              document-migration の migrateConceptKindToClaim で自動移行される。
// atom     : 実験的レイヤ。Claim をさらに抽象化し、文脈を削いだ単一アイデア（Zettel atom）
// synthesis: 実験的レイヤ。Atom 同士の結合から立ち上がる新しい洞察
//
// experimental.atomLayer / experimental.synthesis 設定で生成可否を制御する。
// 既存ユーザーの synthesis ファイルは削除しないため、atom 同様に kind 文字列としては常に有効。
//
// 2026-05-23: Phase ε で導入した "meta-atom" を撤退。LLM が「軸を発明する」task は
// 構造的に苦手（領域 lifting / 概念発明が分布外）で、Anthropic Opus 4.7 でも品質が
// 領域内に閉じる結果が続いた。代替として「テーマを人間が与えて Synthesizer がそれを
// lens に書く」方向に舵を切る — その設計は別 PR で行う。撤退の窓が開いている
// （v0.9.0 以降にユーザーが meta-atom データを残していない）うちに kind ごと外す。
export type WikiKind = "summary" | "claim" | "atom" | "synthesis";

// Claim の抽象度レベル（claim のみで意味を持つ）
// principle: ノートが推論ステップで依拠した一般原理（教科書知識でも、本人の研究で実際に使われたもの）
// finding: 本人の経験から立ち上がった転用可能な命題
// bridge: 複数の finding を貫く抽象（後段の cross-update で生成）
export type ClaimLevel = "principle" | "finding" | "bridge";

// Claim の確度ステータス（principle で主に意味を持つ）
// candidate: 1 ノートのみで依拠されている。検索・retrieval 母集団には含むが UI では薄表示
// verified: 2 ノート以上で依拠された。「自分の研究で繰り返し効いている原理」
export type ClaimStatus = "candidate" | "verified";

// ──────────────────────────────────────────────
// 意味的な型（提案 v4 Phase 1）
//
// Claim / Atom / Synthesis に直交する別次元の「型」を導入する。
// 既存のコンテキストラベル（PROV-DM 存在論的役割）とは独立で、
// 思考の強制を避けるためユーザーには選択を強制せず、AI が自動推定する。
// すべて optional で、未指定でも従来通り動作する。
// ──────────────────────────────────────────────

// Claim の研究プロセス役割（文脈内で抽出された要素の「種類」）
// 複数値可（同じ Claim が finding でもあり question でもありうる）
export type ClaimRole =
  | "finding"          // 発見・観察: この文脈で観察された事実
  | "decision"         // 決定・選択: この文脈での選択とその理由
  | "anomaly"          // 予期せぬ事象: 予想外の観測・結果
  | "question"         // 残された問い: 文脈内で未解決の問い
  | "setup"            // 設定・条件: 実験・分析の前提条件
  | "interpretation"   // 解釈: 文脈内での暫定的意味付け
  | "issue";           // 課題・問題: 文脈内で気づいた問題

// Atom の推論的役割（文脈を剥がした主張の論理的性格）
export type AtomType =
  | "causal"           // 因果: X が Y を引き起こす／抑制する
  | "correlational"    // 相関: X と Y は共変動する（因果は主張しない）
  | "mechanistic"      // 機構: X は機構 M を通じて Y に至る
  | "conditional"      // 条件依存: 条件 C 下でのみ X は Y を引き起こす
  | "definitional"     // 定義・構造: X は Y という構造を持つ／に分類される
  | "methodological"   // 方法: X は Y を達成する手段である
  | "observational"    // 経験的観測: 実験で X が観測された（理論解釈なし）
  | "boundary";        // 限界・境界: X は Y の範囲では成立しない

// Atom の関係の「形」（構造写像の軸）。固定語彙＝LLM に発明させず分類させる。
// decompose→shape→abstract の中核。atomType（論理的性格）とは別軸。
export type AtomShape =
  | "monotonic-increase"      // X が増えるほど Y が増える
  | "monotonic-decrease"      // X が増えるほど Y が減る
  | "optimal-middle"          // Y は X の中間で最大（両極端は損）＝sweet spot
  | "threshold"               // X がある点を越えると Y が質的に切り替わる
  | "trade-off"               // X を得ると Y を失う（両立しない）
  | "enabling-condition"      // X が成り立って初めて Y が可能になる
  | "composition-structure"   // X の構成・構造が Y を決める
  // 循環（フィードバック）— 結果が原因に戻る構造。ペアワイズな依存とは別の位相で、
  // 越境類推の宝庫。増幅と打ち消しは正反対の動態なので分けて分類する（システム思考の R/B ループ）。
  | "reinforcing-loop"        // 結果が原因を増幅する自己強化の循環（好循環／悪循環）
  | "balancing-loop"          // 結果が変化を打ち消し均衡へ向かう自己調整の循環
  | "other";                  // 上記に当てはまらない

// Atom の越境転移（同じ shape+role 構造が成り立つ別分野）。
// atomizer が候補を出し、敵対的ジャッジが構造一致を検証して妥当なものだけ残す。
export type AtomTransfer = {
  /** 転移先の分野 */
  field: string;
  /** その分野で同じ形が成り立つ具体例（1 文） */
  example: string;
};

// Synthesis の推論モード
// 設計判断 (PR-B4): induction は Synthesis ではなく Claim → Atom 段の中核操作
// として位置付けた。Atomizer は「N 個の Claim にまたがる共通抽象を factor out」
// する discovery 層で、構造的に induction と同じ。Synthesizer はくびれを通った
// Atom を編む層なので、「複数の類似事例から一般則を立てる」のではなく、
// heterogeneous な要素から新しい繋がりを立ち上げるモードに専念する。
// 詳細は docs/inference-types.md を参照。
export type SynthesisMode =
  | "deductive"        // 演繹: 独立 Atom 群 → 組み合わせ戦略
  | "abductive"        // アブダクション: 観測 Atom + 既知則 Atom → 説明仮説
  | "analogical"       // 類推: 異領域 Atom 間の構造写像 → 転用仮説
  | "dialectic";       // 弁証法的止揚: 対立する Atom ペア → 上位枠組み

// Synthesis（特に abductive 型）の検証状態
export type HypothesisStatus =
  | "speculative"      // 推測の段階（デフォルト）
  | "tested"           // 検証中・部分的に裏付けあり
  | "confirmed"        // 検証済み（複数の独立した支持）
  | "refuted";         // 反証された

/**
 * 命題の認識論的ステータス（提案 v4 Phase η）。
 *
 * Claim / Atom が「どの程度確からしい根拠を持っているか」を構造化する。
 * 砂時計の各層を上がるにつれて、Atomizer は「入力 Claim の中で最も低い status を継承」する
 * ルールで status を伝搬する（lowest-status inheritance）。これにより、casual な
 * speculation が established な知識層に「癌細胞のように」混入することを構造的に防ぐ。
 *
 * - `speculation`  「〜のかも」「もしかして」など、根拠なしの musing
 * - `interpretation` 観察の解釈、tentative な mechanism 提案
 * - `observation`  観察された事実（PROV 構造あり）
 * - `established` 複数 source 確認 / 外部文献裏付け
 *
 * 順序（低 → 高）: speculation < interpretation < observation < established
 * 「不明な場合は低い側に倒す」が保守的なデフォルト。
 */
export type EpistemicStatus =
  | "speculation"
  | "interpretation"
  | "observation"
  | "established";

/** EpistemicStatus の順序付け（最低継承の比較に使う） */
export const EPISTEMIC_STATUS_ORDER: EpistemicStatus[] = [
  "speculation",
  "interpretation",
  "observation",
  "established",
];

// ──────────────────────────────────────────────
// Toulmin extension（Phase γ）
//
// Toulmin (1958) の 6 要素のうち、現状で欠落している
//   Rebuttal（反例条件 / Claim が破綻する regime）
//   Backing（Warrant の裏付け、教科書知識 / 外部論文 / 内部 Claim）
//   Modal qualifier（ユーザー主観的な確からしさの程度）
// を Claim / Atom スキーマに明示フィールドとして追加する。
//
// 既存ユーザーへの影響: 全て optional。Phase γ 以前に生成された Claim / Atom は
// undefined のまま読み取り可能で、UI / Synthesizer 側は空配列 / undefined を
// 「情報なし」として扱う。
// ──────────────────────────────────────────────

/**
 * Warrant の裏付け（Toulmin の Backing）。
 *
 * externalReferences との違い:
 *   externalReferences = Claim 自体の根拠（measurement / paper that observed it）
 *   backing            = Claim を支える Warrant（inferential rule）の根拠
 *
 * 例: Claim「塩基性条件で酸化膜還元の律速段階が切り替わる」に対して、
 *   backing = { source: "textbook", citation: "Marcus 理論の電子移動律速の原理" }
 *   externalReferences = { url: "...", citation: "速度を測定した論文" }
 */
export type BackingEntry = {
  /** "textbook" | "external-paper" | "internal-claim" */
  source: string;
  /** 一文での説明 */
  citation: string;
  /** 外部参照の URL（任意） */
  url?: string;
  /** 内部 Claim を Warrant 根拠として参照する場合の ID */
  internalClaimId?: string;
};

/**
 * 確からしさの程度（Toulmin の Modal qualifier）。
 *
 * `confidence`（system 側の自己評価, 0-1）と異なり、
 * ノートの言語表現から推定したユーザー主観的な確からしさ。
 */
export type ModalQualifier =
  | "necessarily" // 「必ず」「必然的に」「常に」
  | "probably" // 「おそらく」「だいたい」「ほぼ」
  | "possibly" // 「かもしれない」「可能性がある」
  | "rarely"; // 「まれに」「ごく一部で」

export const MODAL_QUALIFIER_VALUES: ModalQualifier[] = [
  "necessarily",
  "probably",
  "possibly",
  "rarely",
];

/** BackingEntry.source として認める値（fixed vocabulary）。 */
export const BACKING_SOURCE_VALUES = [
  "textbook",
  "external-paper",
  "internal-claim",
] as const;
export type BackingSource = (typeof BACKING_SOURCE_VALUES)[number];

/**
 * Phase δ: Atom 間の dimensional 関係（GT 流の axial coding 補完）。
 *
 * 設計意図: Atom が単独で島になることを防ぎ、Synthesizer の analogical モードが
 * 「同じ relation で結ばれた cross-domain ペア」を効率的に発見できるようにする。
 *
 * relation の意味:
 * - extends: 既存 Atom を一般化 / 細分化する
 * - is-special-case-of: 既存 Atom の特殊ケースである
 * - shares-mechanism: 同じ機構を別現象で実現している
 * - shares-precondition: 同じ前提条件が要る別現象
 * - contradicts: 同じ axis 上で逆向きの主張
 * - applies-to-different-domain: 構造同型を別領域で観察した analogical pair
 */
export const ATOM_RELATION_TYPE_VALUES = [
  "extends",
  "is-special-case-of",
  "shares-mechanism",
  "shares-precondition",
  "contradicts",
  "applies-to-different-domain",
] as const;
export type AtomRelationType = (typeof ATOM_RELATION_TYPE_VALUES)[number];

/**
 * Atom 間の関係エントリ。
 *
 * `atomId` は内部 ID（WikiMeta 上の Atom）を指す。存在しない / アーカイブ済みの ID は
 * UI 側で「不明」フォールバック扱いになる（DerivedFromSection と同じ流儀）。
 * `citation` は 1 文以内で関係を説明する自然言語（quality-over-quantity ルール）。
 */
export type AtomRelation = {
  atomId: string;
  relationType: AtomRelationType;
  citation: string;
};

export function epistemicRank(status: EpistemicStatus | undefined): number {
  if (!status) return 1; // unknown は interpretation 相当に倒す
  const idx = EPISTEMIC_STATUS_ORDER.indexOf(status);
  return idx < 0 ? 1 : idx;
}

/**
 * 複数の status から最低を返す（Atomizer / Synthesizer の lowest-status inheritance）。
 * 入力が空なら "interpretation" を返す（中立的な保守デフォルト）。
 */
export function lowestEpistemicStatus(
  statuses: (EpistemicStatus | undefined)[],
): EpistemicStatus {
  let lowest: EpistemicStatus = "established";
  let lowestRank = epistemicRank(lowest);
  let seen = false;
  for (const s of statuses) {
    if (!s) continue;
    seen = true;
    const r = epistemicRank(s);
    if (r < lowestRank) {
      lowestRank = r;
      lowest = s;
    }
  }
  return seen ? lowest : "interpretation";
}

// 主張が依存する手順条件（再現性の骨格）
// PROV 構造を「最後まで剥がさない再現性骨格」として保持する。
// AI が生成時に推定し、後で引用される際に「どんな手順条件下で成立するか」を即座に分かる形にする。
export type KeyParameter = {
  name: string;                           // 例: "機械合金化時間"
  value: string;                          // 例: "3h"（Phase A は文字列、正規化は Phase B 以降）
  necessity: "critical" | "important" | "incidental"; // この主張への影響度
};

export type ProcedureContext = {
  /** 由来 Note の ID リスト（WikiMeta.derivedFromNotes と重複する場合あり） */
  derivedFromNotes: string[];
  /** 主要ステップを列挙した手順指紋（自然言語、例: "機械合金化 → SPS焼結"） */
  protocolFingerprint?: string;
  /** 主張が依存する重要パラメータ */
  keyParameters?: KeyParameter[];
  /** 主張が依存する装置・手法 */
  keyTools?: string[];
  /** 主張が成立するパラメータ範囲（自然言語） */
  validityRange?: string;
};

// Skill（プロンプトテンプレート）のメタデータ
export type SkillMeta = {
  /** スキルの説明（一行） */
  description: string;
  /** Ingest 時に自動適用するか */
  availableForIngest: boolean;
  /** 作成日時 */
  createdAt: string;
  /**
   * システム同梱スキルの識別子（例: "default-voice-ja"）。
   * 設定されている場合、このスキルは削除不可・常に存在し、デフォルト内容にリセット可能。
   */
  systemSkillId?: string;
  /**
   * 適用対象の言語。"ja" | "en" を指定すると、生成側の言語と一致するときだけプロンプトに注入される。
   * 未指定の場合は全言語に適用（既存スキルとの後方互換）。
   */
  language?: "ja" | "en";
};

// AI Wiki ドキュメントのメタデータ
export type WikiMeta = {
  kind: WikiKind;
  /** 生成元ノート ID リスト */
  derivedFromNotes: string[];
  /** 生成元チャットセッション ID リスト */
  derivedFromChats: string[];
  /** ISO 8601 生成日時 */
  generatedAt: string;
  /** 生成に使用した LLM */
  generatedBy: {
    model: string;
    version: string;
  };
  /** 最後に Ingest を実行した日時 */
  lastIngestedAt?: string;
  /** Ingest 時に使用した Skill 名 */
  skillsUsed?: string[];
  /** 人間が編集したセクションの blockId リスト（Ingest 時の上書き保護用） */
  editedSections?: string[];
  /** セクション単位の embedding メタデータ */
  sectionEmbeddings?: {
    sectionId: string;
    modelVersion: string;
  }[];
  /** Wiki の生成言語 */
  language?: string;
  /** Claim の抽象度レベル（claim のみ） */
  level?: ClaimLevel;
  /** Claim の確度ステータス（principle で主に意味を持つ） */
  status?: ClaimStatus;
  /** principle が依拠していると判定された、ソースノート内の該当文（生成時の自己検証用） */
  evidenceSpan?: string;
  /** Atom が抽象化した元 Claim の ID リスト（atom のみ） */
  derivedFromClaims?: string[];
  /**
   * Cmd-K Composer の verb 取り込み（R2 / PR3）で、このノートが引用・精査した
   * 知見/洞察（claim/atom）ノートの ID リスト。
   *
   * `derivedFromClaims`（atom の再生成・グラフで atom 専用に解釈される）や
   * `derivedFromNotes`（regenerate が「通常ノート」前提で読む）とは**意味論が別**なので
   * 流用せず専用フィールドに持つ。読むのは PROV-JSON-LD エクスポートのみ（来歴の wasDerivedFrom
   * エッジを出すため）。既存リーダーには一切影響しない optional 追加。
   */
  citedKnowledgeIds?: string[];
  /** 生成時の自己評価された確度（0.0〜1.0）。主に Synthesis で誤差伝搬の指標として表示する */
  confidence?: number;

  // ── 意味的な型（提案 v4 Phase 1。すべて optional、後方互換維持） ──

  /** Claim の研究プロセス役割。複数可（同じ Claim が finding でもあり question でもありうる） */
  claimRole?: ClaimRole[];
  /** Atom の推論的役割 */
  atomType?: AtomType;
  /** Atom の関係の形（構造写像の軸、decompose→shape→abstract）。atom のみ意味を持つ */
  shape?: AtomShape;
  /** Atom の越境転移（敵対的ジャッジ検証済み。atom のみ。妥当な転移が無ければ undefined） */
  transfer?: AtomTransfer;
  /** Synthesis の推論モード */
  synthesisMode?: SynthesisMode;
  /** Synthesis の検証状態（特に abductive 型で意味を持つ） */
  hypothesisStatus?: HypothesisStatus;
  /**
   * Synthesis の「テーマ」(2026-05-23, theme-driven Synthesizer)。
   *
   * 人間がテーマ（「家庭料理」「組織」「学習」など）を与えると、Synthesizer は
   * そのテーマを lens に Atom 群を読み直してエッセイ風の発想を書き出す。これにより
   * 「軸を発明する」task を人間が担い、LLM は得意な「翻訳と執筆」だけを担当する分業に
   * なる（旧 meta-atom 層が解決できなかった lifting 問題への代替アプローチ）。
   *
   * 後方互換: theme なしで生成された旧 synthesis は `undefined`。UI は「テーマなし」
   * バケットに入れる。新規生成では原則 theme が付く（UI で必須入力）。
   *
   * 粒度は自由文（「家庭料理」級の気軽な分野ワードを想定）。タグ管理は localStorage
   * の履歴サジェストで吸収し、専用エンティティは設けない（フェーズ 1）。
   */
  theme?: string;
  /**
   * 命題の認識論的ステータス（Phase η）。Claim / Atom で主に意味を持つ。
   *
   * Ingester が Claim 生成時に推定し、Atomizer は「入力 Claim の中で最も低い
   * status を継承」する伝搬ルールに従う。Synthesizer は入力 Atom に speculation が
   * 含まれていれば、Synthesis の `hypothesisStatus` を speculative に強制する。
   *
   * undefined は Phase η 以前に生成された既存エントリでも動くようにするための
   * 後方互換チャネル。実行時には "interpretation" として扱う（保守デフォルト）。
   */
  epistemicStatus?: EpistemicStatus;
  /**
   * 主張が依存する手順条件（再現性の骨格、Phase 2.3）。
   *
   * **Claim でのみ意味を持つ** (PR-B4.5)。Atom は砂時計のくびれであり
   * context-stripped かつ domain-lifted を contract とするため
   * procedureContext は持たない。Synthesis も同様に持たない。
   * Atom / Synthesis から再現性骨格を辿りたい場合は、
   * `derivedFromNotes` / `derivedFromClaims` を経由して source Claim の
   * procedureContext を on-demand で参照する。
   */
  procedureContext?: ProcedureContext;
  /**
   * 反例条件（Toulmin の Rebuttal, Phase γ）。
   * Claim が破綻する条件、または「ただし」付きで限定される regime の自然言語列。
   * Claim と Atom の両方で意味を持つ。
   *
   * Atom への propagate ルール: 入力 Claim 群が **共通の** rebuttal を持つときだけ
   * 伝播する（2+ Claim に共通）。単一 Claim 由来の rebuttal は Claim 層に留める。
   *
   * 空配列 / undefined は「ノートに rebuttal の記述がない」を意味する。
   * LLM が無理に rebuttal を捻り出すことを禁じるため、デフォルトは空。
   */
  rebuttalConditions?: string[];
  /**
   * Warrant の裏付け（Toulmin の Backing, Phase γ）。
   * Claim を支える inferential rule の根拠（教科書 / 外部論文 / 内部 Claim）。
   * **Claim のみで意味を持つ**（Atom は context-stripped なので backing も剥がす）。
   */
  backing?: BackingEntry[];
  /**
   * 確からしさの程度（Toulmin の Modal qualifier, Phase γ）。
   * ノート言語表現から推定したユーザー主観的確からしさ。
   * **Claim のみで意味を持つ**。`confidence` (system 自己評価) とは別軸。
   */
  modalQualifier?: ModalQualifier;
  /**
   * Atom 間 dimensional 関係（Phase δ, axial coding 補完）。
   * Claim でも持ち得る（Claim → 既存 Atom への参照）が、現状は Atom スコープで
   * 抽出される。Synthesizer の analogical / dialectic 発火判定に使われる。
   * 0-3 件を quality-over-quantity で。空 / undefined は「関係なし」と等価。
   */
  relatedAtoms?: AtomRelation[];
  /**
   * 世界モデル照合の結果（world-model-grounding, Phase 2）。
   *
   * 別レーン契約: epistemicStatus / hypothesisStatus は読むだけで書き換えない。
   * 照合元（蒸留KB / モデル / 検索）が信号を返さなければ undefined のまま温存する。
   * 昇格を促す場合は `suggests` フィールドで提案表示するだけ。
   *
   * PR 2A スコープ: validity（蒸留KB ヒット時のみ）。novelty / quadrant / staleAfter は
   * Phase 5 で外部 retriever（ζ 統合）と一緒に解放する。
   */
  grounding?: GroundingProfile;
};

// ── World-model grounding (Phase 2) ──
// kickoff §1.1 / DESIGN_NOTE_world-model-grounding.ja.md を参照。
// 既存 epistemicStatus / hypothesisStatus とは別レーン。verdict 文字列に
// `established` が含まれるが epistemicStatus の `established` とは別軸・別意味。

export type GroundingValidityVerdict = "contested" | "weak" | "supported" | "established";

export type GroundingSource =
  // PR 2A: 蒸留KB のみ。PR 2B で kind: "model" / "search" を追加する。
  | { kind: "distilled"; ref: string; note?: string; url?: string };

export type GroundingProfile = {
  validity?: {
    /** 照合スコア（0..1）。retriever / モデルが返した raw score を保持する。 */
    score?: number;
    /** 照合結果の verdict。蒸留KB ヒットなし時は undefined のまま。 */
    verdict?: GroundingValidityVerdict;
    /** verdict 根拠の自然言語説明（教科書名・反証パターン等）。 */
    rationale?: string;
    /** 照合に使った情報源。PR 2A では `distilled` 種別のみ。 */
    sources?: GroundingSource[];
    /**
     * 蒸留 KB 照合で実際にヒットした keyword 一覧（PR 2A）。UI で「何がトリガーしたか」
     * を見せるための監査用フィールド。LLM fallback 経路は埋めなくてよい（undefined）。
     */
    matchedKeywords?: string[];
    /** 照合元の identity。PR 2A は "distilled-kb@v1" 固定。 */
    checkedBy?: string;
    /** 照合した時刻（ISO8601）。L3 鮮度判定や stale 表示に使う。 */
    checkedAt?: string;
    /**
     * 照合がヒット / 沈殿した KB エントリの ID（world-grounding edge）。
     * これが「洞察 → 世界事実」のエッジを成す: 同じ entryId を持つ洞察どうしは
     * 同じ世界知識に接続している。ここが「世界事実そのものを貯める」のではなく
     * 「自分の探究が世界と触れた境界」を記録する要——[[project_prov_graph_context]]。
     * verdict が null（判定不能・マッチなし）のときは undefined。
     */
    entryId?: string;
    /**
     * ユーザーが手動で照合結果を消した印（Phase 2）。`true` のとき:
     * - 一覧 verdict 列・バナーには何も出さない（未照合と同じ見た目）
     * - 自動照合の対象から外す（「消した＝自動で付け直してほしくない」を尊重）
     * 手動「世界照合」で再照合すると新しい validity に置き換わり dismissed は消える。
     * 「未照合（grounding 自体が無い）」と「あえて消した」を区別するためのフラグ。
     */
    dismissed?: boolean;
  };
  /**
   * 既存 status への作用は「提案」のみ。
   * hypothesisStatus / epistemicStatus を grounding が書き換えてはいけない（別レーン）。
   */
  suggests?: {
    field: "hypothesisStatus" | "epistemicStatus";
    to: string;
    reason: string;
  };
};

/**
 * 一覧 UI と Snapshot ビルダーが共通で使う wiki メタの軽量サマリ。
 * doc 全体ではなく頻繁にアクセスする最小限のフィールドだけを保持する。
 */
export type WikiMetaSummary = {
  title: string;
  kind: WikiKind;
  /** 書記役 LLM のモデル ID (例: claude-opus-4-7) */
  model?: string;
  /** Claim のときのみ意味を持つ抽象度レベル */
  level?: ClaimLevel;
  /** Claim / Atom の認識論的ステータス（Phase η） */
  epistemicStatus?: EpistemicStatus;
  /** principle のときのみ意味を持つ確度ステータス */
  status?: ClaimStatus;
  /** Claim の研究プロセス役割（複数可） */
  claimRole?: ClaimRole[];
  /** Atom の推論的役割 */
  atomType?: AtomType;
  /** Synthesis の推論モード */
  synthesisMode?: SynthesisMode;
  /**
   * Synthesis のテーマ（人間が指定した lens）。
   * 2026-05-23 theme-driven Synthesizer 導入。一覧 UI でテーマ別グルーピングするため
   * Summary にも mirror する。旧 synthesis は undefined のまま。
   */
  theme?: string;
  /** Synthesis の検証状態 */
  hypothesisStatus?: HypothesisStatus;
  /**
   * Toulmin Rebuttal（Phase γ）。一覧 UI のフィルタ / バッジ用に件数を即時参照したい
   * 場面が多いので、配列そのままを mirror する（小さい想定）。Claim / Atom で意味を持つ。
   */
  rebuttalConditions?: string[];
  /**
   * Toulmin Backing（Phase γ）。Claim でのみ意味を持つ。
   * 一覧 UI では「教科書裏付けあり Claim」のフィルタ等に使う。
   */
  backing?: BackingEntry[];
  /**
   * Toulmin Modal qualifier（Phase γ）。Claim でのみ意味を持つ。
   */
  modalQualifier?: ModalQualifier;
  /**
   * 世界モデル照合 validity（Phase 2 / PR 2A）。
   * 一覧 UI の verdict 列・フィルタ・bulk 操作で使う最小限のフィールドだけ mirror する。
   * `INDEX_SCHEMA_VERSION` は bump しない（`NoteIndexEntry` には mirror しない方針）。
   */
  groundingValidity?: {
    verdict?: GroundingValidityVerdict;
    checkedAt?: string;
    /** 接続先 KB エントリ ID（world-grounding edge）。同一 entryId の洞察を引くのに使う。 */
    entryId?: string;
    /** ユーザーが手動でクリアした印。自動照合の対象外にするため mirror する。 */
    dismissed?: boolean;
  };
};

// Graphium ファイルのメタデータ
export type GraphiumFile = {
  id: string;
  name: string;
  modifiedTime: string;
  createdTime: string;
};

// ノート間リンク（派生関係）
export type NoteLink = {
  /** リンク先ノートのファイル ID（プロバイダー固有） */
  targetNoteId: string;
  /** リンク元のブロック ID */
  sourceBlockId: string;
  /** リンクの種類 */
  type: "derived_from";
};

// AI チャットメッセージ
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

// スコープに紐づく AI チャット
export type ScopeChat = {
  id: string;
  scopeBlockId: string;
  scopeType: "heading" | "block" | "page";
  messages: ChatMessage[];
  generatedBy?: {
    agent: string;
    sessionId: string;
    model?: string;
    tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
  createdAt: string;
  modifiedAt: string;
};

// Graphium ファイルの内容（エディタの完全な状態）
// version 履歴:
//   1: 初期形式（links フィールドを prov / knowledge で混在管理）
//   2: links を provLinks / knowledgeLinks に分離
//   3: labels の値を日本語ブラケット表記（[材料] 等）から内部キー（material 等）に移行
//   4: 旧内部キー "result"（Output Entity）を "output" にリネーム。
//      Phase ラベル "plan" / "result" を新設（衝突回避）。
//   5: block-level inline-type ラベル（material/tool/attribute/output）をインラインハイライト
//      （Highlight 配列）に移行。LabelStore は heading 用（procedure/plan/result/free*）に純化。
export type GraphiumDocument = {
  version: 1 | 2 | 3 | 4 | 5;
  title: string;
  pages: GraphiumPage[];
  /** ノート間リンク（派生先ノートへの参照） */
  noteLinks?: NoteLink[];
  /** このノートの派生元ノート ID */
  derivedFromNoteId?: string;
  /** このノートの派生元ブロック ID */
  derivedFromBlockId?: string;
  /** AI エージェントによる生成メタデータ */
  generatedBy?: {
    agent: string;
    sessionId: string;
    model?: string;
    tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
    /**
     * 保存指示を出したユーザー。Claude Code Skill 等、外部エージェント経由で
     * 書き込まれたノートで値が入る。プライバシー配慮のため email は opt-in。
     */
    user?: { username: string; email?: string };
  };
  /** スコープ別 AI チャット履歴 */
  chats?: ScopeChat[];
  /** ドキュメント来歴（編集操作の PROV-DM 記録） */
  documentProvenance?: DocumentProvenance;
  /** ドキュメントソース: "human"（既存ノート）or "ai"（Wiki ドキュメント）or "skill"（プロンプトテ��プレート） */
  source?: "human" | "ai" | "skill";
  /** AI Wiki ドキュメント���メタデータ（source === "ai" の場合のみ） */
  wikiMeta?: WikiMeta;
  /**
   * team-shared-storage への共有状態（Phase 2a）。
   * 設定されていればこのノートは shared 側にコピーが書き出されている。
   * Phase 2a ではコピーが残る運用（personal 側は消さない）。Phase 2b で
   * 移動 semantics（personal → shared 参照）に進化する。
   */
  sharedRef?: {
    /** SharedEntry.id（uuidv7） */
    id: string;
    /** SharedEntry.type（Phase 2a は "note" 固定） */
    type: "note";
    /** ISO-8601 最終共有日時 */
    sharedAt: string;
    /** 共有時の SharedEntry.hash（変更検知用） */
    hash: string;
  };
  /**
   * team-shared エントリを fork して作られたローカルノートの起源情報（Phase 2c）。
   * fork 元の SharedEntry は元の author 所有のままで、本ノートとは別人格として PROV で繋がる。
   */
  forkedFrom?: {
    /** fork 元 SharedEntry.id */
    sharedId: string;
    /** fork 時点の SharedEntry.hash */
    hash: string;
    /** fork 元 author の表示名 */
    authorName: string;
    /** fork 元 author の email */
    authorEmail: string;
    /** ISO-8601 fork 実行日時 */
    forkedAt: string;
  };
  /** Skill メタデータ（source === "skill" の場合のみ） */
  skillMeta?: SkillMeta;
  /** 外部 URL から生成した場合の元 URL */
  sourceUrl?: string;
  /** 外部 URL 取得日時（ISO 8601） */
  sourceFetchedAt?: string;
  /** 外部 URL のページタイトル（fetch 時点） */
  sourceTitle?: string;
  /** PDF から生成した場合の元 PDF（メディアインデックス上の fileId） */
  sourcePdfFileId?: string;
  /** PDF から生成した場合の表示用ファイル名 */
  sourcePdfName?: string;
  /**
   * ドキュメント素材（.docx 等）から生成した場合の元素材（メディアインデックス上の fileId）。
   * 「素材ライブラリ」経由の取り込みで親 .docx と派生ノートを PROV-DM 的に紐付ける。
   * PDF と用途は同じだが、メディアタイプが異なるためフィールドを分けている。
   */
  sourceDocumentFileId?: string;
  /** ドキュメント素材から生成した場合の表示用ファイル名 */
  sourceDocumentName?: string;
  /**
   * このノートが本文中で @ 引用したドキュメント素材（PDF / docx 等）の fileId 配列。
   * メディアインデックス（MediaIndexEntry.fileId）を指す。Cmd-K / チャットの AI が
   * 引用素材の中身（全文＋ハイライトメモ）を読むための参照。
   * 引用先がノートでなく「素材そのもの」である点が noteLinks / sourcePdfFileId と異なる。
   * additive optional のため旧データは従来通り動く。
   */
  citedAssetFileIds?: string[];
  /**
   * 計画ノートへの所属関係（external-source-extraction-prompt.md §6, Phase 5a）。
   * 1 つの論文が複数 procedure を含む場合に、論文単位の計画ノート（navigation note）と
   * 実施ノート（PROV を持つ）を分けて出力する。実施ノートにこのフィールドを付け、
   * 計画ノートに逆参照できるようにする。derivedFromNoteId とは別軸（所属 vs 派生）。
   */
  partOfPlanNoteId?: string;
  createdAt: string;
  modifiedAt: string;
};

export type GraphiumPage = {
  id: string;
  title: string;
  blocks: any[];
  /**
   * ブロックラベル（heading 用 = procedure / plan / result / free.* のみ）。
   * v5 以降、material / tool / attribute / output は highlights に移行する。
   */
  labels: Record<string, string>;
  /** PROV 層リンク（DAG 制約） */
  provLinks: any[];
  /** 知識層リンク（循環 OK） */
  knowledgeLinks: any[];
  /** @deprecated v1 互換: 旧 links フィールド。読み込み時に provLinks/knowledgeLinks に変換する */
  links?: any[];
  /** インデックステーブル: テーブルブロック ID → { サンプル名 → ノートファイル ID } */
  indexTables?: Record<string, Record<string, string>>;
  /**
   * インラインハイライト（v5 で導入）。
   * material / tool / attribute / output は本文ブロック内のテキスト範囲として保存される。
   * 1 ハイライト = 1 ブロック内（越境禁止）。
   */
  highlights?: InlineHighlight[];
  /**
   * メディアブロックのインラインラベル（Phase D-3-β, 2026-04-30 で導入）。
   *
   * 画像・動画・音声・PDF・ファイルブロックは BlockNote の inline style を持てないため、
   * 同等の UX（フローティングメニュー）でラベル付けする経路として、blockId → ラベル
   * の対応を**サイドストア**として保存する。
   *
   * 設計メモ（docs/internal/provenance-layer-design.md §8.6）では block.props 直接保存
   * を理想形としているが、BlockNote 標準ブロック (image/video/audio/file) のスキーマ
   * 拡張は影響範囲が大きいため、本実装ではサイドストア方式を採用している。UX は
   * テキストハイライトと完全に一致する。
   */
  mediaInlineLabels?: Record<string, MediaInlineLabel>;
  /**
   * ブロックの配置揃え（左 / 中央 / 右）。2026-06 で導入。
   *
   * BlockNote の `textAlignment` プロパティを持たないブロック（table / audio /
   * file）の配置をサイドストアとして保存する。段落・見出し・画像・動画・Callout
   * は標準の `textAlignment` プロパティで保存されるため、ここには含めない。
   * mediaInlineLabels と同じ「独立アノテーション層」方式（blockId → 値）。
   * optional なので、未設定の既存ノートはマイグレーション不要で読み込める。
   */
  blockAlignments?: Record<string, "left" | "center" | "right">;
  derivedFromPageId?: string;
  derivedFromBlockId?: string;
};

/**
 * メディアブロック用インラインラベル（Phase D-3-β）。
 *
 * - blockId: image / video / audio / file / pdf ブロックの ID
 * - label: コアラベル（material / tool / attribute / output）
 * - entityId: PROV Entity 同一性キー（テキストハイライトと共通の名前空間）
 */
export type MediaInlineLabel = {
  label: "material" | "tool" | "attribute" | "output";
  entityId: string;
};

/**
 * インライン referent ハイライト（Phase C, v5）。
 *
 * material / tool / attribute / output を「ブロック内のテキスト範囲」として記録する。
 * 同一 entityId を持つ複数ハイライトは同じ PROV Entity を指す（参照重複の集約）。
 *
 * - blockId: ハイライトが属するブロックの ID（ブロック跨ぎ禁止）
 * - text: 参照テキストのスナップショット（ブロック編集で from/to がずれた場合の復旧手がかり）
 * - from / to: ブロック content 内の文字オフセット（先頭からの 0-indexed）
 * - label: コアラベル（material / tool / attribute / output のいずれか）
 * - entityId: PROV Entity 同一性キー（同じ referent を指す複数ハイライトは同じ id を共有）
 */
export type InlineHighlight = {
  id: string;
  blockId: string;
  from: number;
  to: number;
  label: "material" | "tool" | "attribute" | "output";
  entityId: string;
  text: string;
};
