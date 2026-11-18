// 素材の詳細に出す「元データ」の中身。リンクした素材（データの置き場のファイル）を、
// いま見ている素材の元データとして指定する。Graphium は元データの中身を読まない（人が指定した記録）。
//
// 見出し（ラベル）は呼び出し側（material-metadata-section）が付ける。出す条件は shouldShowLinkedOrigin。

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n";
import { FilterPopup, type FilterOption } from "../../ui/filter-popup";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import {
  canHaveLinkedOrigin,
  changeLinkedOrigins,
  linkedOriginPlace,
  linkedOriginsOf,
  listOriginCandidates,
  persistLinkedOrigins,
} from "./link-origin";

/** 節を出すか。対象外の素材・リンクした素材も指定済みの元データも無いときは出さない（ブラウザ版では自然に出ない） */
export function shouldShowLinkedOrigin(entry: MediaIndexEntry, index: MediaIndex | null | undefined): boolean {
  if (!index || !canHaveLinkedOrigin(entry)) return false;
  return listOriginCandidates(index).length > 0 || linkedOriginsOf(index, entry).length > 0;
}

export type LinkedOriginSectionProps = {
  entry: MediaIndexEntry;
  mediaIndex: MediaIndex;
  /** 元データの行を押したとき、その素材へ移る。未指定なら行は押せない */
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
  /** テスト・Storybook 用の差し替え */
  __test?: { persist?: (fileId: string, change: { add?: string[]; remove?: string[] }) => Promise<boolean> };
};

export function LinkedOriginSection({ entry, mediaIndex, onSwitchAsset, __test }: LinkedOriginSectionProps) {
  const t = useT();
  const persist = __test?.persist ?? persistLinkedOrigins;
  // 保存直後に表示へ反映するためのローカルの索引（親の読み直しが追いついたら props 側に揃う）
  const [index, setIndex] = useState<MediaIndex>(mediaIndex);
  useEffect(() => {
    setIndex(mediaIndex);
  }, [mediaIndex, entry.fileId]);
  const current = index.media.find((m) => m.fileId === entry.fileId) ?? entry;

  const origins = useMemo(() => linkedOriginsOf(index, current), [index, current]);
  const originIds = useMemo(() => origins.map((o) => o.fileId), [origins]);

  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [saveFailed, setSaveFailed] = useState(false);
  const apply = async (change: { add?: string[]; remove?: string[] }) => {
    const before = index;
    const result = changeLinkedOrigins(before, entry.fileId, change);
    if (!result.changed) return;
    setSaveFailed(false);
    setIndex(result.index);
    const saved = await persist(entry.fileId, change).catch(() => false);
    if (saved) return;
    // 保存できなかった指定を、できたように見せない
    setIndex(before);
    setSaveFailed(true);
  };

  const options: FilterOption[] = useMemo(() => {
    // アーカイブ済みでも、指定済みのものは選択状態が見えるように並べる
    const list = [...listOriginCandidates(index)];
    for (const o of origins) if (!list.includes(o)) list.push(o);
    return list.map((m) => {
      const { placeName } = linkedOriginPlace(m);
      return { value: m.fileId, label: placeName ? `${m.name} (${placeName})` : m.name };
    });
  }, [index, origins]);

  const openPicker = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPickerAnchor(rect);
  };

  const onPick = (next: string[]) => {
    const add = next.filter((id) => !originIds.includes(id));
    const remove = originIds.filter((id) => !next.includes(id));
    void apply({ add, remove });
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="linked-origin">
      {origins.length === 0 ? (
        <span className="text-xs text-muted-foreground/60">{t("linkedFile.origin.none")}</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {origins.map((o) => {
            const { placeName, relPath } = linkedOriginPlace(o);
            const where = [placeName, relPath].filter(Boolean).join(" / ");
            return (
              <li key={o.fileId} className="flex items-start gap-1.5">
                <div className="flex-1 min-w-0">
                  {onSwitchAsset ? (
                    <button
                      type="button"
                      onClick={() => onSwitchAsset(o)}
                      className="text-xs text-foreground hover:text-primary transition-colors text-left break-words"
                      aria-label={t("linkedFile.origin.open", { name: o.name })}
                    >
                      {o.name}
                    </button>
                  ) : (
                    <span className="text-xs text-foreground break-words">{o.name}</span>
                  )}
                  {where && <div className="text-[11px] text-muted-foreground break-all">{where}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => void apply({ remove: [o.fileId] })}
                  aria-label={t("linkedFile.origin.remove", { name: o.name })}
                  data-tooltip={t("linkedFile.origin.removeTooltip")}
                  className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <button
          ref={buttonRef}
          type="button"
          onClick={openPicker}
          className="text-[11px] text-muted-foreground underline hover:text-foreground"
        >
          {t("linkedFile.origin.set")}
        </button>
      </div>
      {saveFailed && (
        <div role="alert" className="text-[11px] text-destructive">
          {t("linkedFile.origin.saveFailed")}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground/80">{t("linkedFile.origin.note")}</div>
      {pickerAnchor && (
        <FilterPopup
          position={{ top: pickerAnchor.bottom + 4, left: pickerAnchor.left }}
          anchorRect={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
          title={t("linkedFile.origin.pickTitle")}
          options={options}
          selected={originIds}
          onChange={onPick}
          searchable
          searchPlaceholder={t("linkedFile.origin.search")}
          clearLabel={t("linkedFile.origin.clearAll")}
          emptyText={t("linkedFile.origin.empty")}
          noMatchText={t("linkedFile.origin.noMatch")}
          minWidth={260}
        />
      )}
    </div>
  );
}
