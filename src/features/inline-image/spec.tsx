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
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { getActiveProvider } from "../../lib/storage/registry";
import { getIndexTableCallbacks } from "../index-table/context";
import { t } from "../../i18n";

/** fileId → blob URL の解決キャッシュ。失敗は溜めない（次回開いたとき再試行） */
const blobUrlCache = new Map<string, Promise<string>>();

function loadBlobUrl(fileId: string): Promise<string> {
  const cached = blobUrlCache.get(fileId);
  if (cached) return cached;
  const p = getActiveProvider()
    .getMediaBlobUrl(fileId)
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
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const fileId = String((props.inlineContent as any).props?.fileId ?? "");
      const name = String((props.inlineContent as any).props?.name ?? "");
      const [url, setUrl] = useState<string | null>(null);
      const [failed, setFailed] = useState(false);

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
            <img
              src={url}
              alt={name}
              style={{
                // 行内に収まりつつ絵として判別できる高さ。セルの行も同じだけ育つ
                maxHeight: "3.2em",
                maxWidth: 220,
                borderRadius: 4,
                border: "1px solid var(--color-border)",
                display: "inline-block",
                objectFit: "contain",
              }}
            />
          )}
        </span>
      );
    },
  },
);

export const inlineImageSpecs = {
  inlineImage: InlineImage,
};
