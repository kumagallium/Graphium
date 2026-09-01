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
  // 先にキャプションを集める: 参照時に自動名がキャプションへ固定された表
  // （「表 1」という名前の表）があるとき、後から上に追加された表へ同じ
  // 自動名を振ると参照が乗っ取られてしまう。採番はキャプションを避けて進める
  const captions = new Set<string>();
  const tables: any[] = [];
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table") {
        tables.push(b);
        const caption = getCaption(b.id);
        if (caption) captions.add(caption);
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);

  const names = new Map<string, string>();
  let n = 0;
  for (const b of tables) {
    const caption = getCaption(b.id);
    if (caption) {
      names.set(b.id, caption);
      continue;
    }
    let autoName: string;
    do {
      n += 1;
      autoName = t("tableMeta.autoName", { n: String(n) });
    } while (captions.has(autoName));
    names.set(b.id, autoName);
  }
  return names;
}
