// スラッシュメニュー項目のアイコン。
//
// BlockNote 既定の項目（見出し・リスト・テーブル等）は 18px のアイコンを左に持つ
// （@blocknote/react の getDefaultReactSlashMenuItems が <Icon size={18} /> を付ける）。
// アプリ独自の項目にアイコンが無いと、題名が左端に寄ってグループ見出しと同じ見た目になり、
// どれが見出しでどれが項目か読み取れなかった。独自項目もここを通して同じ大きさで揃える。
// 項目の定義は .ts（JSX を書けない）なので、要素を作る所だけ .tsx に切り出してある。

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** 既定の項目と同じ大きさ */
const SLASH_ICON_SIZE = 18;

export function slashIcon(Icon: LucideIcon): ReactNode {
  return <Icon size={SLASH_ICON_SIZE} />;
}
