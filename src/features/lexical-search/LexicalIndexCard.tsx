// Settings → ストレージ に置く「検索インデックス」カード
//
// 索引の状態（索引済み件数・構築中の残り）を見せ、壊れたときの逃げ道として
// 「作り直す」を提供する。索引は端末ローカルの再構築可能なキャッシュなので、
// 作り直しはノートデータに一切触れない（reset → 追従フックが reconcile し直す）。
//
// 「中身を見る」を開くと、何が索引に入っているか（ソース一覧）と、任意の語で
// 引いたときに何が当たるか（試し検索）をその場で確認できる。読み取り専用。

import { useMemo, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Search, BookOpen } from "lucide-react";
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
const KIND_ORDER: LexicalSourceKind[] = ["note", "wiki", "asset"];

function KindIcon({ kind }: { kind: LexicalSourceKind }) {
  const cls = "shrink-0 text-muted-foreground";
  if (kind === "wiki") return <BookOpen size={12} className={cls} />;
  if (kind === "asset") return <ImageIcon size={12} className={cls} />;
  return <FileText size={12} className={cls} />;
}

export function LexicalIndexCard() {
  const { t } = useLocale();
  const status = useLexicalStatus();
  const [resetting, setResetting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState("");
  const busy = status.state === "indexing" || status.state === "loading" || resetting;
  const revision = `${status.generation}:${status.documents}:${status.sources}:${status.state}`;

  const summary =
    status.state === "loading"
      ? t("settings.searchIndex.loading")
      : status.state === "indexing"
        ? t("settings.searchIndex.indexing", { pending: String(status.pending) })
        : t("settings.searchIndex.summary", { sources: String(status.sources), chunks: String(status.documents) });

  // 索引済みソース一覧（種類 → タイトル順）。索引が動いたら取り直す
  const sources = useMemo(() => {
    if (!browsing) return [];
    // 種類 → 断片あり → タイトル順（本文が空のソースと無題は後ろ）
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  // 試し検索（入力があるとき）
  const hits = useMemo(() => {
    const q = query.trim();
    if (!browsing || !q) return [];
    return Array.from(bestHitsBySource(q, KIND_ORDER, { limit: 40 }).values()).slice(0, HIT_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, query, revision]);

  const kindLabel = (kind: LexicalSourceKind) => t(`settings.searchIndex.kind.${kind}`);

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
          <div className="text-xs text-muted-foreground">
            {t("settings.searchIndex.kinds", {
              notes: String(kindCounts.note),
              wiki: String(kindCounts.wiki),
              assets: String(kindCounts.asset),
            })}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.searchIndex.browsePlaceholder")}
            className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
          />
          {query.trim() ? (
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
          ) : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {sources.slice(0, LIST_LIMIT).map((s) => (
                <li key={`${s.kind}:${s.sourceId}`} className="flex items-center gap-1.5 text-xs min-w-0">
                  <KindIcon kind={s.kind} />
                  <span className="truncate text-foreground" title={s.title || s.sourceId}>{s.title || t("settings.searchIndex.untitled")}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {kindLabel(s.kind)} · {t("settings.searchIndex.chunks", { count: String(s.chunkCount) })}
                  </span>
                </li>
              ))}
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
