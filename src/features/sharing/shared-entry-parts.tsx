// 共有エントリ 1 件の「見出し・メタ・操作・履歴・逆引き」の部品。
//
// なぜ切り出したか:
//   同じエントリを 2 か所で見せる（詳細パネル＝サイドピーク と 全画面表示
//   SharedNoteView）。メタの並びや操作の出し分け（自分作なら共有解除、
//   テンプレートなら新規ノート…）を両方に書くと、片方だけ条件が古くなって
//   「サイドピークでは出るのに全画面では出ない」が起きる。判断はここ 1 か所に置く。
//
// 置き場所の約束: 外枠（余白・境界線・背景）は呼び出し側が持つ。ここは中身だけを返す
// —— 詳細パネルと全画面では枠の見え方が違うため。
//
// 設計詳細: docs/internal/team-shared-storage-design.md §3 Library / §22

import { useState } from "react";
import { Check, FilePlus2, GitFork, Link2, Trash2 } from "lucide-react";
import type { SharedEntry } from "../../lib/storage/shared";
import { buildSharedCitationLink } from "./citation-link";
import { formatDate } from "../../lib/format-datetime";
import { useT } from "../../i18n";
import { HashBadge, type HashStatus } from "./hash-badge";
import type { SharedReverseLinks } from "./shared-projection";

/** 題名（extra.title）。無ければ「無題」 */
export function sharedEntryTitle(
  entry: SharedEntry,
  translate: (k: string) => string,
): string {
  const title = (entry.extra as Record<string, unknown> | undefined)?.title;
  if (typeof title === "string" && title.trim()) return title;
  return translate("library.untitled");
}

/** type ラベル（note/knowledge はタブ名、reference/data-manifest は素材種別名） */
export function sharedEntryTypeLabel(
  entry: SharedEntry,
  translate: (k: string, p?: Record<string, string>) => string,
): string {
  if (entry.type === "note") return translate("library.tab.note");
  if (entry.type === "knowledge") return translate("library.tab.knowledge");
  if (entry.type === "template") return translate("library.tab.template");
  if (entry.type === "reference") return translate("asset.type.url");
  if (entry.type === "data-manifest") {
    const mediaType = (entry.extra as Record<string, unknown> | undefined)?.media_type;
    return translate(`asset.type.${typeof mediaType === "string" ? mediaType : "other"}`);
  }
  return entry.type;
}

// ── メタ（ID / 作成日 / 更新日 / ハッシュ + 検証 / 派生元） ──

export function SharedEntryMeta({
  entry,
  hashStatus,
  onVerifyHash,
}: {
  entry: SharedEntry;
  hashStatus: HashStatus;
  onVerifyHash: () => void;
}) {
  const uiT = useT();
  return (
    <>
      <DetailRow
        label={uiT("library.detail.id")}
        value={<span className="font-mono break-all">{entry.id}</span>}
      />
      <DetailRow label={uiT("library.detail.created")} value={formatDate(entry.created_at)} />
      <DetailRow label={uiT("library.detail.updated")} value={formatDate(entry.updated_at)} />
      <DetailRow
        label={uiT("library.detail.hash")}
        value={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] truncate max-w-[260px]" title={entry.hash}>
              {entry.hash.slice(0, 16)}…
            </span>
            <HashBadge
              status={hashStatus}
              onClick={(e) => {
                e.stopPropagation();
                onVerifyHash();
              }}
            />
          </span>
        }
      />
      {entry.prov.derived_from.length > 0 && (
        <DetailRow
          label={uiT("library.detail.derivedFrom")}
          value={
            <ul className="list-disc list-inside">
              {entry.prov.derived_from.map((id) => (
                <li key={id} className="font-mono text-[10px] truncate">
                  {id}
                </li>
              ))}
            </ul>
          }
        />
      )}
    </>
  );
}

export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 min-w-0 text-foreground">{value}</div>
    </div>
  );
}

// ── 操作（引用リンク / テンプレートから新規 / 派生 / 共有解除） ──

