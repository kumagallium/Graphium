// インライン画像（セル・本文の行内に埋まる小さな画像）
//
// テーブルのセルには BlockNote の画像「ブロック」を置けない（セルは inline content
// のみ）。@ メンションで画像素材を選ぶと、この inline 要素として埋まる。
// - 実体は素材ライブラリの fileId 参照。ノート JSON には fileId と名前だけが残る
// - 行内に収まる高さのサムネイルで描画し、クリックで素材ピークを開いて大きく見る
// - 旧ビルドで開くと sanitize（KNOWN_INLINE_TYPES）に落とされて画像は消える
//   （クラッシュはしない）。tableMeta と同じ「全端末更新を案内する」性質
//
// blob URL はモジュールキャッシュに持つ。BlockNote はタイプのたびに inline を
// 再マウントしうるので、毎回 provider を叩くとセル編集がちらつく。

import { createReactInlineContentSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { getActiveProvider } from "../../lib/storage/registry";
import { getIndexTableCallbacks } from "../index-table/context";
import { t } from "../../i18n";

/**
 * セルの画像をノート本文へドラッグして画像ブロックに戻すための MIME。
 * ブロック → セルは BlockNote の "blocknote/html" 経路（editor.tsx）で受ける。
 */
export const INLINE_IMAGE_DRAG_MIME = "application/x-graphium-inline-image";

/** fileId → blob URL の解決キャッシュ。失敗は溜めない（次回開いたとき再試行） */
const blobUrlCache = new Map<string, Promise<string>>();

/**
 * blob URL → fileId の逆引き。
 * 画像を直接ドラッグすると、ブラウザのネイティブ画像ドラッグになって
 * dataTransfer には img の src（blob URL）しか乗らない。そこから素材を
 * 特定できるように、解決した URL を控えておく。
 */
const fileIdByBlobUrl = new Map<string, string>();

export function rememberBlobUrl(url: string, fileId: string) {
  if (url.startsWith("blob:")) fileIdByBlobUrl.set(url, fileId);
}

export function fileIdFromBlobUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return fileIdByBlobUrl.get(url) ?? null;
}

function loadBlobUrl(fileId: string): Promise<string> {
  const cached = blobUrlCache.get(fileId);
  if (cached) return cached;
  const p = getActiveProvider()
    .getMediaBlobUrl(fileId)
    .then((url) => {
      rememberBlobUrl(url, fileId);
      return url;
    })
    .catch((e) => {
      blobUrlCache.delete(fileId);
      throw e;
    });
  blobUrlCache.set(fileId, p);
  return p;
}

