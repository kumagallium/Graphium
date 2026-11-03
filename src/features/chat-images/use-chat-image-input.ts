// チャットの入力欄に添える画像（送る前の分）の状態。
//
// ノートのチャット（ai-assistant/panel.tsx）とノートなしのチャット
// （standalone-chat/StandaloneChatComposer.tsx）の両方で同じものを使う。
// 送る前の画像は縮小した data URL のままメモリに持ち、保存（media-text）は送るときに
// commit() で行う。保存に失敗したら入力欄の文章も画像も残したまま知らせる
// （呼び出し側は commit が参照を返したときだけ入力欄を空にする）。

import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useT } from "../../i18n";
import type { ChatImageRef } from "../../lib/document-types";
import { getActiveProvider } from "../../lib/storage/registry";
import { encodeChatImage, isAcceptableImageFile, MAX_IMAGES_PER_MESSAGE, type EncodedChatImage } from "./encode";
import { savePendingChatImages } from "./storage";

export type PendingChatImage = EncodedChatImage & {
  id: string;
  name?: string;
};

/** ドラッグ中のものが画像のファイルだけか（PDF などは取り込み〔投入口〕に任せる） */
function isImageOnlyDrag(e: DragEvent): boolean {
  const dt = e.dataTransfer;
  if (!dt || !Array.from(dt.types ?? []).includes("Files")) return false;
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  return items.length > 0 && items.every((i) => i.type.startsWith("image/"));
}

export function useChatImageInput(opts: { disabled?: boolean } = {}) {
  const t = useT();
  const [images, setImages] = useState<PendingChatImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // 縮小中の枚数。縮小中は送れない（送った後に画像だけ入力欄へ残るのを防ぐ）
  const [encoding, setEncoding] = useState(0);
  const [saving, setSaving] = useState(false);
  // 子要素をまたぐと dragleave が連続で来るので、入った回数で数える
  const dragDepth = useRef(0);
  // 上限の数え方: 並んでいる枚数＋縮小中の枚数。連続で貼ったときも正しく数えるため ref で持つ
  const countRef = useRef(0);
  // clear() のたびに進める。古い世代の縮小が後から終わっても並べない
  const generationRef = useRef(0);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      if (opts.disabled || files.length === 0) return;
      setError(null);
      const generation = generationRef.current;
      for (const file of files) {
        if (countRef.current >= MAX_IMAGES_PER_MESSAGE) {
          setError(t("chatImages.tooMany", { max: String(MAX_IMAGES_PER_MESSAGE) }));
          return;
        }
        countRef.current += 1;
        setEncoding((n) => n + 1);
        const encoded = await encodeChatImage(file);
        setEncoding((n) => Math.max(0, n - 1));
        if (generation !== generationRef.current) return; // 送信・取り消しで空にされた後
        if (typeof encoded === "string") {
          countRef.current -= 1;
          setError(
            t(
              encoded === "not-image"
                ? "chatImages.notImage"
                : encoded === "too-large"
                  ? "chatImages.tooLarge"
                  : "chatImages.unreadable",
            ),
          );
          continue;
        }
        // 貼り付けの画像は "image.png" という仮の名前しか持たないので名前に使わない
        const name = file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name) ? file.name : undefined;
        setImages((prev) => [...prev, { ...encoded, id: crypto.randomUUID(), ...(name ? { name } : {}) }]);
      }
    },
    [opts.disabled, t],
  );

  const remove = useCallback((id: string) => {
    setImages((prev) => {
      if (!prev.some((i) => i.id === id)) return prev;
      countRef.current = Math.max(0, countRef.current - 1);
      return prev.filter((i) => i.id !== id);
    });
    setError(null);
  }, []);

  const clear = useCallback(() => {
    generationRef.current += 1;
    countRef.current = 0;
    setImages([]);
    setEncoding(0);
    setError(null);
  }, []);

  /**
   * 送る直前に呼ぶ。画像を保存して参照を返す（画像が無ければ空配列）。
   * 保存に失敗したらエラーを出して null を返す（入力欄は呼び出し側が残す）。
   */
  const commit = useCallback(async (): Promise<ChatImageRef[] | null> => {
    if (images.length === 0) return [];
    setSaving(true);
    try {
      return await savePendingChatImages(getActiveProvider(), images);
    } catch {
      setError(t("chatImages.saveFailed"));
      return null;
    } finally {
      setSaving(false);
    }
  }, [images, t]);

  /**
   * 入力欄の onPaste。画像だけのクリップボード（スクリーンショット・画像のコピー）のときに
   * 受け取る。表計算や文書からのコピーは文字と一緒に画像も載ることが多いので、
   * 文字があれば文字の貼り付けを優先する
   */
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => isAcceptableImageFile(f));
      if (files.length === 0) return;
      if ((e.clipboardData?.getData("text/plain") ?? "").trim()) return;
      e.preventDefault();
      void addFiles(files);
    },
    [addFiles],
  );

  /**
   * 入力欄を包む要素に付ける。画像のファイルだけのドラッグを受け取り、画面全体の
   * 取り込み（投入口）には渡さない。PDF などが混ざるドラッグはこれまでどおり取り込みへ
   */
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (opts.disabled || !isImageOnlyDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (opts.disabled || !isImageOnlyDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!isImageOnlyDrag(e)) return;
      e.stopPropagation();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!isImageOnlyDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragging(false);
      if (opts.disabled) return;
      void addFiles(Array.from(e.dataTransfer.files));
    },
  };

  return {
    images,
    error,
    setError,
    dragging,
    /** 縮小中・保存中（送信ボタンを止める） */
    busy: encoding > 0 || saving,
    addFiles,
    remove,
    clear,
    commit,
    onPaste,
    dropHandlers,
  };
}

export type ChatImageInput = ReturnType<typeof useChatImageInput>;
