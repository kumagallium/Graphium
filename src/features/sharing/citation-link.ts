// 共有エントリの引用リンク（…#shared/<uuid>）の形式規約。
//
// ノートの「リンクをコピー」（#note/<id>）と同じ流儀で、Library からエントリの
// リンクをコピーし、ノートへの単体ペーストで引用カードに変換する（paste 側は
// blocks/shared-citation/paste.ts）。#shared/ は hash ルーターには登録しない
// （未知 hash は home にフォールバックする）。ペースト変換専用の識別子。

export function buildSharedCitationLink(sharedId: string): string {
  return `${window.location.origin}${window.location.pathname}#shared/${sharedId}`;
}

const SHARED_LINK_RE = /#shared\/([0-9a-fA-F-]{36})$/;

/** 単体トークンが共有エントリリンクなら sharedId を返す。 */
export function matchSharedCitationLink(text: string): string | null {
  const m = SHARED_LINK_RE.exec(text);
  return m ? m[1] : null;
}
