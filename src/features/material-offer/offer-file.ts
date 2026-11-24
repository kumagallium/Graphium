// 受け取り待ちの置き方（MCP の offer_material と、アプリの見張りの両方が使う）。React に依存しない。
//
// appdata の 2 つのキーに分けて置く（どちらも appdata/<key>.json。Tauri・sidecar の既存の
// readAppData / listAppDataKeys / deleteAppData で読み書きできるので、Rust に新しい口を足さない）:
//   material-offer-<id>        メタ（OfferMeta）。MCP は中身を書き終えてから最後にこれを書く
//   material-offer-bytes-<id>  中身（{ base64 }）
// 一覧は prefix "material-offer-" で取り、bytes の方を除いて数える。
// 設計: docs/internal/design_chatgpt_attachment_offer.md

/** メタのキーの頭（中身のキーもこれで始まるので、一覧では OFFER_BYTES_PREFIX を除く） */
export const OFFER_META_PREFIX = "material-offer-";
export const OFFER_BYTES_PREFIX = "material-offer-bytes-";

/** 選ばないまま、この日数が過ぎた申し出は消す */
export const OFFER_EXPIRE_DAYS = 14;
/** 待っていられる申し出の数（溜まり続けないように。超えたら MCP が断る） */
export const OFFER_MAX_PENDING = 50;

export type OfferMeta = {
  version: 1;
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** 中身の SHA-256（16 進） */
  sha256: string;
  /** 元の場所（AI が渡したパスを realpath で解いたもの） */
  sourcePath: string;
  /** 申し出たアプリの名前（画面の「どこから」） */
  client: string;
  offeredAt: string;
  /** 同じ会話で作ったノート（実在を確かめたものだけ） */
  noteId?: string;
};

export type OfferBytes = { base64: string };

export function offerMetaKey(id: string): string {
  return `${OFFER_META_PREFIX}${id}`;
}

export function offerBytesKey(id: string): string {
  return `${OFFER_BYTES_PREFIX}${id}`;
}

/** listAppDataKeys(OFFER_META_PREFIX) の結果から、メタのキーの id だけを取り出す */
export function offerIdsFromKeys(keys: string[]): string[] {
  return keys
    .filter((k) => k.startsWith(OFFER_META_PREFIX) && !k.startsWith(OFFER_BYTES_PREFIX))
    .map((k) => k.slice(OFFER_META_PREFIX.length))
    .filter((id) => /^[A-Za-z0-9-]{1,100}$/.test(id));
}

/** 期限切れか（offeredAt が読めないものも切れた扱いにして片付ける） */
export function isOfferExpired(meta: Pick<OfferMeta, "offeredAt">, now: number = Date.now()): boolean {
  const t = Date.parse(meta.offeredAt);
  if (!Number.isFinite(t)) return true;
  return now - t > OFFER_EXPIRE_DAYS * 24 * 60 * 60 * 1000;
}

/** 読んだ JSON がメタの形か（壊れた・古い形のものは null） */
export function parseOfferMeta(raw: unknown): OfferMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) return null;
  const str = (v: unknown) => typeof v === "string" && v.length > 0;
  if (!str(m.id) || !str(m.name) || !str(m.mimeType) || !str(m.sha256) || !str(m.sourcePath) || !str(m.client) || !str(m.offeredAt)) {
    return null;
  }
  if (typeof m.size !== "number" || !Number.isFinite(m.size) || m.size < 0) return null;
  if (m.noteId !== undefined && !str(m.noteId)) return null;
  return m as unknown as OfferMeta;
}

/** MCP の clientInfo.name を、画面の「どこから」に出す名前にする */
export function displayClientName(raw: string | undefined): string {
  const name = (raw ?? "").trim();
  const lower = name.toLowerCase();
  // ChatGPT のデスクトップアプリは同梱の Codex の仕組みで MCP につなぐので、名前では見分けられない
  if (lower.includes("codex") || lower.includes("chatgpt") || lower.includes("openai")) return "ChatGPT / Codex";
  if (lower.includes("claude")) return "Claude";
  if (!name) return "AI";
  return name.length > 40 ? `${name.slice(0, 40)}…` : name;
}
