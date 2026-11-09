import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

// 承認済み画像の透過部分を使い、輪郭を変えずにテーマ色へ揃える。
function maskStyle(file: string): CSSProperties {
  const image = `url("${import.meta.env.BASE_URL}${file}")`;
  return {
    maskImage: image,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    maskMode: "alpha",
    // macOS の Tauri WebView でも同じ透過マスクを使う。
    WebkitMaskImage: image,
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
  };
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Graphium"
      className={cn("inline-flex shrink-0 items-center gap-2 text-muted-foreground", className)}
    >
      {/* 強制配色時もマスクの輪郭を保つため、塗りにはシステム文字色を使う。 */}
      <span aria-hidden="true" className="h-6 w-6 shrink-0 bg-current forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none" style={maskStyle("logo.png")} />
      {/* マークと文字の G の横線を揃えるため、文字を下へ 2px 光学補正する。 */}
      <span aria-hidden="true" className="h-[18px] w-[81px] shrink-0 translate-y-[2px] bg-current forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none" style={maskStyle("logo-text.png")} />
    </span>
  );
}
