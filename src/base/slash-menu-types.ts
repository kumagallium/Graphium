import type { ReactNode } from "react";

export type SlashMenuItem = {
  title: string;
  subtext?: string;
  group: string;
  aliases?: string[];
  /**
   * 項目の左に出すアイコン（base/slash-menu-icon の slashIcon で作る）。
   * BlockNote 既定の項目は全てアイコンを持つので、独自項目にも必ず付けて見た目を揃える
   * （無いと題名が左端に寄り、グループ見出しと見分けが付かない）
   */
  icon?: ReactNode;
  onItemClick: (editor: any) => void;
};
