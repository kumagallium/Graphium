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

/**
 * いまノート内で掴んでいる画像素材。
 *
 * dataTransfer に載せたカスタム MIME は、デスクトップ（WKWebView）だと drop 側で
 * 読めないことがある。読めないとどの受け口にも当たらず、ProseMirror の既定処理が
 * text/plain（＝画像の名前）を挿してしまい、画像が文字に化ける。ドラッグ元も先も
 * 同じドキュメントなので、素の変数で覚えておけば環境差の影響を受けない。
 */
export type ActiveImageDrag = {
  fileId: string;
  name: string;
  /** 掴んだノードの位置。同じ素材が複数あるとき、掴んだものだけを消すのに使う */
  pos: number | null;
  /** 掴んだ元がテーブルのセルの中（inlineImage）か、本文の画像ブロックか */
  inCell: boolean;
  /** 掴んだ画像ブロックの id（本文の画像のみ）。元ブロックの削除に使う */
  blockId?: string | null;
};

let activeImageDrag: ActiveImageDrag | null = null;

export function setActiveImageDrag(drag: ActiveImageDrag | null) {
  activeImageDrag = drag;
}

export function getActiveImageDrag(): ActiveImageDrag | null {
  return activeImageDrag;
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

/**
 * 既定（width 未設定）の表示上限。行の高さに収まるだけの小ささだと図の中身が読めないので、
 * セルの中で内容を判別できるところまで大きく出す。明示リサイズした画像はこの上限を使わない
 */
const DEFAULT_MAX_HEIGHT = "8em";
const DEFAULT_MAX_WIDTH = 240;

/** 手動リサイズの下限・上限（px）。下限は掴み直せるだけの大きさを残す */
const MIN_WIDTH = 32;
const MAX_WIDTH = 640;
const clampWidth = (n: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));

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
      // ハンドルを掴めているか目で分かるようにする（hover とドラッグ中で見た目を変える）
      const [handleHover, setHandleHover] = useState(false);
      const [resizing, setResizing] = useState(false);
      const imgRef = useRef<HTMLImageElement | null>(null);
      // ドラッグ中にノートを切り替えても document のリスナ・body のスタイルを残さない
      const endResizeRef = useRef<(() => void) | null>(null);
      useEffect(() => () => endResizeRef.current?.(), []);

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
      /** ハンドルを強調する状態（hover 中 or 掴んでいる最中） */
      const handleActive = handleHover || resizing;

      const commitWidth = (next: number) => {
        setDragWidth(null);
        (props.updateInlineContent as any)({
          type: "inlineImage",
          props: { fileId, name, width: Math.round(next) },
        });
      };

      /**
       * 右下ハンドルのドラッグ。掴んだ時点の幅から水平移動ぶんを足す。
       * pointer 系で受けてマウス・ペン・タッチのどれでも掴めるようにし、掴んでいる間は
       * 画面全体のカーソルと選択を固定する（テキスト選択が走ると掴んだ感覚が壊れる）
       */
      const startResize = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = imgRef.current?.getBoundingClientRect().width ?? 120;
        const body = document.body;
        const prevUserSelect = body.style.userSelect;
        const prevCursor = body.style.cursor;
        body.style.userSelect = "none";
        body.style.cursor = "nwse-resize";
        setResizing(true);
        setDragWidth(clampWidth(startWidth));

        const onMove = (ev: PointerEvent) => setDragWidth(clampWidth(startWidth + (ev.clientX - startX)));
        const end = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onCancel);
          body.style.userSelect = prevUserSelect;
          body.style.cursor = prevCursor;
          endResizeRef.current = null;
          setResizing(false);
        };
        const onUp = (ev: PointerEvent) => {
          end();
          commitWidth(clampWidth(startWidth + (ev.clientX - startX)));
          // 離した直後の click を 1 回だけ飲む（そのまま通ると素材ピークが開く）
          const swallow = (c: MouseEvent) => {
            c.preventDefault();
            c.stopPropagation();
          };
          window.addEventListener("click", swallow, true);
          setTimeout(() => window.removeEventListener("click", swallow, true), 0);
        };
        const onCancel = () => {
          // 中断（タッチのキャンセル等）は幅を捨てて元に戻す
          end();
          setDragWidth(null);
        };
        endResizeRef.current = onCancel;
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onCancel);
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
                  // デスクトップ（WKWebView）は drop 側でカスタム MIME を読めないので、
                  // 素の変数にも控える（editor.tsx の draggedImagePayload が読む）
                  setActiveImageDrag({ fileId, name, pos, inCell: true });
                  e.dataTransfer.effectAllowed = "move";
                }}
                style={{
                  ...(shownWidth
                    ? { width: shownWidth, height: "auto" }
                    : // 既定は絵の中身が読める大きさ。セルの行も同じだけ育つ
                      { maxHeight: DEFAULT_MAX_HEIGHT, maxWidth: DEFAULT_MAX_WIDTH }),
                  borderRadius: 4,
                  border: "1px solid var(--color-border)",
                  display: "inline-block",
                  objectFit: "contain",
                  // 掴んでいる間は対象を光らせる
                  outline: resizing ? "2px solid var(--color-primary)" : undefined,
                  outlineOffset: resizing ? 1 : undefined,
                }}
              />
              {resizing && dragWidth != null && (
                // 掴んでいる間の幅表示。動いていることが数字でも分かるようにする。
                // 画像の外に出すと上の行に被るので、内側の右上に重ねる
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    right: 3,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "var(--color-primary)",
                    color: "var(--color-primary-foreground, #fff)",
                    fontSize: 11,
                    lineHeight: 1.5,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    zIndex: 2,
                  }}
                >
                  {Math.round(dragWidth)}px
                </span>
              )}
              {editable && (
                // 右下のリサイズハンドル。掴んでいる間だけ画面全体で座標を追う。
                // 当たり判定（外側）は見た目のつまみより広く取る — 掴み損ねるとクリックが
                // そのまま素材ピークになってしまい、狙って掴めない感じが強く出る
                <span
                  onPointerDown={startResize}
                  onPointerEnter={() => setHandleHover(true)}
                  onPointerLeave={() => setHandleHover(false)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    // ダブルクリックで既定サイズに戻す（幅を捨てる）
                    e.stopPropagation();
                    commitWidth(0);
                  }}
                  title={t("inlineImage.resize")}
                  style={{
                    position: "absolute",
                    right: -9,
                    bottom: -9,
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "nwse-resize",
                    touchAction: "none",
                    zIndex: 1,
                  }}
                >
                  <span
                    style={{
                      width: handleActive ? 12 : 10,
                      height: handleActive ? 12 : 10,
                      borderRadius: 3,
                      border: `1px solid ${handleActive ? "var(--color-primary)" : "var(--color-border)"}`,
                      background: handleActive ? "var(--color-primary)" : "var(--color-card)",
                      boxShadow: handleActive
                        ? "0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent)"
                        : "0 1px 2px rgba(0, 0, 0, 0.18)",
                      transition: "width 80ms, height 80ms, background 80ms, box-shadow 80ms",
                    }}
                  />
                </span>
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
