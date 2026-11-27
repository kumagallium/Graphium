// アプリ全体のエラーバウンダリ。
//
// 描画中（effect を含む）に投げられた例外は、捕まえる境界が無いと React がツリーを丸ごと外し、
// 画面が真っ白のまま何も残らない（直前の操作も、何が起きたかも分からない）。
// ここで受けて、再読み込みの入口と、問い合わせに使えるエラーの中身を出す。
// 中身は端末にも残す（再読み込み・再起動のあとでも、設定などから読み返せるように）。

import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./button";

/** 最後に捕まえた描画エラーを残すキー（端末ごと。1 件だけ上書きで持つ） */
export const LAST_CRASH_KEY = "graphium:last-render-crash";

export type CrashRecord = {
  at: string;
  message: string;
  stack?: string;
  componentStack?: string;
  /** 起きたときに開いていた画面（ハッシュ。ノート id などで、本文は含まない） */
  location?: string;
};

/** 捕まえたエラーを、問い合わせに貼れる 1 つの文字列にする */
export function formatCrash(rec: CrashRecord): string {
  return [
    `${rec.at} ${rec.message}`,
    rec.location ? `at ${rec.location}` : "",
    rec.stack ? `\n${rec.stack}` : "",
    rec.componentStack ? `\nComponent stack:${rec.componentStack}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function saveCrash(rec: CrashRecord): void {
  try {
    localStorage.setItem(LAST_CRASH_KEY, JSON.stringify(rec));
  } catch {
    // 保存できなくても画面は出す
  }
}

type Props = { children: ReactNode };
type State = { crash: CrashRecord | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { crash: null };

  static getDerivedStateFromError(error: unknown): State {
    const err = error instanceof Error ? error : new Error(String(error));
    // 包まれた本当の原因も残す。BlockNote は initialContent の失敗を
    // 「Error creating document from blocks…」で包み、中身を cause に入れるので、
    // message だけだと何が合わなかったのか問い合わせから辿れない
    const causes: string[] = [];
    let cause: unknown = (err as { cause?: unknown }).cause;
    while (cause && causes.length < 3) {
      causes.push(cause instanceof Error ? cause.message || cause.name : String(cause));
      cause = cause instanceof Error ? (cause as { cause?: unknown }).cause : undefined;
    }
    const base = err.message || err.name || "Unknown error";
    return {
      crash: {
        at: new Date().toISOString(),
        message: causes.length ? `${base} (cause: ${causes.join(" ← ")})` : base,
        stack: err.stack,
        location: typeof location !== "undefined" ? location.hash : undefined,
      },
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[AppErrorBoundary] 描画中のエラーで画面を外しました:", error, info.componentStack);
    const crash = this.state.crash ?? AppErrorBoundary.getDerivedStateFromError(error).crash!;
    const rec: CrashRecord = { ...crash, componentStack: info.componentStack ?? undefined };
    saveCrash(rec);
    this.setState({ crash: rec });
  }

  render() {
    if (this.state.crash) return <CrashScreen crash={this.state.crash} />;
    return this.props.children;
  }
}

export function CrashScreen({ crash }: { crash: CrashRecord }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const text = formatCrash(crash);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="flex w-full max-w-lg flex-col gap-4">
        <h1 className="text-base font-semibold">{t("crash.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("crash.body")}</p>
        <div className="flex gap-2">
          <Button onClick={() => location.reload()}>{t("startup.reload")}</Button>
          <Button variant="outline" onClick={copy}>
            {copied ? t("crash.copied") : t("crash.copy")}
          </Button>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{t("crash.details")}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border p-2">
            {text}
          </pre>
        </details>
      </div>
    </div>
  );
}
