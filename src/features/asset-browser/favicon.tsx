// favicon 表示の共通コンポーネント
//
// favicon はブックマーク先のサイト自身からのみ取得する。第三者の favicon API
// （Google の favicon API 等）に投げると、社内ホストやサブドメインのコードネームまで
// 「カードを描画しただけ」で外部へ送られてしまうため、経路ごと持たない。
//
// 取得順は buildFaviconCandidates と同じで
//   1. サイトが宣言したアイコン（urlMeta.faviconUrl）
//   2. `<origin>/favicon.ico`
// 順に試し、すべて失敗したら何も描画しない（従来の onError → display:none と同じ見た目）。
//
// origin は `url`（ブックマーク先のフル URL）が判ればそこから取る。`domain` は
// hostname だけでスキームとポートが落ちているため、社内ホスト
// （`http://internal.example:8080/...`）では別ホストの favicon を指してしまう。
// なおデスクトップ版の CSP は img-src に http: を含めないので、平文 http の
// 社内 favicon はそもそも読み込めず onError → 何も描画しない、で正しく畳まれる。

import { useMemo, useState, type CSSProperties } from "react";
import { buildFaviconCandidates } from "./media-index";

export type FaviconProps = {
  /** ホスト名（URL 文字列でも可）。空なら何も描画しない */
  domain: string;
  /**
   * ブックマーク先のフル URL。判るなら渡す（domain より優先）。
   * スキームとポートを保つのに要る — 詳細は buildFaviconCandidates の注記。
   */
  url?: string;
  /** サイトが宣言したアイコン URL（urlMeta.faviconUrl）。あれば優先して試す */
  iconUrl?: string;
  className?: string;
  style?: CSSProperties;
  /** 装飾目的なので既定は空 alt */
  alt?: string;
};

export function Favicon({ domain, url, iconUrl, className, style, alt = "" }: FaviconProps) {
  const candidates = useMemo(
    () => buildFaviconCandidates(domain, iconUrl, url),
    [domain, iconUrl, url],
  );
  // 候補が変わったら試行位置を先頭に戻す（effect を使わない派生 state）
  const key = candidates.join("|");
  const [tried, setTried] = useState<{ key: string; index: number }>({ key, index: 0 });
  const index = tried.key === key ? tried.index : 0;
  const src = candidates[index];
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      // favicon 取得でアプリ内 URL を referer として漏らさない
      referrerPolicy="no-referrer"
      onError={() => setTried({ key, index: index + 1 })}
    />
  );
}
