// 語彙インデックス（BM25）本体 — MiniSearch の薄いラッパ
//
// 索引単位は「チャンク」（ノート本文の塊 / Wiki の H2 セクション / 素材テキストの塊）。
// 1 チャンク = MiniSearch の 1 文書。ソース（ノート id / Wiki id / 素材 fileId）ごとに
// チャンク id の一覧を持ち、ソース単位で差し替え・削除できるようにする。
//
// これは埋め込み（意味的近さ）とは独立した「語彙一致」の検索コアで、埋め込み
// モデルが無くても・モデルを変えても・オフラインでも同じ結果を返す。埋め込みと
// 併用するときは fuse.ts の RRF で束ねる。

import MiniSearch, { type SearchResult as MiniSearchResult } from "minisearch";
import { tokenize } from "./tokenizer";

/** 索引ソースの種類 */
export type LexicalSourceKind = "note" | "wiki" | "asset";

/** MiniSearch に入れる 1 文書（= 1 チャンク） */
export type LexicalDoc = {
  /** `${kind}:${sourceId}:${chunkId}` */
  id: string;
  kind: LexicalSourceKind;
  /** ノート id / Wiki ノート id / 素材 fileId */
  sourceId: string;
  /** チャンク id（ノート: 先頭ブロック id、Wiki: セクション id、素材: c0, c1, …） */
  chunkId: string;
  /** ソースのタイトル（ノート・Wiki のタイトル / 素材名）。検索対象かつ表示用 */
  title: string;
  /** チャンク本文。検索対象かつスニペット用 */
  text: string;
  /** チャンクの見出し文脈（表示用・任意） */
  heading?: string;
};

/** ソース 1 件分の投入指示 */
export type LexicalSourceInput = {
  kind: LexicalSourceKind;
  sourceId: string;
  title: string;
  chunks: { chunkId: string; text: string; heading?: string }[];
  /** 差分更新の判定に使う印（更新日時など）。同じなら再索引しない */
  fingerprint: string;
};

export type LexicalHit = {
  id: string;
  kind: LexicalSourceKind;
  sourceId: string;
  chunkId: string;
  title: string;
  text: string;
  heading?: string;
  /** BM25 スコア（MiniSearch の score。相対値としてのみ意味を持つ） */
  score: number;
  /** ヒットした語（MiniSearch の terms） */
  terms: string[];
};

/** 索引済みソース 1 件の要約（設定画面の一覧用） */
export type LexicalSourceSummary = {
  sourceId: string;
  kind: LexicalSourceKind;
  title: string;
  chunkCount: number;
};

/** 索引済みチャンク 1 件（設定画面の「中身を見る」用） */
export type LexicalChunkView = {
  chunkId: string;
  text: string;
  heading?: string;
  /** このチャンクが索引された語（tokenizer の出力。重複除去・出現順） */
  terms: string[];
};

/** 語彙 1 語（設定画面の「語彙」用） */
export type LexicalTermStat = {
  term: string;
  /** その語を含む断片（チャンク）の数 */
  df: number;
};

export type LexicalSearchOptions = {
  /** 対象の種類（省略で全部） */
  kinds?: LexicalSourceKind[];
  /** 除外するソース id */
  excludeSourceIds?: ReadonlySet<string>;
  /** 返すチャンク数（既定 20） */
  limit?: number;
  /** ソースごとに最大何チャンク残すか（既定: 無制限） */
  perSourceLimit?: number;
  /** 最後の語を前方一致にする（Cmd-K の打鍵中向け。既定 true） */
  prefixLastTerm?: boolean;
  /**
   * クエリ語のうち最低いくつ当たっていれば残すか（既定 1 = OR）。
   * 長い質問文では「時間」「条件」のような 1 語だけで当たる弱い候補が並ぶので、
   * 2 にすると 2 語以上当たった候補だけになる。クエリの語数がそれ未満なら語数に丸める
   */
  minTermMatches?: number;
};

