// 画像を選んだときのツールバーに出る「横のパネルで大きく見る」ボタン。
//
// 押すと素材のサイドピークが開く。全画面表示や素材の情報（付加情報・素材グラフ）への
// 入口もサイドピークの中にある。出す条件（開けない画像では出さない）は
// image-peek.ts の resolveImagePeekFileId が持つので、ここでは描くだけ。
// サイズは同じツールバーに並ぶ BlockNote 標準ボタンに合わせて 36px 角・rounded-md。

import { PanelRightOpen } from "lucide-react";
import { useT } from "../../i18n";

type Props = {
  onOpen: () => void;
};

export function ImageOpenPeekButton({ onOpen }: Props) {
  const t = useT();
  return (
    <button
      onClick={onOpen}
      data-tooltip={t("imagePeek.openName")}
      data-tooltip-usage={t("imagePeek.openUsage")}
      aria-label={t("imagePeek.openName")}
      className="bn-button inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 transition-colors"
      data-test="imageOpenPeekButton"
    >
      <PanelRightOpen size={18} />
    </button>
  );
}
