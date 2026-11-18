// 列の選択: チェックの並び + 「すべて」「なし」
//
// 制御された部品。selected は選んだ列名（表の列の順に並べ直して返す）。
// チェックは横に流して折り返す（縦に並べると列が多い表で段が長くなる）。
// 折り返しても高さが決まった量を超えるときは中でスクロールし、後ろの操作を押し流さない。

import { t, useLocaleSubscription } from "../../../i18n";
import type { ColumnProfile } from "../types";

/** チェックの並びの最大の高さ（約 4 行）。超えたら中でスクロールする */
const MAX_HEIGHT = "max-h-24";

const ACTION =
  "px-2.5 py-1 text-[11px] rounded border border-border text-muted-foreground hover:bg-muted transition-colors";

export function ColumnChooser({
  columns,
  selected,
  onChange,
}: {
  columns: ColumnProfile[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  useLocaleSubscription();
  const chosen = new Set(selected);
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    // 並びは表の列の順に保つ（選んだ順にすると、書き出す CSV の列順が操作の順で変わる）
    onChange(columns.filter((c) => next.has(c.name)).map((c) => c.name));
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[11px] font-medium text-foreground mr-1">
          {t("dataExtract.column")}
        </span>
        <button type="button" className={ACTION} onClick={() => onChange(columns.map((c) => c.name))}>
          {t("dataExtract.all")}
        </button>
        <button type="button" className={ACTION} onClick={() => onChange([])}>
          {t("dataExtract.none")}
        </button>
      </div>
      <div
        className={`flex flex-wrap gap-x-3 gap-y-1 ${MAX_HEIGHT} overflow-y-auto`}
      >
        {columns.map((c) => (
          <label
            key={c.name}
            className="inline-flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer max-w-full"
          >
            <input type="checkbox" checked={chosen.has(c.name)} onChange={() => toggle(c.name)} />
            <span className="truncate">{c.name}</span>
            <span className="text-[10px] text-muted-foreground">
              {t(`dataExtract.kind.${c.kind}`)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
