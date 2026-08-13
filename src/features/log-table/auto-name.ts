// 無名の記録テーブルの自動名（「表 1」/ "Table 1"）
//
// 名前を付けていない記録テーブルにも参照に耐える表示名が要る（チャートの
// 参照リストやキャプション）。学術文書の図表番号と同じく文書順で振る。
// あくまで表示上のフォールバックで、保存はしない — テーブルの追加・削除で
// 番号が振り直されるのは図表番号と同じ振る舞い。名前を付ければそれが勝つ。

import { t } from "../../i18n";

/** 文書順に記録テーブルを数え、blockId → 表示名（自動名込み）を返す */
export function computeLogTableDisplayNames(
  blocks: any[],
  isLogTable: (blockId: string) => boolean,
  getName: (blockId: string) => string
): Map<string, string> {
  const names = new Map<string, string>();
  let n = 0;
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table" && isLogTable(b.id)) {
        n += 1;
        names.set(b.id, getName(b.id) || t("logTable.autoName", { n: String(n) }));
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
  return names;
}
