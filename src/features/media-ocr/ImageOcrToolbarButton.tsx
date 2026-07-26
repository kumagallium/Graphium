// 画像を選んだときのツールバーに出る「文字を読む / 読んだ文字を見る」ボタン。
//
// ドラッグハンドルのメニュー内だけだと入口が見つけづらいため、画像をクリック
// すれば必ず目に入るこのツールバーを主導線にする。
// 未読なら押すと OCR が走り、読み取り済みなら押すと抽出テキストが開く。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ScanText, FileText, Copy, Check, RefreshCw } from "lucide-react";
import { useT } from "../../i18n";
import { useMediaOcrStore } from "./store";
import { runOcrForImage } from "./run-ocr";

type Props = {
  blockId: string;
  /** 画像ブロックの props.url（プロバイダ内部スキームのままで可） */
  imageUrl: string;
};

export function ImageOcrToolbarButton({ blockId, imageUrl }: Props) {
  const t = useT();
  const store = useMediaOcrStore();
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const entry = store.getEntry(blockId);
  const text = entry?.text?.trim() ?? "";
  const charCount = text ? text.replace(/\s/g, "").length : 0;

  // 別の画像を選び直したらパネルは畳む（前の画像のテキストが残らないように）
  useEffect(() => {
    setOpen(false);
  }, [blockId]);

  const run = useCallback(async () => {
    if (running || !imageUrl) return;
    setRunning(true);
    try {
      const result = await runOcrForImage(imageUrl);
      // 文字が取れなかった画像はエントリを残さない（検索ノイズを避ける）
      store.setEntry(blockId, result.text ? result : null);
      if (result.text) {
        setAnchor(rectOf(btnRef.current));
        setOpen(true);
      }
    } catch (e) {
      console.warn("OCR に失敗:", e);
    } finally {
      setRunning(false);
    }
  }, [running, imageUrl, store, blockId]);

  const toggle = useCallback(() => {
    if (charCount > 0) {
      setAnchor(rectOf(btnRef.current));
      setOpen((v) => !v);
    } else {
      void run();
    }
  }, [charCount, run]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可環境は無視 */
    }
  }, [text]);

  const label = running
    ? t("ocr.running")
    : charCount > 0
      ? `${t("ocr.done")}（${t("ocr.chars", { count: String(charCount) })}）`
      : t("ocr.readText");

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title={label}
        disabled={running}
        // サイズ・角丸は同じツールバーに並ぶ BlockNote 標準ボタン（36px 角・rounded-md）に合わせる。
        // padding 無しだとアイコン幅（18px）のままになり、隣のボタンと詰まって見える。
        className={[
          "bn-button inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors",
          charCount > 0
            ? "text-[#4B7A52] hover:bg-[rgba(75,122,82,0.12)]"
            : "text-muted-foreground hover:bg-black/5",
        ].join(" ")}
        data-test="imageOcrButton"
      >
        {running ? (
          <Loader2 size={18} className="animate-spin" />
        ) : charCount > 0 ? (
          <FileText size={18} />
        ) : (
          <ScanText size={18} />
        )}
      </button>

      {open && charCount > 0 && anchor &&
        createPortal(
          <>
            {/* 外側クリックで閉じる透明レイヤー */}
            <div
              className="fixed inset-0 z-[9998]"
              onMouseDown={() => setOpen(false)}
            />
            <div
              className="fixed z-[9999] w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-card shadow-lg"
              style={{ top: anchor.top, left: anchor.left }}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-xs font-semibold text-foreground">
                  {t("ocr.done")}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {t("ocr.chars", { count: String(charCount) })}
                    {entry?.confidence ? ` · ${entry.confidence}%` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => void copy()}
                    title={t("ocr.copy")}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-black/5"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  <button
                    onClick={() => void run()}
                    title={t("ocr.readText")}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-black/5"
                  >
                    <RefreshCw size={12} />
                  </button>
                </span>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-foreground">
                {text}
              </pre>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** ボタンの真下・左揃えでパネルを出すための位置。画面外にははみ出させない。 */
function rectOf(el: HTMLElement | null): { top: number; left: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const width = Math.min(448, window.innerWidth - 32);
  return {
    top: Math.min(r.bottom + 6, window.innerHeight - 120),
    left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)),
  };
}
