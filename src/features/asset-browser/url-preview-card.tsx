// URL アセットの OGP プレビューカード
//
// UrlReaderView が Reader 抽出に失敗したときの fallback として再利用する。
// 元の MediaPreview.UrlPreview をそのまま切り出したもの。

import { ExternalLink } from "lucide-react";
import { useT } from "../../i18n";
import { getFaviconUrl, type MediaIndexEntry } from "./media-index";

export function UrlPreviewCard({ entry }: { entry: MediaIndexEntry }) {
  const t = useT();
  const domain = entry.urlMeta?.domain ?? "";
  return (
    <div className="flex flex-col items-center justify-center gap-4 max-w-sm text-center px-6">
      {entry.urlMeta?.ogImage ? (
        <img src={entry.urlMeta.ogImage} alt="" className="max-w-full max-h-48 rounded object-cover" />
      ) : (
        <img
          src={getFaviconUrl(domain, 128)}
          alt=""
          className="w-16 h-16 rounded"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{entry.name}</p>
        <p className="text-[10px] text-muted-foreground">{domain}</p>
        {entry.urlMeta?.description && (
          <p className="text-xs text-muted-foreground mt-2">{entry.urlMeta.description}</p>
        )}
      </div>
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
      >
        <ExternalLink size={12} />
        {t("asset.urlOpen")}
      </a>
    </div>
  );
}
