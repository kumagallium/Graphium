// ノートに紐づかないチャットの横に並べる全体グラフの枠。
//
// 見出し 1 行目: 題・AI が探せる範囲（内部参照 / 外部参照・探すフォルダ）・閉じる。
// 見出し 2 行目: この答えで使ったページ・前の答え・Web の出典・範囲の外なのに使ったページの数。
// グラフそのもの（GlobalGraphView の compact 表示）と、数・範囲は呼び出し側が渡す。
// 光らせるのは答えが返ったときだけ（graph-firing の once）で、グラフ全体は動かさない。

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n";
import type { GroundingScope } from "../../lib/grounding-scope";

/** グラフの「使った」緑（global-graph-view の act の濃い側・薄い側）と、範囲の輪の色に合わせる */
const USED_DOT = "#2f6b3a";
// act 0.5（EARLIER_WEIGHT）の色。mapData(act, 0, 1, #a9bfad, #2f6b3a) の真ん中
const EARLIER_DOT = "#6c9573";
const ATTACHED_RING = "#534AB7";
/** 読んだが使わなかったページ（global-graph-view の ai-read と同じ地と縁） */
const READ_FILL = "#c9e2ce";
const READ_RING = "#4f8a5c";
const BREACH_RING = "#C0392B";

export type ChatGraphCounts = {
  /** いちばん新しい答えで使ったページの数（グラフにあるものだけ） */
  latest: number;
  /** それより前の答えで使ったページの数 */
  earlier: number;
  /** いちばん新しい答えの Web の出典の数 */
  web: number;
  /** @ で渡したページの数 */
  attached: number;
  /** 範囲の外なのに使った・読んだページの数（本来は 0） */
  outOfScope: number;
  /** いちばん新しい答え（または読んでいる途中）で AI が読んだページの数 */
  read: number;
  /** 答えを待っているあいだで、AI がページを読んでいる */
  reading: boolean;
  /** じっくり調べるときに AI が来歴の道具でたどった線の数（無ければ 0） */
  walked?: number;
};

function Dot({ color, ring = false, dashed = false, fill }: { color: string; ring?: boolean; dashed?: boolean; fill?: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={ring ? { border: `${fill ? 1.5 : 2}px ${dashed ? "dashed" : "solid"} ${color}`, background: fill } : { background: color }}
    />
  );
}

export function ChatGraphPane({
  counts,
  scope,
  folder,
  onClose,
  children,
}: {
  counts: ChatGraphCounts;
  /** 会話の渡す範囲（内部参照 / 外部参照） */
  scope: GroundingScope;
  /** 探すフォルダ（"親" または "親/子"）。未指定はすべて */
  folder?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const nothingYet = counts.latest === 0 && counts.earlier === 0 && counts.web === 0 && counts.read === 0;
  const item = "inline-flex items-center gap-1.5 whitespace-nowrap";
  return (
    <section className="flex flex-col h-full min-h-0" aria-label={t("standaloneChat.graphTitle")}>
      <div className="px-3 py-2 border-b border-border space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold text-foreground shrink-0">{t("standaloneChat.graphTitle")}</span>
          {/* AI が探せる範囲。柵（フォルダの外を薄くする）と同じものを言葉でも出す */}
          <span
            className="min-w-0 truncate text-[11px] text-muted-foreground"
            data-tooltip={t("standaloneChat.graphScopeHint")}
          >
            {t(scope === "external" ? "standaloneChat.graphScopeExternal" : "standaloneChat.graphScopeInternal")}
            {" · "}
            {folder ? t("standaloneChat.graphScopeFolder", { folder }) : t("standaloneChat.graphScopeAll")}
          </span>
          <button
            onClick={onClose}
            aria-label={t("standaloneChat.hideGraph")}
            data-tooltip={t("standaloneChat.hideGraph")}
            className="ml-auto shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div
          className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground"
          data-tooltip={t("standaloneChat.graphHint")}
        >
          {nothingYet ? (
            <span>{t("standaloneChat.graphNone")}</span>
          ) : (
            <>
              {counts.read > 0 && (
                <span className={item} aria-live="polite">
                  <Dot color={READ_RING} ring fill={READ_FILL} />
                  {t(counts.reading ? "standaloneChat.graphReading" : "standaloneChat.graphRead", { n: String(counts.read) })}
                </span>
              )}
              {!counts.reading && (
                <span className={item}>
                  <Dot color={USED_DOT} />
                  {t("standaloneChat.graphUsed", { n: String(counts.latest) })}
                </span>
              )}
              {counts.earlier > 0 && (
                <span className={item}>
                  <Dot color={EARLIER_DOT} />
                  {t("standaloneChat.graphUsedEarlier", { n: String(counts.earlier) })}
                </span>
              )}
              {counts.web > 0 && (
                <span className={item}>{t("standaloneChat.graphWeb", { n: String(counts.web) })}</span>
              )}
            </>
          )}
          {(counts.walked ?? 0) > 0 && (
            <span className={item}>
              <span aria-hidden="true" className="inline-block w-3 h-[3px] rounded-full shrink-0" style={{ background: USED_DOT }} />
              {t("standaloneChat.graphWalked", { n: String(counts.walked) })}
            </span>
          )}
          {counts.attached > 0 && (
            <span className={item}>
              <Dot color={ATTACHED_RING} ring />
              {t("standaloneChat.graphAttached", { n: String(counts.attached) })}
            </span>
          )}
          {counts.outOfScope > 0 && (
            <span className={`${item} text-destructive`}>
              <Dot color={BREACH_RING} ring dashed />
              {t("standaloneChat.graphOutOfScope", { n: String(counts.outOfScope) })}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}
