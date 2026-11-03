// チャットの画像の部品（入力欄の「画像を添える」ボタン・送る前の画像の列・吹き出しの画像）。
// ノートのチャットとノートなしのチャットで同じ見た目にする。

import { useEffect, useRef, useState } from "react";
import { ImageOff, ImagePlus, Info, X } from "lucide-react";
import { IconButton } from "@ui/icon-button";
import { Modal } from "@ui/modal";
import { useT } from "../../i18n";
import { getActiveProvider } from "../../lib/storage/registry";
import type { ChatImageRef } from "../../lib/document-types";
import { loadChatImage } from "./storage";
import type { PendingChatImage } from "./use-chat-image-input";

/** 入力欄の下に置く「画像を添える」ボタン（ファイル選択を開く） */
export function ChatImageAttachButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <IconButton
        size="sm"
        aria-label={t("chatImages.attach")}
        tooltip={t("chatImages.attachHint")}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="-ml-1.5"
      >
        <ImagePlus />
      </IconButton>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // 同じファイルをもう一度選べるよう値を空に戻す
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

/** 送る前の画像の列（入力欄の直上）。× で外せる */
export function PendingChatImageStrip({
  images,
  onRemove,
}: {
  images: readonly PendingChatImage[];
  onRemove: (id: string) => void;
}) {
  const t = useT();
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2" data-testid="pending-chat-images">
      {images.map((img, i) => (
        <span key={img.id} className="relative group">
          <img
            src={img.dataUrl}
            alt={img.name ?? ""}
            className="h-12 w-12 rounded-md border border-border object-cover bg-muted"
          />
          <button
            type="button"
            onClick={() => onRemove(img.id)}
            aria-label={t("chatImages.remove", { n: String(i + 1) })}
            data-tooltip={t("chatImages.remove", { n: String(i + 1) })}
            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-foreground/80 text-background flex items-center justify-center hover:bg-destructive"
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * 入力欄の上に出す 1 行の知らせ（画像の受け付けエラー・画像を見られない AI の案内）。
 * どちらも無ければ何も出さない。
 */
export function ChatImageNotices({
  error,
  textOnlyModel,
}: {
  error?: string | null;
  /** 画像を添えていて、使う AI が画像を見られないとき true */
  textOnlyModel?: boolean;
}) {
  const t = useT();
  if (!error && !textOnlyModel) return null;
  return (
    <div className="mb-2 space-y-1">
      {error && <div className="text-xs text-destructive">{error}</div>}
      {textOnlyModel && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>{t("chatImages.textOnlyModel")}</span>
        </div>
      )}
    </div>
  );
}

/** ファイルを入力欄の上へ持ってきている間だけ重ねる受け皿 */
export function ChatImageDropOverlay({ visible }: { visible: boolean }) {
  const t = useT();
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85 text-xs font-medium text-primary">
      {t("chatImages.dropHere")}
    </div>
  );
}

/** 吹き出しの中の画像（送ったもの）。押すと大きく開く */
export function ChatMessageImages({ images }: { images: readonly ChatImageRef[] }) {
  const t = useT();
  const [urls, setUrls] = useState<(string | null | undefined)[]>(() => images.map(() => undefined));
  const [open, setOpen] = useState<number | null>(null);
  const key = images.map((i) => i.ref).join("|");

  useEffect(() => {
    let cancelled = false;
    // 会話を切り替えると同じ位置の吹き出しが使い回されるので、前の画像を出し続けない
    setUrls(images.map(() => undefined));
    setOpen(null);
    let provider: ReturnType<typeof getActiveProvider> | null = null;
    try {
      provider = getActiveProvider();
    } catch {
      provider = null;
    }
    void Promise.all(images.map((img) => (provider ? loadChatImage(provider, img.ref) : Promise.resolve(null)))).then(
      (loaded) => {
        if (!cancelled) setUrls(loaded);
      },
    );
    return () => {
      cancelled = true;
    };
    // 参照の並びが同じなら読み直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (images.length === 0) return null;
  const openUrl = open != null ? urls[open] : null;
  return (
    <>
      <div className="flex flex-wrap justify-end gap-1.5 mb-1" data-testid="chat-message-images">
        {images.map((img, i) => {
          const url = urls[i];
          if (url === null) {
            return (
              <span
                key={img.ref}
                className="h-20 w-20 rounded-md border border-dashed border-border flex flex-col items-center justify-center gap-1 text-[10px] leading-tight text-muted-foreground text-center p-1"
                data-tooltip={t("chatImages.unavailable")}
              >
                <ImageOff size={14} />
                <span className="sr-only">{t("chatImages.unavailable")}</span>
              </span>
            );
          }
          return (
            <button
              key={img.ref}
              type="button"
              onClick={() => url && setOpen(i)}
              aria-label={t("chatImages.open", { n: String(i + 1) })}
              className="rounded-md border border-border overflow-hidden bg-muted hover:opacity-90"
            >
              {url ? (
                <img src={url} alt={img.name ?? ""} className="h-20 max-w-[10rem] object-cover" />
              ) : (
                <span className="block h-20 w-20 animate-pulse" />
              )}
            </button>
          );
        })}
      </div>
      <Modal open={open != null && !!openUrl} onClose={() => setOpen(null)} className="p-2 max-w-[90vw]">
        {openUrl && (
          <img
            src={openUrl}
            alt={open != null ? images[open]?.name ?? "" : ""}
            className="max-h-[80dvh] max-w-[86vw] object-contain"
          />
        )}
      </Modal>
    </>
  );
}
