// Settings → ストレージ に置く「検索インデックス」カード
//
// 索引の状態（索引済み件数・構築中の残り）を見せ、壊れたときの逃げ道として
// 「作り直す」を提供する。索引は端末ローカルの再構築可能なキャッシュなので、
// 作り直しはノートデータに一切触れない（reset → 追従フックが reconcile し直す）。
//
// 「中身を見る」を開くと、索引の中身をそのまま確認できる（読み取り専用）:
// - 断片: どのソースがどんな断片（本文）に切られ、各断片がどんな語に分割されて
//   索引されているか。ソースを開くと断片と語が見える。入力欄に語を入れると試し検索になる
// - 語彙: 索引に入っている語と、それを含む断片数。入力欄で絞り込める
//   （「なぜ当たる / 当たらないか」を日本語の分割込みで確かめるためのビュー）

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon, Loader2, Search, BookOpen } from "lucide-react";
import { Button } from "@ui/button";
import { useLocale } from "../../i18n";
import { lexicalSearch } from "./service";
import { useLexicalStatus } from "./use-lexical-sync";
import { bestHitsBySource } from "./best-hits";
import type { LexicalSourceKind } from "./lexical-index";

/** 一覧に出す最大行数（それ以上は「…他 N 件」） */
const LIST_LIMIT = 100;
/** 試し検索で出す最大件数 */
const HIT_LIMIT = 10;
/** 1 ソースを開いたときに出す断片の最大数 */
const CHUNK_LIMIT = 40;
/** 1 断片に出す語の最大数 */
const TERM_CHIP_LIMIT = 40;
/** 語彙一覧に出す最大行数 */
const VOCAB_LIMIT = 300;
const KIND_ORDER: LexicalSourceKind[] = ["note", "wiki", "asset"];

type BrowseMode = "passages" | "vocab";

function KindIcon({ kind }: { kind: LexicalSourceKind }) {
  const cls = "shrink-0 text-muted-foreground";
  if (kind === "wiki") return <BookOpen size={12} className={cls} />;
  if (kind === "asset") return <ImageIcon size={12} className={cls} />;
  return <FileText size={12} className={cls} />;
}

/** 語のチップ列（多すぎるときは「…他 N 語」） */
function TermChips({ terms, more }: { terms: string[]; more: (n: number) => string }) {
  const shown = terms.slice(0, TERM_CHIP_LIMIT);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <span key={t} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
          {t}
        </span>
      ))}
      {terms.length > shown.length && (
        <span className="text-[10px] text-muted-foreground">{more(terms.length - shown.length)}</span>
      )}
    </div>
  );
}