export const docId = (kind: LexicalSourceKind, sourceId: string, chunkId: string): string =>
  `${kind}:${sourceId}:${chunkId}`;

/** MiniSearch のオプション。索引と復元で同一である必要がある */
export function miniSearchOptions() {
  return {
    idField: "id",
    fields: ["title", "text"],
    storeFields: ["kind", "sourceId", "chunkId", "title", "text", "heading"],
    tokenize: (s: string) => tokenize(s),
    // tokenize 済みなので processTerm は素通し（空は捨てる）
    processTerm: (term: string) => (term ? term : null),
    searchOptions: {
      boost: { title: 2 },
      combineWith: "OR" as const,
    },
    // 自動 vacuum は使わない。MiniSearch の自動 vacuum は転置索引を
    // 1000 語ごとに await で中断しながら掃除するが、その中断中に addAll が走ると
    // 索引の radix tree が組み変わり、掃除側のイテレータが宙を指して落ちる
    // （TypeError: Cannot read properties of undefined (reading 'keys')）。
    // reconcile は「1 ソース索引 → 譲る」を繰り返すので、この中断と必ず噛み合う。
    // 代わりに vacuumIfDirty() で「途中で譲らない」掃除を明示的に走らせる
    autoVacuum: false as const,
  };
}

/** 永続化用のスナップショット */
export type LexicalIndexSnapshot = {
  /** 形式バージョン。tokenizer / options を変えたら上げる（不一致なら再構築） */
  formatVersion: number;
  /** MiniSearch.toJSON() の結果 */
  index: unknown;
  /** sourceId → { fingerprint, chunkIds, title } */
  sources: Record<string, { kind: LexicalSourceKind; fingerprint: string; chunkIds: string[]; title?: string }>;
};

/** tokenizer / options を変えたら上げる */
export const LEXICAL_FORMAT_VERSION = 1;

// 掃除に踏み切るしきい値（MiniSearch の自動 vacuum の既定値と同じ）。
// 「削除済みが 20 件以上」かつ「索引の 1 割以上が削除済み」で掃除する
const VACUUM_MIN_DIRT_COUNT = 20;
const VACUUM_MIN_DIRT_FACTOR = 0.1;

export class LexicalIndex {
  private ms: MiniSearch<LexicalDoc>;
  private sources = new Map<string, { kind: LexicalSourceKind; fingerprint: string; chunkIds: string[]; title?: string }>();

  constructor(ms?: MiniSearch<LexicalDoc>) {
    this.ms = ms ?? new MiniSearch<LexicalDoc>(miniSearchOptions());
  }

  /** ソースが同じ fingerprint で既に索引済みか */
  isFresh(sourceId: string, fingerprint: string): boolean {
    return this.sources.get(sourceId)?.fingerprint === fingerprint;
  }

  hasSource(sourceId: string): boolean {
    return this.sources.has(sourceId);
  }

  getSourceMeta(sourceId: string) {
    return this.sources.get(sourceId);
  }

  get documentCount(): number {
    return this.ms.documentCount;
  }

  get sourceCount(): number {
    return this.sources.size;
  }

  /** ソース id の一覧（種類で絞れる） */
  listSourceIds(kind?: LexicalSourceKind): string[] {
    const out: string[] = [];
    for (const [id, meta] of this.sources) if (!kind || meta.kind === kind) out.push(id);
    return out;
  }

  /** ソース 1 件の索引済みチャンク一覧（本文と、索引された語）。無ければ空 */
  listChunks(sourceId: string): LexicalChunkView[] {
    const meta = this.sources.get(sourceId);
    if (!meta) return [];
    const out: LexicalChunkView[] = [];
    for (const chunkId of meta.chunkIds) {
      const stored = this.ms.getStoredFields(docId(meta.kind, sourceId, chunkId));
      if (!stored) continue;
      const text = (stored.text as string) ?? "";
      const title = (stored.title as string) ?? "";
      // 索引に入っている語 = title と text の両フィールドのトークン（title は boost 付きで同じく検索対象）
      const terms = Array.from(new Set([...tokenize(title), ...tokenize(text)]));
      out.push({ chunkId, text, heading: (stored.heading as string | undefined) || undefined, terms });
    }
    return out;
  }

