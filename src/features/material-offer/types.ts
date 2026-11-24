// 外の AI（ChatGPT など）から「素材にしてほしい」と届いたファイル（受け取り待ちの 1 件）。
//
// MCP の offer_material が <vault>/appdata/material-offers/<id>/ に写しと offer.json を置き、
// アプリが見張って利用者に確かめる。承認されるまで素材の一覧には出さない。
// 設計: docs/internal/design_chatgpt_attachment_offer.md

export type MaterialOffer = {
  id: string;
  /** ファイル名（拡張子を含む） */
  name: string;
  mimeType: string;
  /** バイト数 */
  size: number;
  /** 元の場所（ChatGPT が渡した絶対パス）。承認の前に必ず見せる */
  sourcePath: string;
  /** 申し出たアプリの名前（MCP の clientInfo.name から。例 "ChatGPT"） */
  client: string;
  /** 申し出た時刻（ISO 8601） */
  offeredAt: string;
  /** 同じ会話で作ったノート。あれば承認時に末尾へ素材ブロックを足せる */
  noteId?: string;
  /** noteId のノートの題（アプリが引いて付ける。見つからなければ付けない） */
  noteTitle?: string;
  /** 画像の見た目（アプリが写しから作る。無ければ種類のアイコン） */
  previewUrl?: string;
};

/** 1 件の承認の選び方 */
export type MaterialOfferDecision = {
  /** ノートの末尾に貼るか（noteTitle があるときだけ意味がある） */
  pasteToNote: boolean;
};
