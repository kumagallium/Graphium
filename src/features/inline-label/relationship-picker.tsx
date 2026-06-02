// 関係指定ピッカー（汎用 Modal）
// Phase F (2026-05-01): Entity merge / Parameter parent / prev-step linking で共有
//
// 候補は { id, chips, secondary } の共通スキーマで受け取り、見た目を統一する。
// 候補が多いときは検索フィルタ + サブセクション折り畳みで対応。

import { useMemo, useState } from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "../../ui/modal";
import { useT } from "../../i18n";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

export type ChipStyle = {
  bg: string;
  border: string;
};

export type PickerCandidate = {
  /** 候補一意キー（onSelect で返される） */
  id: string;
  /** 表示する chip 群（ハイライト見た目） */
  chips: { text: string; style: ChipStyle }[];
  /** 二次情報（"3 ブロック" 等）。任意 */
  secondary?: string;
  /** 任意の追加データ（呼び出し側で利用） */
  payload?: unknown;
};

export type PickerSection = {
  /** セクションヘッダ（意図ベース: "紐付け先を変更" / "同一化" 等） */
  title?: string;
  /** 現在の状態表示（"現在: NaCl" 等）。chip + ラベル */
  current?:
    | { kind: "chip"; label: string; chip: { text: string; style: ChipStyle } }
    | { kind: "text"; label: string; text: string };
  /** セクション内の候補。空の場合は emptyMessage を表示 */
  candidates: PickerCandidate[];
  /** このセクションが空のときに表示するメッセージ */
  emptyMessage?: string;
  /** 候補選択時のハンドラ。指定が無ければ onSelect が使われる */
  onSelect?: (candidate: PickerCandidate) => void;
  /** セクションごとの「リセット」アクション（例: "最寄り推論に戻す"） */
  resetAction?: {
    label: string;
    onClick: () => void;
  };
  /** 入れ子のサブセクション（小見出しで字下げ表示） */
  subsections?: PickerSection[];
  /** サブセクションを既定で折り畳む */
  defaultCollapsed?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Modal タイトル */
  title: string;
  /** 説明文（任意） */
  description?: string;
  /** 「対象」ラベル + chip（マージ元 / 編集対象） */
  source?: {
    label?: string;
    chip?: { text: string; style: ChipStyle };
    typeName?: string;
  };
  /** 候補リスト（単一セクション）または複数セクション。どちらか必須 */
  candidates?: PickerCandidate[];
  sections?: PickerSection[];
  /** 候補が空の時に表示するメッセージ（candidates 使用時） */
  emptyMessage?: string;
  /** 候補選択時（sections 内のセクション固有 onSelect が無いときの既定） */
  onSelect?: (candidate: PickerCandidate) => void;
  /** 「関係を解除」のラベル（指定すると Footer に表示） */
  unlinkLabel?: string;
  /** 「関係を解除」クリック時 */
  onUnlink?: () => void;
};

// 候補件数を再帰カウント（subsections 含む）
function totalCandidateCount(sec: PickerSection): number {
  return (
    sec.candidates.length +
    (sec.subsections?.reduce((acc, s) => acc + totalCandidateCount(s), 0) ?? 0)
  );
}

// 検索フィルタ（chips text + secondary を case-insensitive 部分一致）
function matchesQuery(c: PickerCandidate, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  if (c.chips.some((ch) => ch.text.toLowerCase().includes(ql))) return true;
  if (c.secondary?.toLowerCase().includes(ql)) return true;
  return false;
}

function filterSection(sec: PickerSection, q: string): PickerSection {
  if (!q) return sec;
  return {
    ...sec,
    candidates: sec.candidates.filter((c) => matchesQuery(c, q)),
    subsections: sec.subsections?.map((s) => filterSection(s, q)),
  };
}