  /** 語彙（索引に入っている語と、それを含む断片数）。df の多い順 */
  vocabulary(): LexicalTermStat[] {
    // MiniSearch の直列化形（[term, { fieldId: { shortDocId: tf } }]）から数える。
    // discard 済みの文書は documentIds から消えているので、それだけを数える
    const json = this.ms.toJSON() as unknown as {
      documentIds: Record<string, string>;
      index: [string, Record<string, Record<string, number>>][];
    };
    const live = new Set(Object.keys(json.documentIds ?? {}));
    const out: LexicalTermStat[] = [];
    for (const [term, byField] of json.index ?? []) {
      const ids = new Set<string>();
      for (const postings of Object.values(byField)) for (const id of Object.keys(postings)) if (live.has(id)) ids.add(id);
      if (ids.size > 0) out.push({ term, df: ids.size });
    }
    out.sort((a, b) => b.df - a.df || a.term.localeCompare(b.term));
    return out;
  }

  /** 語彙数（索引に入っている異なり語の数。discard 済みの残骸を含むことがある） */
  get termCount(): number {
    return this.ms.termCount;
  }

  /** 索引済みソースの一覧（設定画面の「中身を見る」用）。タイトルは meta（無ければ先頭チャンクの stored field）から */
  listSources(): LexicalSourceSummary[] {
    const out: LexicalSourceSummary[] = [];
    for (const [sourceId, meta] of this.sources) {
      let title = meta.title ?? "";
      if (!title && meta.chunkIds[0]) {
        const stored = this.ms.getStoredFields(docId(meta.kind, sourceId, meta.chunkIds[0]));
        title = (stored?.title as string | undefined) ?? "";
      }
      out.push({ sourceId, kind: meta.kind, title, chunkCount: meta.chunkIds.length });
    }
    return out;
  }

  /** ソースを丸ごと差し替える（無ければ追加）。fingerprint が同じなら何もしない */
  upsertSource(input: LexicalSourceInput): boolean {
    if (this.isFresh(input.sourceId, input.fingerprint)) return false;
    this.removeSource(input.sourceId);
    const chunkIds: string[] = [];
    const docs: LexicalDoc[] = [];
    const seen = new Set<string>();
    for (const c of input.chunks) {
      const text = (c.text ?? "").trim();
      if (!text) continue;
      // 同じ chunkId が重複していたら後勝ちにせず番号を振って両方残す
      let chunkId = c.chunkId || `c${chunkIds.length}`;
      if (seen.has(chunkId)) chunkId = `${chunkId}#${chunkIds.length}`;
      seen.add(chunkId);
      chunkIds.push(chunkId);
      docs.push({
        id: docId(input.kind, input.sourceId, chunkId),
        kind: input.kind,
        sourceId: input.sourceId,
        chunkId,
        title: input.title ?? "",
        text,
        heading: c.heading,
      });
    }
    if (docs.length > 0) this.ms.addAll(docs);
    // title は本文が空のソース（空ノート等）でも一覧に出せるよう meta 側にも持つ
    this.sources.set(input.sourceId, { kind: input.kind, fingerprint: input.fingerprint, chunkIds, title: input.title ?? "" });
    return true;
  }

  /** ソースを索引から外す（存在しなければ何もしない） */
  removeSource(sourceId: string): boolean {
    const meta = this.sources.get(sourceId);
    if (!meta) return false;
    for (const chunkId of meta.chunkIds) {
      const id = docId(meta.kind, sourceId, chunkId);
      if (this.ms.has(id)) this.ms.discard(id);
    }
    this.sources.delete(sourceId);
    return true;
  }

  /** 全消去 */
  clear(): void {
    this.ms.removeAll();
    this.sources.clear();
  }

