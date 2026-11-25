// 記録 1 行。
// 並びは「いつ ｜ どこで・誰が ｜ 何を」。LP の絵（MomentsPicture の Found）の 1 行を、
// アプリの 4 種類の記録（ノート / AI のページ / 素材 / メモ）に合わせて作り直したもの。
import {
  ClipboardList,
  File,
  FileDown,
  FilePenLine,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  type LucideIcon,
  MessagesSquare,
  Mic,
  PenLine,
  Quote,
  Smartphone,
  Sparkles,
  SquareCheck,
  StickyNote,
  Table2,
  Users,
  Waypoints,
} from "lucide-react";
import "./record-dashboard.css";
import { type RecordCopy, useRecordCopy } from "./copy";
import { useLocale } from "../../i18n";
import { dayKeyOf, formatDate, formatTime } from "./model";
import type { RecordItem, RecordMediaType, RecordOrigin, RecordWho } from "./types";

/** 出どころごとのアイコンと色の系統。色は 3 系統＋無彩色に抑える */
export const ORIGIN_STYLE: Record<RecordOrigin, { icon: LucideIcon; tone: "plain" | "rose" | "amber" | "sky" | "forest" }> = {
  written: { icon: PenLine, tone: "plain" },
  recording: { icon: Mic, tone: "rose" },
  webClip: { icon: Globe, tone: "amber" },
  quote: { icon: Quote, tone: "amber" },
  aiChat: { icon: MessagesSquare, tone: "sky" },
  knowledge: { icon: Sparkles, tone: "sky" },
  phone: { icon: Smartphone, tone: "forest" },
  file: { icon: FileDown, tone: "plain" },
  template: { icon: LayoutTemplate, tone: "plain" },
  memo: { icon: StickyNote, tone: "plain" },
  shared: { icon: Users, tone: "plain" },
};

const MEDIA_ICON: Record<RecordMediaType, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Mic,
  pdf: FileText,
  url: Link2,
  document: FileText,
  data: Table2,
  conversation: MessagesSquare,
  other: File,
};

/** 探す言葉に当たる部分に印を付ける */
export function Marked({ text, query }: { text: string; query?: string }) {
  const q = query?.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
  }
  if (from === 0) return <>{text}</>;
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** 出どころの札（どこで） */
export function OriginBadge({ origin, copy }: { origin: RecordOrigin; copy: RecordCopy }) {
  const { icon: Icon, tone } = ORIGIN_STYLE[origin];
  return (
    <span className="rd-origin" data-tone={tone}>
      <Icon size={13} aria-hidden="true" />
      {copy.origin[origin]}
    </span>
  );
}

/** 更新の行の札。出どころの札の位置に置く（更新の行の「どこで」は、そのノート自身） */
export function UpdateBadge({ copy }: { copy: RecordCopy }) {
  return (
    <span className="rd-origin rd-origin-update" data-tone="plain">
      <FilePenLine size={13} aria-hidden="true" />
      {copy.updated}
    </span>
  );
}

/** 出どころの札。更新の行は「更新」の札に置き換える */
function WhereBadge({ item, copy }: { item: RecordItem; copy: RecordCopy }) {
  return item.update ? <UpdateBadge copy={copy} /> : <OriginBadge origin={item.origin} copy={copy} />;
}

/** 更新の行の題の下に、作った日を添える（古いノートを今日さわったことが分かるように） */
function CreatedOnLine({ item, copy }: { item: RecordItem; copy: RecordCopy }) {
  const { locale } = useLocale();
  if (!item.update) return null;
  const day = dayKeyOf(item.update.createdAt);
  if (!day) return null;
  return (
    <p className="rd-trace rd-created-on">
      <time dateTime={item.update.createdAt}>{copy.createdOn(formatDate(day, locale))}</time>
    </p>
  );
}

/** 残した人の印（線の上の点、凡例、絞り込みで同じ形を使う） */
export function WhoMark({ type }: { type: RecordWho["type"] }) {
  return <span className="rd-who-mark" data-who={type} aria-hidden="true" />;
}

/** 残した人（誰が）。query を渡すと、共有の作者の名前の当たった部分に印が付く */
export function WhoLabel({ who, copy, query }: { who: RecordWho; copy: RecordCopy; query?: string }) {
  if (who.type === "self") return <span className="rd-who">{copy.who.self}</span>;
  if (who.type === "other") {
    return (
      <span className="rd-who">
        <Marked text={who.name} query={query} />
        <span className="rd-who-note">{copy.who.shared}</span>
      </span>
    );
  }
  return (
    <span className="rd-who" data-ai="true">
      {who.type === "ai" ? copy.who.ai : copy.who.selfWithAi}
      {who.model && <span className="rd-model">{who.model}</span>}
    </span>
  );
}

