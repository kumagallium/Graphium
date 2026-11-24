// アプリ内の確認ダイアログ。window.confirm の代わりに使う。
//
// なぜ window.confirm を使わないか:
//   デスクトップ版（Tauri）では tauri-plugin-dialog が起動時に window.confirm を
//   `async function` に差し替える（init-iife.js）。同期で `if (!window.confirm(...))` と
//   書くと Promise（= truthy）を受け取り、確認が出る前に「はい」で進んでしまう。
//   さらに既定の権限（dialog:default）に confirm が無いので、ダイアログ自体も出ない
//   （コンソールに「dialog.confirm not allowed. Command not found」）。
//   版の削除やゴミ箱へ移すといった取り返しのつかない操作の確認が、デスクトップでは
//   素通りしていた（2026-11-06 に debug .app で確認）。
//
// 使い方:
//   const ok = await confirmAction(t("version.deleteConfirm"), { destructive: true });
//   if (!ok) return;
//   アプリのルートに <ConfirmHost /> を 1 つだけ置く。ホストが無いとき（テスト・Storybook・
//   ホストを置き忘れた画面）は false を返す（黙って進めない）。
//
// ブラウザ版でも同じ見た目で出す（同期の window.confirm と挙動を分けない）。

import { CONFIRM_LAYER } from "./z-layers";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { t } from "../i18n";

export type ConfirmOptions = {
  /** 確認ボタンの文言（省くと「OK」） */
  confirmLabel?: string;
  /** 取り消しボタンの文言（省くと「キャンセル」） */
  cancelLabel?: string;
  /** 取り返しのつかない操作（削除など）。確認ボタンを赤にする */
  destructive?: boolean;
};

/** 3 択の答え。confirm = 主のボタン、secondary = 2 つ目のボタン、cancel = 取り消し・閉じる・Esc */
export type ChoiceAnswer = "confirm" | "secondary" | "cancel";

export type ChoiceOptions = ConfirmOptions & {
  /** 2 つ目のボタンの文言（取り消しと主のボタンの間に、枠線のボタンで出す） */
  secondaryLabel: string;
};

type Pending = ConfirmOptions & {
  message: string;
  /** 3 択のときだけ */
  secondaryLabel?: string;
  resolve: (answer: ChoiceAnswer) => void;
};

let listener: ((p: Pending) => void) | null = null;

/** テスト用: 次に出る確認に答える関数を差し込む（null で外す） */
let testResponder: ((message: string, options: ConfirmOptions) => boolean | Promise<boolean>) | null = null;
export function __setConfirmResponderForTest(
  responder: ((message: string, options: ConfirmOptions) => boolean | Promise<boolean>) | null,
): void {
  testResponder = responder;
}

/** テスト用: 次に出る 3 択に答える関数を差し込む（null で外す） */
let testChoiceResponder: ((message: string, options: ChoiceOptions) => ChoiceAnswer | Promise<ChoiceAnswer>) | null = null;
export function __setChoiceResponderForTest(
  responder: ((message: string, options: ChoiceOptions) => ChoiceAnswer | Promise<ChoiceAnswer>) | null,
): void {
  testChoiceResponder = responder;
}

/**
 * 確認を出して、押されるまで待つ。「OK」なら true、キャンセル・閉じる・Esc なら false。
 * ホスト（<ConfirmHost />）が無ければ false。
 */
export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (testResponder) return Promise.resolve(testResponder(message, options));
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener({ ...options, message, resolve: (answer) => resolve(answer === "confirm") });
  });
}

/**
 * 3 択を出して、押されるまで待つ（例:「外して共有」「そのまま共有」「キャンセル」）。
 * ホスト（<ConfirmHost />）が無ければ "cancel"（黙って進めない）。
 */
export function chooseAction(message: string, options: ChoiceOptions): Promise<ChoiceAnswer> {
  if (testChoiceResponder) return Promise.resolve(testChoiceResponder(message, options));
  return new Promise((resolve) => {
    if (!listener) {
      resolve("cancel");
      return;
    }
    listener({ ...options, message, resolve });
  });
}

/** 確認ダイアログを描く場所。アプリのルートに 1 つだけ置く */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const own = (p: Pending) =>
      setPending((prev) => {
        // 前の確認が残っていれば断った扱いで閉じる（答えを宙に浮かせない）
        prev?.resolve("cancel");
        return p;
      });
    listener = own;
    return () => {
      if (listener === own) listener = null;
    };
  }, []);

  useEffect(() => {
    // 開いたら「キャンセル」に焦点を置く（Enter の押し間違いで破壊的な操作に進まない）
    if (pending) cancelRef.current?.focus();
  }, [pending]);

  if (!pending) return null;
  const answer = (choice: ChoiceAnswer | boolean) => {
    pending.resolve(choice === true ? "confirm" : choice === false ? "cancel" : choice);
    setPending(null);
  };
  return (
    <div
      className={`fixed inset-0 ${CONFIRM_LAYER} flex items-center justify-center bg-black/40`}
      role="alertdialog"
      aria-modal="true"
      aria-label={pending.message}
      data-testid="confirm-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          answer(false);
        }
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md max-h-[90dvh] flex flex-col p-5 gap-4">
        {/* 本文が長いときは本文だけスクロールし、ボタンは常に見える位置に置く */}
        <p className="text-sm text-foreground flex items-start gap-2 whitespace-pre-wrap break-words min-h-0 overflow-y-auto">
          {pending.destructive && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />}
          <span className="min-w-0">{pending.message}</span>
        </p>
        <div className="flex justify-end gap-2 shrink-0">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => answer(false)}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"
          >
            {pending.cancelLabel ?? t("common.cancel")}
          </button>
          {pending.secondaryLabel && (
            <button
              type="button"
              onClick={() => answer("secondary")}
              className="px-3 py-1.5 text-xs rounded-md border border-border text-foreground hover:bg-muted"
            >
              {pending.secondaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => answer(true)}
            className={`px-3 py-1.5 text-xs rounded-md hover:opacity-90 ${
              pending.destructive
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {pending.confirmLabel ?? t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
