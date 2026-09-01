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
import { mirrorOcrToMediaIndex } from "./mirror-to-media-index";
import { getLatestMediaIndex } from "../asset-browser/media-index";
import { getActiveProvider } from "../../lib/storage/registry";
import type { OcrToastState } from "./OcrToast";

type ImageTarget = { id: string; url: string };

/**
 * この起動中に読み終えた素材。文字が見つからなかったものも含めて覚える。
 *
 * 同じ画像でも、テーブルへ出し入れすると画像ブロックが作り直されて id が変わる。
 * ブロック id だけで見ていると、そのたびに同じ素材を読み直してしまう
 * （「出し入れごとに毎回 文字認識が走る」と報告された）。
 */
const scannedAssetIds = new Set<string>();

/** 控えた「読み終えた素材」を捨てる（保存先を切り替えたときとテストの掃除用） */
export function clearScannedAssets(): void {
  scannedAssetIds.clear();
}

/** 画像ブロックの url から素材 ID を引く（外部 URL の画像などは素材ではない） */
function assetIdOf(url: string): string | null {
  try {
    return getActiveProvider().extractFileId(url) ?? null;
  } catch {
    // プロバイダ未初期化（テスト・Storybook）では素材として扱わない
    return null;
  }
}

/** 素材インデックスのエントリ（無ければ null） */
function assetEntryOf(assetId: string) {
  return getLatestMediaIndex()?.media.find((m) => m.fileId === assetId) ?? null;
}

/**
 * ライブラリに前からある素材か（アップロードがこの操作より十分前）。
 *
 * 自動 OCR は「貼られたまま読まれず残る」のを防ぐためのもので、対象は外から
 * 新しく持ち込まれた画像。素材ライブラリから選んで挿した画像まで読み始めると、
 * 「すでにあるものに毎回 OCR が走る」体験になる（実際に報告された）。
 * 既存素材を文字で引きたいときは素材ギャラリーの一括読み取りを使う。
 */
const EXISTING_ASSET_AGE_MS = 60_000;

function isPreexistingAsset(entry: { uploadedAt?: string } | null): boolean {
  const at = entry?.uploadedAt ? Date.parse(entry.uploadedAt) : NaN;
  return Number.isFinite(at) && Date.now() - at > EXISTING_ASSET_AGE_MS;
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
          // タイムアウト（宙吊り検知）と worker の作り直しは recognizeImage 側が
          // 持つ（lib/ocr.ts）。ここでは失敗として数えて先へ進むだけでよい
          const result = await runOcrForImage(source);
          if (result.text) {
            store.setEntry(target.id, result);
            // 素材側にも写して、素材ギャラリー・Cmd+K から同じ文字で引けるようにする
            mirrorOcrToMediaIndex(target.url, result.text);
            chars += result.text.replace(/\s/g, "").length;
          } else {
            empty += 1;
          }
        } catch (e) {
          console.warn("自動 OCR に失敗:", e);
          empty += 1;
        } finally {
          // 文字が無かった・失敗した素材も控える（同じ画像を運ぶたびに読み直さない）
          const assetId = assetIdOf(target.url);
          if (assetId) scannedAssetIds.add(assetId);
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
    const candidates = images.filter((i) => !known.has(i.id) && !store.getEntry(i.id));
    for (const i of images) known.add(i.id);
    // ブロックが作り直されただけ・素材ライブラリから挿しただけの画像は読まない。
    // 素材側に結果が残っていればそれを写し、読んだ実績がある（文字が無かった）もの・
    // 前からライブラリにある素材は黙って飛ばす
    const fresh: ImageTarget[] = [];
    for (const target of candidates) {
      const assetId = assetIdOf(target.url);
      if (assetId) {
        const entry = assetEntryOf(assetId);
        const cached =
          typeof entry?.ocrText === "string" && entry.ocrText.trim() ? entry.ocrText : null;
        if (cached) {
          store.setEntry(target.id, {
            text: cached,
            // 素材側には読み取り時の確度・言語を残していない（表示は 0 で省かれる）
            confidence: 0,
            lang: "",
            extractedAt: new Date().toISOString(),
          });
          continue;
        }
        if (scannedAssetIds.has(assetId)) continue;
        if (isPreexistingAsset(entry)) continue;
      }
      fresh.push(target);
    }
    if (fresh.length > 0) void runAll(fresh);
  }, [enabled, editorRef, store, runAll]);

  return { scan, toast };
}
