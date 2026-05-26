// 聴牌 hint の計算（純粋関数）。
//
// [[project-tenpai-layer-design]] の note 単位 clustering を React 外から呼べる形に
// 切り出す。docCacheRef の中身は外から get function として注入してもらう。
//
// 設計判断:
// - 戻り値の TenpaiHint.generatedAt は副作用（Date.now）。テスト・bench から決定論的に
//   呼べるよう `now` を引数化する（デフォルトは `new Date().toISOString()`）。
// - 入力は `wikiFiles`（順序付き ID/名前）と `wikiMetas`（軽量 kind 判定）、
//   そして wiki doc 全件の取得関数。doc cache の実装方法は呼び元の責務（React Hook
//   経由でも、bench からの fs.readFileSync ベースでも、シグネチャが一致すれば良い）。
//
// 関連: [[project-atom-provenance-chain]] — atom は context-stripped なので
// source note は derivedFromClaims → claim.derivedFromNotes の 2-hop で復元する。
// 関連: [[project-tenpai-layer-design]] — note 単位 clustering / α 案。

import type { GraphiumDocument, GraphiumFile, WikiMetaSummary } from "../../lib/document-types";
import { pickTenpaiModes } from "./synthesis-router";
import {
  TENPAI_MIN_ATOM_COUNT,
  tenpaiHintIdOf,
  tenpaiMissingKeyOf,
  type TenpaiHint,
} from "./tenpai-types";

export type ComputeTenpaiHintsInput = {
  /** 全 wiki ファイル一覧（順序が結果の安定性に効くので呼び元での並びを尊重する） */
  wikiFiles: readonly GraphiumFile[];
  /** 軽量 meta（kind 判定用） */
  wikiMetas: ReadonlyMap<string, WikiMetaSummary>;
  /** `wiki:${id}` キーで wiki doc 全体を返す。未キャッシュなら undefined。 */
  getCachedDoc: (key: string) => GraphiumDocument | undefined;
  /** TenpaiHint.generatedAt に入れる ISO 文字列。省略時は now。 */
  now?: string;
  /** 1 クラスターから返す最大 hint 数（pickTenpaiModes の maxHints）。デフォルト 2。 */
  maxHintsPerCluster?: number;
};

type AtomEntry = {
  id: string;
  title: string;
  meta: WikiMetaSummary;
  sourceNotes: string[];
};

/**
 * note 単位 clustering で聴牌候補を計算する。
 *
 * フロー:
 * 1. wikiFiles から kind=atom のみ atomEntries に積む。各 atom について
 *    `wikiMeta.derivedFromClaims` → 各 claim の `wikiMeta.derivedFromNotes` を辿って
 *    source note の集合を解決する。
 * 2. atom 総数が TENPAI_MIN_ATOM_COUNT 未満なら空配列で抜ける（無音化）。
 * 3. note → atom[] の逆引きを作り、各クラスターで pickTenpaiModes を呼ぶ。
 *    クラスター自体も TENPAI_MIN_ATOM_COUNT 未満ならスキップ。
 * 4. hint id で dedupe して TenpaiHint[] を返す（同じ atom 集合が複数クラスターに
 *    属しても同一 hint は 1 件にまとめる）。
 */
export function computeTenpaiHints(input: ComputeTenpaiHintsInput): TenpaiHint[] {
  const {
    wikiFiles,
    wikiMetas,
    getCachedDoc,
    now,
    maxHintsPerCluster = 2,
  } = input;
  const generatedAt = now ?? new Date().toISOString();

  // 1. atom を集めつつ source note を 2-hop で解決
  const atomEntries: AtomEntry[] = [];
  for (const wf of wikiFiles) {
    const meta = wikiMetas.get(wf.id);
    if (!meta || meta.kind !== "atom") continue;
    const cached = getCachedDoc(`wiki:${wf.id}`);
    const title = cached?.title ?? wf.name ?? wf.id;
    const noteSet = new Set<string>();
    const claimIds = cached?.wikiMeta?.derivedFromClaims ?? [];
    for (const claimId of claimIds) {
      const claimDoc = getCachedDoc(`wiki:${claimId}`);
      for (const noteId of claimDoc?.wikiMeta?.derivedFromNotes ?? []) {
        noteSet.add(noteId);
      }
    }
    atomEntries.push({ id: wf.id, title, meta, sourceNotes: [...noteSet] });
  }
  if (atomEntries.length < TENPAI_MIN_ATOM_COUNT) return [];

  // 2. note → atom[] の逆引き（同じ atom が複数 note クラスターに属することがある）
  const noteToAtoms = new Map<string, AtomEntry[]>();
  for (const a of atomEntries) {
    for (const noteId of a.sourceNotes) {
      const list = noteToAtoms.get(noteId);
      if (list) list.push(a);
      else noteToAtoms.set(noteId, [a]);
    }
  }

  // 3. 各 note クラスターで pickTenpaiModes、id で dedupe
  const seen = new Set<string>();
  const hints: TenpaiHint[] = [];
  for (const cluster of noteToAtoms.values()) {
    if (cluster.length < TENPAI_MIN_ATOM_COUNT) continue;
    const atomTypes = cluster.map((a) => a.meta.atomType);
    const candidates = pickTenpaiModes(atomTypes, undefined, maxHintsPerCluster);
    for (const c of candidates) {
      const involvedAtoms = c.basisIndices.map((i) => ({
        id: cluster[i].id,
        title: cluster[i].title,
      }));
      const id = tenpaiHintIdOf(c.mode, involvedAtoms.map((a) => a.id));
      if (seen.has(id)) continue;
      seen.add(id);
      hints.push({
        id,
        mode: c.mode,
        missingKey: tenpaiMissingKeyOf(c.mode, c.missing),
        involvedAtoms,
        generatedAt,
      });
    }
  }
  return hints;
}
