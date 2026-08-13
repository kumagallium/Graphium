// テーブルの表示名（キャプション + 無名の記録テーブルの自動名）
//
// 日時が自動で入るテーブル（旧・記録テーブル）は、名前を付けていなくても参照に
// 耐える表示名が要る（チャートの参照リストやキャプション）。学術文書の図表番号と
// 同じく文書順で「表 1」/ "Table 1" を振る。あくまで表示上のフォールバックで
// 保存はしない — テーブルの追加・削除で番号が振り直されるのは図表番号と同じ。
// 名前を付ければそれが勝つ。
//
// 名前を付けただけのふつうのテーブルは、その名前をそのまま表示名にする
// （自動番号は振らない。番号が要るほど参照されるのは記録テーブルだけという判断）。

import { t } from "../../i18n";

/** 文書順にテーブルを走査し、blockId → 表示名を返す。名前も自動名も無いテーブルは含まない */
export function computeTableDisplayNames(
  blocks: any[],
  hasAutoName: (blockId: string) => boolean,
  getCaption: (blockId: string) => string
): Map<string, string> {
  const names = new Map<string, string>();
  let n = 0;
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table") {
        const caption = getCaption(b.id);
        if (hasAutoName(b.id)) {
          n += 1;
          names.set(b.id, caption || t("tableMeta.autoName", { n: String(n) }));
        } else if (caption) {
          names.set(b.id, caption);
        }
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
  return names;
}