  /**
   * discard の残骸（転置索引に残った削除済み文書への参照）を掃除する。
   * 溜まっていなければ何もしない。掃除したら true。
   *
   * `batchSize: Infinity` は「1000 語ごとに await で中断する」既定を無効にするための指定で、
   * これが本質。MiniSearch の掃除は中断中に索引が書き換わることを想定しておらず、
   * 中断すると reconcile の addAll と噛み合って自身のイテレータを壊す。
   * 中断しなければ掃除は同期的に走り切るので、誰と並走しても壊れない。
   *
   * 残骸は検索結果にもスコアにも影響しない（生存文書だけが結果に入る）。
   * 掃除の目的はメモリとスナップショットの肥大を抑えること
   */
  async vacuumIfDirty(): Promise<boolean> {
    if (this.ms.dirtCount < VACUUM_MIN_DIRT_COUNT || this.ms.dirtFactor < VACUUM_MIN_DIRT_FACTOR) return false;
    await this.ms.vacuum({ batchSize: Infinity });
    return true;
  }

  /** 検索（同期）。索引が空なら空配列 */
  search(query: string, options: LexicalSearchOptions = {}): LexicalHit[] {
    const q = (query ?? "").trim();
    if (!q || this.ms.documentCount === 0) return [];
    const limit = options.limit ?? 20;
    const kinds = options.kinds ? new Set(options.kinds) : null;
    const prefixLast = options.prefixLastTerm ?? true;
    const terms = tokenize(q);
    if (terms.length === 0) return [];

    const raw: MiniSearchResult[] = this.ms.search(q, {
      // 打鍵中は最後の語だけ前方一致（"thermo" → thermoelectric）。1 文字は広すぎるので除く
      prefix: (term, i, all) => prefixLast && i === all.length - 1 && term.length >= 2,
      filter: (r) => {
        if (kinds && !kinds.has(r.kind as LexicalSourceKind)) return false;
        if (options.excludeSourceIds?.has(r.sourceId as string)) return false;
        return true;
      },
    });

    const perSource = options.perSourceLimit ?? Infinity;
    const perSourceCount = new Map<string, number>();
    const uniqueTerms = new Set(terms).size;
    const minMatch = Math.max(1, Math.min(options.minTermMatches ?? 1, uniqueTerms));
    const hits: LexicalHit[] = [];
    for (const r of raw) {
      if (r.terms.length < minMatch) continue;
      const sid = r.sourceId as string;
      const n = perSourceCount.get(sid) ?? 0;
      if (n >= perSource) continue;
      perSourceCount.set(sid, n + 1);
      hits.push({
        id: r.id as string,
        kind: r.kind as LexicalSourceKind,
        sourceId: sid,
        chunkId: r.chunkId as string,
        title: (r.title as string) ?? "",
        text: (r.text as string) ?? "",
        heading: (r.heading as string | undefined) || undefined,
        score: r.score,
        terms: r.terms,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** 永続化用スナップショット */
  toSnapshot(): LexicalIndexSnapshot {
    const sources: LexicalIndexSnapshot["sources"] = {};
    for (const [id, meta] of this.sources) sources[id] = { ...meta, chunkIds: [...meta.chunkIds] };
    return { formatVersion: LEXICAL_FORMAT_VERSION, index: this.ms.toJSON(), sources };
  }

  /** スナップショットから復元（形式が違えば null） */
  static async fromSnapshot(snap: LexicalIndexSnapshot | null | undefined): Promise<LexicalIndex | null> {
    if (!snap || snap.formatVersion !== LEXICAL_FORMAT_VERSION || !snap.index) return null;
    try {
      const ms = await MiniSearch.loadJSAsync<LexicalDoc>(snap.index as any, miniSearchOptions());
      const idx = new LexicalIndex(ms);
      for (const [id, meta] of Object.entries(snap.sources ?? {})) {
        idx.sources.set(id, { kind: meta.kind, fingerprint: meta.fingerprint, chunkIds: [...(meta.chunkIds ?? [])], title: meta.title });
      }
      return idx;
    } catch {
      return null;
    }
  }
}