function What({ item, query, copy }: { item: RecordItem; query?: string; copy: RecordCopy }) {
  // メモは題を持たないので、本文そのものが「何を」になる。引用は左に線を引いて区別する
  if (item.kind === "memo") {
    return (
      <p className="rd-text" data-quote={item.origin === "quote" ? "true" : undefined}>
        <Marked text={item.text ?? ""} query={query} />
      </p>
    );
  }
  const MediaIcon = item.mediaType ? MEDIA_ICON[item.mediaType] : null;
  return (
    <div className="rd-what" data-media={item.mediaType}>
      {MediaIcon && (
        <span className="rd-thumb" aria-hidden="true">
          <MediaIcon size={16} />
        </span>
      )}
      <div className="rd-what-main">
        <p className="rd-title">
          <Marked text={item.title ?? ""} query={query} />
        </p>
        {!item.update && (item.domain || item.detail || item.pageCount !== undefined) && (
          <p className="rd-detail">
            {item.domain && <span className="rd-domain">{item.domain}</span>}
            {item.detail && (
              <span>
                <Marked text={item.detail} query={query} />
              </span>
            )}
            {!item.detail && item.pageCount !== undefined && <span>{copy.pages(item.pageCount)}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

function Trace({ item, copy }: { item: RecordItem; copy: RecordCopy }) {
  if (!item.trace || item.update) return null;
  return (
    <p className="rd-trace">
      <Waypoints size={12} aria-hidden="true" />
      {item.trace.type === "usedIn" ? copy.usedIn(item.trace.count) : copy.sources(item.trace.count)}
    </p>
  );
}

/**
 * 共有された記録が計画の行のものなら「計画の題 › 行の名前」を、チェックリストがあれば
 * 共有した時点の件数（3/5）を添える。どちらも共有の封筒に入っている値で、本文は読まない。
 * 件数は数えた結果をそのまま出す。色は付けず、割合や棒にもしない
 */
function PlanRowLine({ item, query, copy }: { item: RecordItem; query?: string; copy: RecordCopy }) {
  if (!item.planRow) return null;
  return (
    <p className="rd-trace rd-planrow">
      <span className="rd-planrow-name">
        <ClipboardList size={12} aria-hidden="true" />
        <span className="rd-planrow-plan">
          <Marked text={item.planRow.planTitle || copy.planRowFallback} query={item.planRow.planTitle ? query : undefined} />
        </span>
        {item.planRow.rowName && (
          <>
            <span className="rd-planrow-sep" aria-hidden="true">›</span>
            <span>
              <Marked text={item.planRow.rowName} query={query} />
            </span>
          </>
        )}
      </span>
      {item.checks && (
        <span
          className="rd-checks"
          role="img"
          aria-label={copy.checksHint(item.checks.checked, item.checks.total)}
          data-tooltip={copy.checksHint(item.checks.checked, item.checks.total)}
        >
          <SquareCheck size={12} aria-hidden="true" />
          {item.checks.checked}/{item.checks.total}
        </span>
      )}
    </p>
  );
}

export type RecordRowProps = {
  item: RecordItem;
  /** 探す言葉。当たった部分に印が付く */
  query?: string;
  /** rail = 時刻の右に線を通す並び / ledger = いつ・どこで・誰が・何を の 4 列 */
  variant?: "rail" | "ledger";
  /** 探す言葉に当たらなかった行を薄くする（消さずに残す構図で使う） */
  dim?: boolean;
  /** 日付も出す（日のまとまりの外で 1 行だけ見せるとき） */
  dateLabel?: string;
  /** 見つかった記録の側で指している行（色を付けて、同じ記録だと示す） */
  active?: boolean;
  /** 行を押したとき（Enter でも）。渡さなければ、行は押せるものとして振る舞わない */
  onOpen?: (item: RecordItem) => void;
};

export function RecordRow({ item, query, variant = "rail", dim, dateLabel, active, onOpen }: RecordRowProps) {
  const copy = useRecordCopy();
  const openProps = onOpen
    ? {
        onClick: () => onOpen(item),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" && e.target === e.currentTarget) onOpen(item);
        },
      }
    : {};
  const time = (
    <time className="rd-time" dateTime={item.at}>
      {dateLabel && <span className="rd-time-date">{dateLabel}</span>}
      {formatTime(item.at)}
    </time>
  );

  if (variant === "ledger") {
    return (
      <li
        className="rd-lrow"
        data-record-id={item.id}
        data-kind={item.kind}
        data-event={item.update ? "updated" : undefined}
        data-dim={dim ? "true" : undefined}
        data-active={active ? "true" : undefined}
        tabIndex={0}
        {...openProps}
      >
        {time}
        <span className="rd-lcell rd-lcell-where">
          <WhereBadge item={item} copy={copy} />
        </span>
        <span className="rd-lcell rd-lcell-who">
          <WhoMark type={item.who.type} />
          <WhoLabel who={item.who} copy={copy} query={query} />
        </span>
        <div className="rd-lcell rd-lcell-what">
          <What item={item} query={query} copy={copy} />
          <PlanRowLine item={item} query={query} copy={copy} />
          <Trace item={item} copy={copy} />
          <CreatedOnLine item={item} copy={copy} />
        </div>
        <span className="rd-kind">{copy.kind[item.kind]}</span>
      </li>
    );
  }

  return (
    <li
      className="rd-row"
      data-record-id={item.id}
      data-kind={item.kind}
      data-event={item.update ? "updated" : undefined}
      data-dim={dim ? "true" : undefined}
      data-active={active ? "true" : undefined}
      tabIndex={0}
      {...openProps}
    >
      {time}
      <span className="rd-node">
        <WhoMark type={item.who.type} />
      </span>
      <div className="rd-body">
        <p className="rd-meta">
          <WhereBadge item={item} copy={copy} />
          <WhoLabel who={item.who} copy={copy} query={query} />
          <span className="rd-kind">{copy.kind[item.kind]}</span>
        </p>
        <What item={item} query={query} copy={copy} />
        <PlanRowLine item={item} query={query} copy={copy} />
        <Trace item={item} copy={copy} />
        <CreatedOnLine item={item} copy={copy} />
      </div>
    </li>
  );
}
