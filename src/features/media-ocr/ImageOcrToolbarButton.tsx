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
import { mirrorOcrToMediaIndex } from "./mirror-to-media-index";
import { safeOcrNumber, sanitizeAltText, sanitizeOcrText } from "../../lib/ocr-text";
import { type Rect, useFloatingPlacement } from "../../ui/floating-position";

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
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // 結果パネルの実寸を測って、画面に収まる側・高さへ置く（下に収まらなければ上へ反転）
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);

  const rawEntry = store.getEntry(blockId);
  const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : undefined;
  // mediaOcr は共有フォルダの他人のノートからも来る。文字列でない値で落ちないようにする
  const text = sanitizeOcrText(entry?.text) ?? "";
  const charCount = text ? text.replace(/\s/g, "").length : 0;
  // 表示用の text が空でも、別の読み（検索用）だけがある状態がありうる
  const altText = sanitizeAltText(entry?.altText) ?? "";
  const hasReading = charCount > 0 || altText !== "";
  const placed = useFloatingPlacement(anchor, panelEl, open, { gap: 6 }, [text]);

  // 別の画像を選び直したらパネルは畳む（前の画像のテキストが残らないように）
  useEffect(() => {
    setOpen(false);
  }, [blockId]);

  const run = useCallback(async () => {
    if (running || !imageUrl) return;
    setRunning(true);
    try {
      const result = await runOcrForImage(imageUrl);
      // 文字が取れなかった画像はエントリを残さない（検索ノイズを避ける）。
      // text が空でも別の読み（検索用）があれば残す
      const got = !!(result.text || result.altText);
      store.setEntry(blockId, got ? result : null);
      // 素材側にも写して、素材ギャラリー・Cmd+K から同じ文字で引けるようにする
      mirrorOcrToMediaIndex(imageUrl, result.text ?? "", result.altText ?? "");
      if (got) {
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
    if (hasReading) {
      setAnchor(rectOf(btnRef.current));
      setOpen((v) => !v);
    } else {
      void run();
    }
  }, [hasReading, run]);

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
      : hasReading
        ? t("ocr.noText")
        : t("ocr.readText");

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        data-tooltip={label}
        aria-label={label}
        disabled={running}
        // サイズ・角丸は同じツールバーに並ぶ BlockNote 標準ボタン（36px 角・rounded-md）に合わせる。
        // padding 無しだとアイコン幅（18px）のままになり、隣のボタンと詰まって見える。
        className={[
          "bn-button inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors",
          hasReading
            ? "text-[#4B7A52] hover:bg-[rgba(75,122,82,0.12)]"
            : "text-muted-foreground hover:bg-black/5",
        ].join(" ")}
        data-test="imageOcrButton"
      >
        {running ? (
          <Loader2 size={18} className="animate-spin" />
        ) : hasReading ? (
          <FileText size={18} />
        ) : (
          <ScanText size={18} />
        )}
      </button>

      {open && hasReading && anchor &&
        createPortal(
          <>
            {/* 外側クリックで閉じる透明レイヤー */}
            <div
              className="fixed inset-0 z-[9998]"
              onMouseDown={() => setOpen(false)}
            />
            <div
              ref={setPanelEl}
              className="fixed z-[9999] flex w-[min(28rem,calc(100vw-2rem))] flex-col rounded-lg border border-border bg-card shadow-lg"
              style={
                placed
                  ? { top: placed.top, left: placed.left, maxHeight: placed.maxHeight }
                  : { top: 0, left: 0, visibility: "hidden" }
              }
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-xs font-semibold text-foreground">
                  {charCount > 0 ? t("ocr.done") : t("ocr.noText")}
                  {charCount > 0 && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {t("ocr.chars", { count: String(charCount) })}
                      {safeOcrNumber(entry?.confidence) ? ` · ${safeOcrNumber(entry?.confidence)}%` : ""}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {charCount > 0 && (
                    <button
                    onClick={() => void copy()}
                    data-tooltip={t("ocr.copy")}
                    aria-label={t("ocr.copy")}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-black/5"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>)}
                  <button
                    onClick={() => void run()}
                    data-tooltip={t("ocr.readText")}
                    aria-label={t("ocr.readText")}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-black/5"
                  >
                    <RefreshCw size={12} />
                  </button>
                </span>
              </div>
              {charCount > 0 && (
                <pre className="min-h-0 max-h-72 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-foreground">
                  {text}
                </pre>
              )}
              {/* 検索用の別の読み（macOS）。あるときだけ小さく出す。コピー・書き出しには含めない */}
              {altText && (
                <div className="shrink-0 border-t border-border px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">{t("ocr.altReading")}</div>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                    {altText}
                  </pre>
                </div>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** パネルの起点にするボタンの矩形（位置の計算は placeFloating に任せる） */
function rectOf(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}
