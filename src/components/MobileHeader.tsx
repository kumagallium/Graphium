// モバイル用ヘッダー（ハンバーガーメニュー + タイトル）

import { Menu } from "lucide-react";
import { useT } from "../i18n";
import { BrandLockup } from "../ui/brand-lockup";

type MobileHeaderProps = {
  onMenuToggle: () => void;
};

export function MobileHeader({ onMenuToggle }: MobileHeaderProps) {
  const t = useT();
  return (
    <header className="md:hidden flex items-center gap-3 px-3 py-2 border-b border-border bg-sidebar-background shrink-0">
      <button
        onClick={onMenuToggle}
        className="w-11 h-11 flex items-center justify-center rounded-lg text-foreground hover:bg-surface-hover transition-colors"
        aria-label={t("common.openMenu")}
      >
        <Menu size={22} />
      </button>
      <BrandLockup />
    </header>
  );
}
