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
import { takePendingOcrFile } from "./pending-files";
import { waitForDragIdle } from "./drag-idle";
import { resetOcrPipeline } from "../../lib/ocr";
import type { OcrToastState } from "./OcrToast";

type ImageTarget = { id: string; url: string };

/**
 * 1 ジョブの待機上限。初回はワーカー起動（wasm + 言語データの読み込み）を含む
 * ため長めに取る。超えたら宙吊りとみなして先へ進む（トーストが永久に残らない）。
 */
const OCR_JOB_TIMEOUT_MS = 120_000;

class OcrTimeoutError extends Error {
  constructor() {
    super("OCR がタイムアウトしました");
  }
}

function withJobTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OcrTimeoutError()), OCR_JOB_TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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
          // ドラッグ中は重い読み込み（画像の読み戻し・ワーカー起動）を始めない。
          // WKWebView でドラッグ配送と大容量 IPC が重なると UI 全体が固まるため
          await waitForDragIdle();
          // 貼付直後なら File 実体が預けてあるので、URL の読み戻し（デスクトップ
          // では invoke の Base64 往復）を跳ばして直接渡す
          const source = takePendingOcrFile(target.url) ?? target.url;
          const result = await withJobTimeout(runOcrForImage(source));
          if (result.text) {
            store.setEntry(target.id, result);
            chars += result.text.replace(/\s/g, "").length;
          } else {
            empty += 1;
          }
        } catch (e) {
          console.warn("自動 OCR に失敗:", e);
          empty += 1;
          // 宙吊りは worker・直列化チェーンごと作り直す。詰まったまま引きずると
          // 以後のジョブがすべて連鎖的に待たされ続ける
          if (e instanceof OcrTimeoutError) resetOcrPipeline();
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
