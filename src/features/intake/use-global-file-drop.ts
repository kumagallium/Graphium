// ウィンドウ全体でのファイルドラッグ＆ドロップ監視
//
// エディタ内・受け皿・モーダル内など「自前でドロップを受ける場所」の上では
// 何もせず、それ以外の場所へのドラッグ・ドロップだけを拾う。
//
// src/features/media-ocr/drag-idle.ts も window の drop を監視しているが、
// あちらは capture フェーズで「今どこかでドラッグ中か」を集計するだけの
// 一元管理役で、ここは bubble フェーズで実際のファイル取り込みを担当する。
// フェーズが違うため干渉しない。

import { useEffect, useRef, useState } from "react";
import { collectDroppedFiles } from "./collect-dropped-files";
import type { IntakeFile } from "./types";

const DEFAULT_IGNORE_SELECTOR =
  ".bn-editor, .ProseMirror, [contenteditable='true'], [data-intake-drop], [data-modal-portal]";

function defaultShouldIgnore(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(DEFAULT_IGNORE_SELECTOR) !== null;
}

// モーダルの中でも受け皿の外（見出しやフッター）に落とされたファイルは、
// 誰も受け取らないとブラウザがそのファイルを開いてしまう。取り込みはしないが
// 既定動作だけ止める（受け皿の上は受け皿自身が処理する）
function shouldSwallow(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Composer（自前 createPortal, role="dialog"）やモバイルの sheet.tsx は
  // data-modal-portal を持たないため、role/aria-modal でも同じ扱いにする
  const inModal =
    target.closest("[data-modal-portal]") !== null ||
    target.closest("[role='dialog']") !== null ||
    target.closest("[aria-modal='true']") !== null;
  return inModal && target.closest("[data-intake-drop]") === null;
}

function hasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types).includes("Files");
}

type UseGlobalFileDropOptions = {
  enabled: boolean;
  onFiles: (files: IntakeFile[]) => void;
  /** true を返した target ではこの hook は何もしない（既定: エディタ内・受け皿・モーダル内） */
  shouldIgnore?: (target: EventTarget | null) => boolean;
  /**
   * true の間はどこに落とされても preventDefault するだけで何もしない
   * （カウンタも overlay も動かさず onFiles も呼ばない）。Composer など
   * data-modal-portal を持たない自前ダイアログが開いている間に使う。
   * enabled=false と違いリスナー自体は付けたままにする
   */
  suspended?: boolean;
};

export function useGlobalFileDrop({ enabled, onFiles, shouldIgnore, suspended }: UseGlobalFileDropOptions) {
  const [dragActive, setDragActive] = useState(false);
  // 最新のコールバックを ref で持ち、effect の依存を enabled のみに絞る
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const shouldIgnoreRef = useRef(shouldIgnore ?? defaultShouldIgnore);
  shouldIgnoreRef.current = shouldIgnore ?? defaultShouldIgnore;
  const suspendedRef = useRef(suspended ?? false);
  suspendedRef.current = suspended ?? false;

  useEffect(() => {
    if (!enabled) return;

    // ignore 対象の上を通っただけでカウンタが狂わないよう、
    // ignore 判定に当たる enter/leave はカウントしない
    let depth = 0;

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      // suspended 中はどこに落とされても既定動作だけ止め、カウンタも overlay も動かさない
      if (suspendedRef.current) {
        e.preventDefault();
        return;
      }
      if (shouldIgnoreRef.current(e.target)) return;
      depth += 1;
      if (depth === 1) setDragActive(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      if (suspendedRef.current) {
        e.preventDefault();
        return;
      }
      if (shouldSwallow(e.target)) {
        e.preventDefault();
        return;
      }
      if (shouldIgnoreRef.current(e.target)) return;
      // ここで preventDefault しないとブラウザがファイルをそのまま開いてしまう
      e.preventDefault();
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      if (suspendedRef.current) {
        e.preventDefault();
        return;
      }
      if (shouldIgnoreRef.current(e.target)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      if (suspendedRef.current) {
        e.preventDefault();
        return;
      }
      if (shouldSwallow(e.target)) {
        e.preventDefault();
        depth = 0;
        setDragActive(false);
        return;
      }
      if (shouldIgnoreRef.current(e.target)) return;
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      if (!e.dataTransfer) return;
      void collectDroppedFiles(e.dataTransfer).then((files) => {
        onFilesRef.current(files);
      });
    };

    const onDragEnd = () => {
      depth = 0;
      setDragActive(false);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
      depth = 0;
      setDragActive(false);
    };
  }, [enabled]);

  return { dragActive };
}
