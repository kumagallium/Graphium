// 設定タブの先頭に置く、そのタブの「いまの状態」1 行。
//
// AI タブは、モデル登録・割り当て・機能のオンオフ・MCP がすべて同じ並びに
// 積まれていて、初めて開いた人には「いま使えるのか」「次に何をすればいいのか」が
// どこにも書かれていなかった。設定の羅列より先に、結論と次の一手を置く。
//
// 枠の見た目はサイドバーの BackendUnavailableNotice に合わせてある（同じ
// 「状態を伝える箱」なので、アプリの中で 2 種類の見た目を増やさない）。

import { CheckCircle, AlertCircle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@ui/button";

export type SettingsStatusState = "ready" | "setup" | "unavailable";

export type SettingsStatusProps = {
  /** ready = 使える / setup = あと一手で使える / unavailable = この環境では使えない */
  state: SettingsStatusState;
  /** 結論の 1 行（「AI が使えます」「AI はまだつながっていません」） */
  title: string;
  /** 補足 1 行（使っているモデル名・使えない理由など） */
  description?: ReactNode;
  /** 次の一手。setup のときだけ置く想定で、複数は並べない */
  action?: { label: string; onClick: () => void; disabled?: boolean };
};

const ICONS = {
  ready: CheckCircle,
  setup: AlertCircle,
  unavailable: Info,
} as const;

const ICON_CLASS = {
  ready: "text-green-600",
  setup: "text-amber-500",
  unavailable: "text-muted-foreground",
} as const;

export function SettingsStatus({ state, title, description, action }: SettingsStatusProps) {
  const Icon = ICONS[state];

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-start gap-2">
      <Icon size={14} className={`mt-0.5 shrink-0 ${ICON_CLASS[state]}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      {action && (
        <Button size="sm" onClick={action.onClick} disabled={action.disabled} className="shrink-0">
          {action.label}
        </Button>
      )}
    </div>
  );
}