export function LexicalIndexCard() {
  const { t } = useLocale();
  const status = useLexicalStatus();
  const [resetting, setResetting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [mode, setMode] = useState<BrowseMode>("passages");
  const [query, setQuery] = useState("");
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const busy = status.state === "indexing" || status.state === "loading" || resetting;
  const revision = `${status.generation}:${status.documents}:${status.sources}:${status.state}`;

  const summary =
    status.state === "loading"
      ? t("settings.searchIndex.loading")
      : status.state === "indexing"
        ? t("settings.searchIndex.indexing", { pending: String(status.pending) })
        : t("settings.searchIndex.summary", { sources: String(status.sources), chunks: String(status.documents) });

  // 索引済みソース一覧（種類 → 断片あり → タイトル順。本文が空のソースと無題は後ろ）
  const sources = useMemo(() => {
    if (!browsing) return [];
    return lexicalSearch
      .listSources()
      .sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          Number(b.chunkCount > 0) - Number(a.chunkCount > 0) ||
          Number(!a.title) - Number(!b.title) ||
          a.title.localeCompare(b.title),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, revision]);
  const kindCounts = useMemo(() => {
    const c: Record<LexicalSourceKind, number> = { note: 0, wiki: 0, asset: 0 };
    for (const s of sources) c[s.kind] += 1;
    return c;
  }, [sources]);

  // 開いたソースの断片（本文 + 索引された語）
  const openChunks = useMemo(() => {
    if (!browsing || !openSourceId) return [];
    return lexicalSearch.listChunks(openSourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, openSourceId, revision]);

  // 試し検索（断片モードで入力があるとき）
  const hits = useMemo(() => {
    const q = query.trim();
    if (!browsing || mode !== "passages" || !q) return [];
    return Array.from(bestHitsBySource(q, KIND_ORDER, { limit: 40 }).values()).slice(0, HIT_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, mode, query, revision]);

  // 語彙（語彙モードのときだけ計算。索引全体を舐めるので開いたときだけ）
  const vocab = useMemo(() => {
    if (!browsing || mode !== "vocab") return [];
    return lexicalSearch.vocabulary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, mode, revision]);
  const vocabFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? vocab.filter((v) => v.term.includes(q)) : vocab;
  }, [vocab, query]);

  const kindLabel = (kind: LexicalSourceKind) => t(`settings.searchIndex.kind.${kind}`);
  const moreTerms = (n: number) => t("settings.searchIndex.moreTerms", { count: String(n) });

  const modeTab = (m: BrowseMode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setQuery("");
      }}
      className={`px-2 py-1 text-xs rounded transition-colors ${
        mode === m ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Search size={14} className="text-muted-foreground" />
        <h3 className="text-xs font-semibold text-foreground">{t("settings.searchIndex.title")}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{t("settings.searchIndex.help")}</p>
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          size="sm"
          disabled={busy || !lexicalSearch.isReady()}
          onClick={async () => {
            if (!window.confirm(t("settings.searchIndex.rebuildConfirm"))) return;
            setResetting(true);
            try {
              await lexicalSearch.reset();
            } finally {
              setResetting(false);
            }
          }}
        >
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin mr-1.5" />
              {t("settings.searchIndex.rebuilding")}
            </>
          ) : (
            t("settings.searchIndex.rebuild")
          )}
        </Button>
        <Button size="sm" variant="outline" disabled={!lexicalSearch.isReady()} onClick={() => setBrowsing((v) => !v)}>
          {browsing ? t("settings.searchIndex.browseClose") : t("settings.searchIndex.browse")}
        </Button>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </div>
      {status.lastError && (
        <p className="text-xs text-red-500 mt-2">{status.lastError}</p>
      )}

      {browsing && (
        <div className="mt-3 rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {t("settings.searchIndex.kinds", {
                notes: String(kindCounts.note),
                wiki: String(kindCounts.wiki),
                assets: String(kindCounts.asset),
              })}
            </div>
            <div className="flex items-center gap-1">
              {modeTab("passages", t("settings.searchIndex.tab.passages"))}
              {modeTab("vocab", t("settings.searchIndex.tab.vocab"))}
            </div>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "vocab" ? t("settings.searchIndex.vocabPlaceholder") : t("settings.searchIndex.browsePlaceholder")}
            className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
          />

          {/* ── 語彙 ── */}
          {mode === "vocab" && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">
                {t("settings.searchIndex.vocabSummary", { count: String(vocab.length), shown: String(Math.min(vocabFiltered.length, VOCAB_LIMIT)) })}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("settings.searchIndex.vocabHelp")}</p>
              {vocabFiltered.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("settings.searchIndex.noTerms")}</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
                  {vocabFiltered.slice(0, VOCAB_LIMIT).map((v) => (
                    <li key={v.term} className="flex items-baseline justify-between gap-2 text-xs min-w-0">
                      <span className="truncate font-mono text-foreground" title={v.term}>{v.term}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{v.df}</span>
                    </li>
                  ))}
                </ul>
              )}
              {vocabFiltered.length > VOCAB_LIMIT && (
                <div className="text-xs text-muted-foreground">
                  {t("settings.searchIndex.more", { count: String(vocabFiltered.length - VOCAB_LIMIT) })}
                </div>
              )}
            </div>
          )}

          {/* ── 断片: 試し検索 ── */}
          {mode === "passages" && query.trim() && (
            hits.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("settings.searchIndex.noHits")}</p>
            ) : (
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {hits.map((h) => (
                  <li key={`${h.kind}:${h.sourceId}`} className="text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <KindIcon kind={h.kind} />
                      <span className="truncate text-foreground" title={h.title}>{h.title || h.sourceId}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{kindLabel(h.kind)}</span>
                    </div>
                    <div className="pl-[18px] text-muted-foreground truncate" title={h.snippet.text}>
                      {h.snippet.text}
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}

          {/* ── 断片: ソース一覧（開くと断片と索引された語） ── */}
          {mode === "passages" && !query.trim() && (
            <ul className="space-y-0.5 max-h-96 overflow-y-auto">
              {sources.slice(0, LIST_LIMIT).map((s) => {
                const open = openSourceId === s.sourceId;
                return (
                  <li key={`${s.kind}:${s.sourceId}`} className="text-xs">
                    <button
                      type="button"
                      onClick={() => setOpenSourceId(open ? null : s.sourceId)}
                      className="w-full flex items-center gap-1.5 min-w-0 py-0.5 text-left hover:bg-muted/60 rounded px-1"
                      title={s.title || s.sourceId}
                    >
                      {open ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
                      <KindIcon kind={s.kind} />
                      <span className="truncate text-foreground">{s.title || t("settings.searchIndex.untitled")}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {kindLabel(s.kind)} · {t("settings.searchIndex.chunks", { count: String(s.chunkCount) })}
                      </span>
                    </button>
                    {open && (
                      <ol className="ml-5 my-1 space-y-2 border-l border-border pl-3">
                        {openChunks.length === 0 && (
                          <li className="text-muted-foreground">{t("settings.searchIndex.noChunks")}</li>
                        )}
                        {openChunks.slice(0, CHUNK_LIMIT).map((c, i) => (
                          <li key={c.chunkId} className="space-y-1">
                            <div className="text-[10px] text-muted-foreground font-mono">
                              #{i + 1}
                              {c.heading ? ` · ${c.heading}` : ""}
                            </div>
                            <div className="text-foreground whitespace-pre-wrap break-words line-clamp-4" title={c.text}>
                              {c.text}
                            </div>
                            <TermChips terms={c.terms} more={moreTerms} />
                          </li>
                        ))}
                        {openChunks.length > CHUNK_LIMIT && (
                          <li className="text-muted-foreground">
                            {t("settings.searchIndex.moreChunks", { count: String(openChunks.length - CHUNK_LIMIT) })}
                          </li>
                        )}
                      </ol>
                    )}
                  </li>
                );
              })}
              {sources.length > LIST_LIMIT && (
                <li className="text-xs text-muted-foreground">
                  {t("settings.searchIndex.more", { count: String(sources.length - LIST_LIMIT) })}
                </li>
              )}
              {sources.length === 0 && <li className="text-xs text-muted-foreground">{t("settings.searchIndex.empty")}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