export const InlineImage = createReactInlineContentSpec(
  {
    type: "inlineImage" as const,
    propSchema: {
      /** 素材ライブラリの fileId */
      fileId: { default: "" },
      /** 素材名（alt・読み込み失敗時の表示・Markdown 書き出しの alt） */
      name: { default: "" },
      /**
       * 表示幅（px）。0 は既定（行の高さに収まるサムネイル）。
       * 右下のハンドルをドラッグすると入る。追加プロパティなので既存データは 0 のまま
       */
      width: { default: 0 },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const fileId = String((props.inlineContent as any).props?.fileId ?? "");
      const name = String((props.inlineContent as any).props?.name ?? "");
      const width = Number((props.inlineContent as any).props?.width ?? 0) || 0;
      const editable = (props.editor as any).isEditable !== false;
      const [url, setUrl] = useState<string | null>(null);
      const [failed, setFailed] = useState(false);
      // ドラッグ中の見た目だけ先に動かし、離したときに一度だけ保存する
      const [dragWidth, setDragWidth] = useState<number | null>(null);
      const imgRef = useRef<HTMLImageElement | null>(null);

      useEffect(() => {
        if (!fileId) {
          setFailed(true);
          return;
        }
        let cancelled = false;
        setFailed(false);
        loadBlobUrl(fileId)
          .then((u) => {
            if (!cancelled) setUrl(u);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
        return () => {
          cancelled = true;
        };
      }, [fileId]);

      const shownWidth = dragWidth ?? (width || 0);

      const commitWidth = (next: number) => {
        setDragWidth(null);
        (props.updateInlineContent as any)({
          type: "inlineImage",
          props: { fileId, name, width: Math.round(next) },
        });
      };

      /** 右下ハンドルのドラッグ。掴んだ時点の幅から水平移動ぶんを足す */
      const startResize = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = imgRef.current?.getBoundingClientRect().width ?? 120;
        const onMove = (ev: MouseEvent) => {
          // 極端に潰れる/伸びるのを防ぐ（セルの中に収まる範囲）
          setDragWidth(Math.max(24, Math.min(640, startWidth + (ev.clientX - startX))));
        };
        const onUp = (ev: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          commitWidth(Math.max(24, Math.min(640, startWidth + (ev.clientX - startX))));
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };

      const open = () => {
        if (!fileId) return;
        // 素材ピークで大きく見る。外部ソース ID（image:）の振り分けは
        // note-app 側の onOpenSidePeek（openPeekTargetId）が行う
        getIndexTableCallbacks()?.onOpenSidePeek(`image:${fileId}`);
      };

      return (
        <span
          contentEditable={false}
          data-test="inline-image"
          title={name ? `${name} — ${t("inlineImage.clickToOpen")}` : t("inlineImage.clickToOpen")}
          onClick={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            verticalAlign: "middle",
            margin: "0 1px",
            cursor: "pointer",
          }}
        >
          {failed || !url ? (
            // 読み込み中・失敗時は名前入りのプレースホルダ（枠だけの空白にしない）
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "1px 6px",
                borderRadius: 4,
                border: "1px dashed var(--color-border)",
                color: "var(--color-text-tertiary)",
                fontSize: "0.85em",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                maxWidth: 180,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <ImageOff size={12} style={{ flexShrink: 0 }} />
              {name || t("inlineImage.missing")}
            </span>
          ) : (
            <span style={{ position: "relative", display: "inline-flex", lineHeight: 0 }}>
              <img
                ref={imgRef}
                src={url}
                alt={name}
                draggable={editable}
                onDragStart={(e) => {
                  // 本文へ出すと画像ブロックに戻る。
                  // 掴んだ画像そのものの位置を載せる — fileId だけだと、同じ素材が
                  // 他のセルにもあるとき別の画像を消してしまう（複製に見える）
                  let pos: number | null = null;
                  try {
                    const view = (props.editor as any)?._tiptapEditor?.view;
                    if (view && e.currentTarget) pos = view.posAtDOM(e.currentTarget, 0);
                  } catch {
                    pos = null;
                  }
                  e.dataTransfer.setData(
                    INLINE_IMAGE_DRAG_MIME,
                    JSON.stringify({ fileId, name, pos })
                  );
                  e.dataTransfer.effectAllowed = "move";
                }}
                style={
                  shownWidth
                    ? {
                        width: shownWidth,
                        height: "auto",
                        borderRadius: 4,
                        border: "1px solid var(--color-border)",
                        display: "inline-block",
                        objectFit: "contain",
                      }
                    : {
                        // 既定は行内に収まりつつ絵として判別できる高さ。セルの行も同じだけ育つ
                        maxHeight: "3.2em",
                        maxWidth: 220,
                        borderRadius: 4,
                        border: "1px solid var(--color-border)",
                        display: "inline-block",
                        objectFit: "contain",
                      }
                }
              />
              {editable && (
                // 右下のリサイズハンドル。掴んでいる間だけ画面全体で座標を追う
                <span
                  onMouseDown={startResize}
                  onDoubleClick={(e) => {
                    // ダブルクリックで既定サイズに戻す（幅を捨てる）
                    e.stopPropagation();
                    commitWidth(0);
                  }}
                  title={t("inlineImage.resize")}
                  style={{
                    position: "absolute",
                    right: -3,
                    bottom: -3,
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-card)",
                    cursor: "nwse-resize",
                    opacity: 0.85,
                  }}
                />
              )}
            </span>
          )}
        </span>
      );
    },
  },
);

export const inlineImageSpecs = {
  inlineImage: InlineImage,
};
