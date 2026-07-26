// 貼られた画像を自動で読み取る hook。
//
// 「読む」操作を毎回ユーザーにさせると、結局ほとんどの画像は読まれないまま残る。
// 一方で、ノートを開いただけで既存の画像を一斉に読み始めると重いので、対象は
// 「このノートを開いている間に新しく入った画像」だけに絞る。
// 進行状況は OcrToast で見せる（裏で勝手に走っていると不安なため）。

import { useCallback, useRef, useState } from "react";
import { useMediaOcrStore } from "./store";
import { runOcrForImage } from "./run-ocr";
import { OCR_CAPABLE_BLOCK_TYPES } from "./collect";
import type { OcrToastState } from "./OcrToast";

type ImageTarget = { id: string; url: string };

/** ブロックツリーから画像ブロック（URL 付き）を再帰的に集める */
function collectImageBlocks(blocks: any[], out: ImageTarget[] = []): ImageTarget[] {
  for (const b of blocks ?? []) {
    if (b?.type && OCR_CAPABLE_BLOCK_TYPES.has(b.type)) {
      const url = typeof b.props?.url === "string" ? b.props.url : "";
      if (url && b.id) out.push({ id: b.id, url });
    }
    if (b?.children?.length) collectImageBlocks(b.children, out);
  }
  return out;
}

export function useAutoImageOcr({
  editorRef,
  noteKey,
  enabled = true,
}: {
  editorRef: React.RefObject<any>;
  /** 開いているノートの識別子。変わったら「既知の画像」を取り直す */
  noteKey: string;
  enabled?: boolean;
}) {
  const store = useMediaOcrStore();
  const [toast, setToast] = useState<OcrToastState>(null);
  const knownRef = useRef<Set<string> | null>(null);
  const noteKeyRef = useRef(noteKey);
  const runningRef = useRef(0);

  // ノートが切り替わったら既知集合を捨てる。持ち越すと、次のノートの既存画像を
  // 「新しく貼られた」と誤認して一斉に読み始めてしまう。
  if (noteKeyRef.current !== noteKey) {
    noteKeyRef.current = noteKey;
    knownRef.current = null;
  }

  const runAll = useCallback(
    async (targets: ImageTarget[]) => {
      runningRef.current += targets.length;
      setToast({ running: runningRef.current, chars: 0, empty: 0 });
      let chars = 0;
      let empty = 0;
      for (const target of targets) {
        try {
          const result = await runOcrForImage(target.url);
          if (result.text) {
            store.setEntry(target.id, result);
            chars += result.text.replace(/\s/g, "").length;
          } else {
            empty += 1;
          }
        } catch (e) {
          console.warn("自動 OCR に失敗:", e);
          empty += 1;
        } finally {
          runningRef.current = Math.max(0, runningRef.current - 1);
          setToast((prev) =>
            prev ? { ...prev, running: runningRef.current } : prev,
          );
        }
      }
      setToast({ running: 0, chars, empty });
    },
    [store],
  );

  /** エディタの変更ごとに呼ぶ。新しく入った画像があれば読み取りを始める。 */
  const scan = useCallback(() => {
    if (!enabled) return;
    const editor = editorRef.current;
    if (!editor?.document) return;

    const images = collectImageBlocks(editor.document);
    if (knownRef.current === null) {
      // ノートを開いた直後。今ある画像は「貼られたばかり」ではないので走らせない。
      knownRef.current = new Set(images.map((i) => i.id));
      return;
    }

    const known = knownRef.current;
    const fresh = images.filter((i) => !known.has(i.id) && !store.getEntry(i.id));
    for (const i of images) known.add(i.id);
    if (fresh.length > 0) void runAll(fresh);
  }, [enabled, editorRef, store, runAll]);

  return { scan, toast };
}