function PickerBody({
  sections,
  fallbackOnSelect,
  fallbackEmptyMessage,
}: {
  sections: PickerSection[];
  fallbackOnSelect?: (c: PickerCandidate) => void;
  fallbackEmptyMessage?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");

  // 検索閾値: 全セクション合計が 6 以上なら search を出す
  const totalCount = useMemo(
    () => sections.reduce((acc, s) => acc + totalCandidateCount(s), 0),
    [sections],
  );
  const showSearch = totalCount >= 6;

  const filteredSections = useMemo(
    () => sections.map((s) => filterSection(s, query.trim())),
    [sections, query],
  );

  return (
    <>
      {showSearch && (
        <div className="mb-2 relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("linking.searchPlaceholder")}
            autoFocus
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
      <div className="flex flex-col gap-4 max-h-[60dvh] overflow-y-auto">
        {filteredSections.map((sec, sIdx) => (
          <SectionView
            key={sIdx}
            section={sec}
            level={0}
            fallbackOnSelect={fallbackOnSelect}
            fallbackEmptyMessage={fallbackEmptyMessage}
            forceExpanded={query.trim().length > 0}
          />
        ))}
      </div>
    </>
  );
}

function SectionView({
  section: sec,
  level,
  fallbackOnSelect,
  fallbackEmptyMessage,
  forceExpanded = false,
}: {
  section: PickerSection;
  level: number;
  fallbackOnSelect?: (c: PickerCandidate) => void;
  fallbackEmptyMessage?: string;
  forceExpanded?: boolean;
}) {
  const subHasContent = (sec.subsections ?? []).some(
    (s) => totalCandidateCount(s) > 0,
  );
  const collapsible = !!sec.defaultCollapsed && level > 0;
  const [collapsed, setCollapsed] = useState<boolean>(!!sec.defaultCollapsed);
  const isCollapsed = collapsible && !forceExpanded && collapsed;

  // タイトル: 最上位は font-semibold + やや大、ネストは小さめ・ライト
  const titleClass =
    level === 0
      ? "text-[12px] font-semibold text-foreground px-1"
      : "text-[10px] font-medium text-muted-foreground px-1";
  const indentClass = level > 0 ? "pl-3 border-l-2 border-border ml-1" : "";

  const titleNode = sec.title ? (
    collapsible ? (
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={`${titleClass} flex items-center gap-1 hover:text-foreground bg-transparent border-none cursor-pointer text-left w-full`}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>{sec.title}</span>
        <span className="text-[10px] text-muted-foreground/60 normal-case font-normal">
          ({totalCandidateCount(sec)})
        </span>
      </button>
    ) : (
      <div className={titleClass}>{sec.title}</div>
    )
  ) : null;

  return (
    <div className={`flex flex-col gap-1.5 ${indentClass}`}>
      {titleNode}
      {isCollapsed ? null : (
      <>
      {/* sec.title may already be rendered above */}
      {false && sec.title && <div className={titleClass}>{sec.title}</div>}
      {sec.current && (
        <div className="px-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{sec.current.label}:</span>
          {sec.current.kind === "chip" ? (
            <ChipView chip={sec.current.chip} />
          ) : (
            <span className="italic">{sec.current.text}</span>
          )}
          {sec.resetAction && (
            <button
              type="button"
              onClick={sec.resetAction.onClick}
              className="ml-auto text-[10px] underline text-muted-foreground hover:text-foreground"
            >
              {sec.resetAction.label}
            </button>
          )}
        </div>
      )}
      {sec.candidates.length === 0 ? (
        // サブセクションに候補があれば親セクションの empty message は出さない
        subHasContent ? null : (
          <p className="text-xs text-muted-foreground py-2 px-1 italic">
            {sec.emptyMessage ?? fallbackEmptyMessage ?? ""}
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-1">
          {sec.candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => (sec.onSelect ?? fallbackOnSelect)?.(c)}
                className="w-full text-left px-3 py-2 rounded border border-border hover:bg-muted/40 transition-colors"
                data-test="relationship-picker-candidate"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {c.chips.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground italic">
                      (empty)
                    </span>
                  ) : (
                    c.chips
                      .slice(0, 4)
                      .map((chip, i) => <ChipView key={i} chip={chip} />)
                  )}
                  {c.chips.length > 4 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{c.chips.length - 4}
                    </span>
                  )}
                </div>
                {c.secondary && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {c.secondary}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {sec.subsections && sec.subsections.length > 0 && (
        <div className="flex flex-col gap-3 mt-1">
          {sec.subsections.map((sub, i) => (
            <SectionView
              key={i}
              section={sub}
              level={level + 1}
              fallbackOnSelect={fallbackOnSelect}
              fallbackEmptyMessage={fallbackEmptyMessage}
              forceExpanded={forceExpanded}
            />
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}

function ChipView({ chip }: { chip: { text: string; style: ChipStyle } }) {
  return (
    <span
      className="inline-block px-1.5 rounded text-[12px]"
      style={{
        backgroundColor: chip.style.bg,
        borderBottom: `1px solid ${chip.style.border}`,
      }}
    >
      {chip.text}
    </span>
  );
}

export function RelationshipPicker({
  open,
  onClose,
  title,
  description,
  source,
  candidates,
  sections,
  emptyMessage,
  onSelect,
  unlinkLabel,
  onUnlink,
}: Props) {
  const t = useT();
  const renderSections: PickerSection[] =
    sections ?? [
      {
        candidates: candidates ?? [],
        emptyMessage,
        onSelect,
      },
    ];
  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-[480px] max-w-[90vw]">
        <ModalHeader onClose={onClose}>{title}</ModalHeader>
        <ModalBody>
          {description && (
            <p className="text-xs text-muted-foreground mb-3">{description}</p>
          )}
          {source?.chip && (
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              {source.label && (
                <span className="text-[11px] text-muted-foreground">
                  {source.label}:
                </span>
              )}
              <ChipView chip={source.chip} />
              {source.typeName && (
                <span className="text-[10px] text-muted-foreground">
                  ({source.typeName})
                </span>
              )}
            </div>
          )}

          <PickerBody
            sections={renderSections}
            fallbackOnSelect={onSelect}
            fallbackEmptyMessage={emptyMessage}
          />
        </ModalBody>
        <ModalFooter>
          {unlinkLabel && onUnlink && (
            <button
              type="button"
              onClick={() => {
                onUnlink();
                onClose();
              }}
              className="mr-auto text-xs px-3 py-1.5 rounded border border-border text-destructive hover:bg-destructive/5"
            >
              {unlinkLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted/40"
          >
            {t("common.cancel")}
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
