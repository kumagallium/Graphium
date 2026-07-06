// `@` メニューの「新しいノートを作成」で使う、ノート名入力ダイアログ。
//
// なぜ独立したダイアログなのか:
//   BlockNote のサジェストメニュー内で日本語を打つと、IME の変換確定（Enter）を
//   メニューが食ってしまい、変換が終わる頃にはメニューが閉じてノートを作れない。
//   通常の <input> なら IME 変換が正しく効くので、名前入力だけをここに切り出す。
//
// 使い方:
//   const { promptNoteName, dialog } = useNewNoteNamePrompt();
//   const title = await promptNoteName(prefill); // null ならキャンセル
//   ... {dialog} をコンポーネントのどこかで描画する

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { useT } from "../../i18n";

type DialogState = {
  initial: string;
  resolve: (value: string | null) => void;
};

export function NewNoteNameDialog({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // マウント時にフォーカスし、prefill があれば全選択して上書きしやすくする
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const submit = () => {
    const title = value.trim();
    if (!title) return;
    onConfirm(title);
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[18vh] px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{t("blockLink.newNoteDialogTitle")}</h2>
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            {...compositionHandlers}
            onKeyDown={(e) => {
              // IME 変換確定の Enter では送信しない。isComposing だけでは
              // WKWebView（デスクトップ）の compositionend → keydown(13) 順を
              // 取りこぼすため、共通ガードで判定する。
              if (e.key === "Enter" && !isImeKey(e)) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
            placeholder={t("editor.titlePlaceholder")}
            className="w-full bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/30">
          <p className="text-xs text-muted-foreground">{t("blockLink.newNoteDialogHint")}</p>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="px-3 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ノート名入力ダイアログを Promise ベースで開くフック。
 * promptNoteName(prefill) は作成時にタイトル文字列、キャンセル時に null を返す。
 * 返り値の dialog をコンポーネント内で描画すること。
 */
export function useNewNoteNamePrompt() {
  const [state, setState] = useState<DialogState | null>(null);

  const promptNoteName = useCallback(
    (initial: string) =>
      new Promise<string | null>((resolve) => {
        setState({ initial, resolve });
      }),
    [],
  );

  const dialog = state ? (
    <NewNoteNameDialog
      initial={state.initial}
      onConfirm={(title) => {
        state.resolve(title);
        setState(null);
      }}
      onCancel={() => {
        state.resolve(null);
        setState(null);
      }}
    />
  ) : null;

  return { promptNoteName, dialog };
}
