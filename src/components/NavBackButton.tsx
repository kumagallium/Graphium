// ヘッダーの「戻る」ボタン
//
// ノート A を開いていて、そこからサイドピーク経由で別のノート B や素材へ飛んだあと、
// A へ戻るための導線。実体の履歴管理は use-hash-router の back() / canGoBack が持ち、
// このコンポーネントは「戻れるときだけ出す小さなアイコンボタン」に徹する。
//
// デスクトップアプリ（Tauri webview）には可視のブラウザ戻るボタンが無いため、
// アプリ内にこのボタンを置くことが戻る唯一の手段になる。

import { ArrowLeft } from "lucide-react";
import { useT } from "../i18n";

type Props = {
  /** 戻る操作。通常は router.back を渡す。 */
  onBack: () => void;
  /**
   * 戻れる履歴があるか。false のときは消さず、灰色の disabled 状態で表示する
   * （位置が常に一定なので、押せる/押せないの視覚差だけで戻れるかが分かる）。
   */
  canGoBack: boolean;
  /** 追加クラス（配置の微調整用）。 */
  className?: string;
};

export function NavBackButton({ onBack, canGoBack, className = "" }: Props) {
  const t = useT();
  const label = t("nav.back");
  return (
    <button
      type="button"
      onClick={onBack}
      disabled={!canGoBack}
      title={label}
      aria-label={label}
      className={`flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent disabled:hover:text-muted-foreground ${className}`}
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}
