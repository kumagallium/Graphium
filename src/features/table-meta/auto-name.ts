// テーブルの表示名（キャプション + 無名テーブルの自動名）
//
// すべてのテーブルに、学術文書の図表番号と同じく文書順で「表 1」/ "Table 1" を
// 振る。名前（キャプション）を付ければそれが勝つ。あくまで表示上のフォールバックで
// 保存はしない — テーブルの追加・削除で番号が振り直されるのは図表番号と同じ。
//
// 以前は日時が自動で入る記録テーブルだけに自動名を振っていたが、計算ブロック
// （table["表 1"]["列"]）とチャートが表示名で参照する以上、無名の表が参照
// できないのは発見性を損なうため、全テーブルに広げた。

import { t } from "../../i18n";

/** 文書順にテーブルを走査し、blockId → 表示名（キャプション or 自動名「表 N」）を返す */
export function computeTableDisplayNames(
  blocks: any[],
  getCaption: (blockId: string) => string
): Map<string, string> {
  const names = new Map<string, string>();
  let n = 0;
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table") {
        n += 1;
        const caption = getCaption(b.id);
        names.set(b.id, caption || t("tableMeta.autoName", { n: String(n) }));
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
  return names;
}