export function SharedEntryActions({
  entry,
  isMine,
  onFork,
  onCreateFromTemplate,
  onUnshare,
}: {
  entry: SharedEntry;
  isMine: boolean;
  /** fork できる type かつ他人作のときだけ渡す（自分のものは派生しない） */
  onFork?: () => void;
  /** テンプレートのときだけ渡る（自分作・他人作を問わず出す） */
  onCreateFromTemplate?: () => void;
  onUnshare: () => void;
}) {
  const uiT = useT();
  // 「引用リンクをコピー」の完了フィードバック（1.5 秒だけチェック表示）
  const [citationCopied, setCitationCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(buildSharedCitationLink(entry.id));
          setCitationCopied(true);
          window.setTimeout(() => setCitationCopied(false), 1500);
        }}
        className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
        title={uiT("share.copyCitationHint")}
      >
        {citationCopied ? (
          <Check size={12} className="text-emerald-600" />
        ) : (
          <Link2 size={12} />
        )}
        {citationCopied ? uiT("share.copied") : uiT("share.copyCitation")}
      </button>
      {onCreateFromTemplate && (
        <button
          onClick={onCreateFromTemplate}
          className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
        >
          <FilePlus2 size={12} />
          {uiT("library.createFromTemplate")}
        </button>
      )}
      {onFork && !isMine && (
        <button
          onClick={onFork}
          className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
        >
          <GitFork size={12} />
          {entry.type === "knowledge"
            ? uiT("library.forkToKnowledge")
            : uiT("library.forkToNotes")}
        </button>
      )}
      {isMine && (
        <button
          onClick={onUnshare}
          className="px-3 py-1.5 text-xs rounded border border-border hover:bg-destructive/10 hover:border-destructive/50 hover:text-destructive transition-colors flex items-center gap-1"
        >
          <Trash2 size={12} />
          {uiT("library.unshare")}
        </button>
      )}
    </div>
  );
}

// ── 更新の履歴 ──

/** 同じ id を上書きした記録。0 件なら何も出さない（節ごと消す） */
export function SharedEntryHistory({ entry }: { entry: SharedEntry }) {
  const uiT = useT();
  const history = entry.history ?? [];
  if (history.length === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold text-foreground mb-1.5">
        {uiT("library.detail.history")}
      </h3>
      <ul className="text-[11px] text-muted-foreground space-y-1">
        {/* 新しい順に見せる（メタ情報の「更新」の隣に続く読み方） */}
        {[...history].reverse().map((h, i) => (
          <li key={`${h.hash}-${i}`} className="flex items-center gap-2">
            <span className="tabular-nums whitespace-nowrap">{formatDate(h.updated_at)}</span>
            <span className="truncate">{h.updated_by?.name ?? uiT("library.unknownAuthor")}</span>
            <span className="font-mono text-[10px] shrink-0" title={h.hash}>
              {h.hash.replace(/^sha256:/, "").slice(0, 8)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── 逆引き ──

/**
 * 逆引き（このエントリを指している共有ノート）。
 *
 * 元になるのは本文を読めた共有ノートの投影だけなので、読み込み前は少なく見える。
 * 0 件のときは何も出さない（「無い」と「まだ読めていない」を言い分けられないため、
 * 空の見出しを出して 0 件だと断言しない）。
 */
export function ReverseLinksSection({
  links,
  entryTitleById,
  onOpenEntry,
}: {
  links?: SharedReverseLinks;
  entryTitleById?: (id: string) => string | null;
  onOpenEntry?: (id: string) => void;
}) {
  const uiT = useT();
  const groups: { labelKey: string; ids: string[] }[] = [
    { labelKey: "library.detail.citedBy", ids: links?.cites ?? [] },
    { labelKey: "library.detail.forkedBy", ids: links?.forks ?? [] },
    { labelKey: "library.detail.templateUsedBy", ids: links?.templates ?? [] },
  ].filter((g) => g.ids.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      {groups.map(({ labelKey, ids }) => (
        <section key={labelKey}>
          <h3 className="text-xs font-semibold text-foreground mb-1.5">
            {uiT(labelKey, { count: String(ids.length) })}
          </h3>
          <ul className="space-y-0.5">
            {ids.map((id) => {
              const title = entryTitleById?.(id) ?? null;
              return (
                <li key={id}>
                  <button
                    onClick={() => onOpenEntry?.(id)}
                    // 相手のエントリが一覧に無い（未読込・共有解除）ときは押せない
                    disabled={!title || !onOpenEntry}
                    className="text-[11px] text-left text-primary hover:underline disabled:text-muted-foreground disabled:no-underline truncate max-w-full"
                    title={id}
                  >
                    {title ?? id}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
