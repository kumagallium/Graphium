// 受け取り待ち（MCP の offer_material が appdata に置いた申し出）を見張り、承認・断りを行うフック。
//
// 申し出は利用者が ChatGPT などにいる間に届く（Graphium は裏にいる）ので、Web クリップと同じく
// 数秒おきに見張り、ウィンドウに戻ったときにもすぐ見る。デスクトップ版（filesystem）だけ
// — MCP が書く場所（vault の appdata）を読めるのはそこだけ。
//
// 素材にするのは承認したときだけ。登録は既存の素材の登録（中身の被り判定つき）を通す。
// 書き込みは「申し出を消す」以外、すべて呼び出し側のハンドラ経由。
// 設計: docs/internal/design_chatgpt_attachment_offer.md

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { isTauri } from "../../lib/platform";
import { getActiveProvider } from "../../lib/storage/registry";
import type { StorageProvider } from "../../lib/storage/types";
import {
  OFFER_META_PREFIX,
  isOfferExpired,
  offerBytesKey,
  offerIdsFromKeys,
  offerMetaKey,
  parseOfferMeta,
  type OfferBytes,
  type OfferMeta,
} from "./offer-file";
import type { MaterialOfferResult } from "./MaterialOfferNoticeView";
import { safeForPreview } from "./image-size";
import { blockedExtOfName } from "../../lib/blocked-material-exts";
import { computeBlobHash } from "../../lib/storage/shared/hash";
import type { MaterialOffer } from "./types";

/** 見張る間隔 */
export const OFFER_POLL_MS = 4000;
/** 見た目（縮小図）を作る画像の大きさの上限。これより大きい画像は種類のアイコンにする */
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
/** 縮小図にする形（寸法を頭から読めるものだけ。SVG は文字で見た目を作れ・スクリプトを含みうるので描かない） */
const PREVIEW_MIME = new Set(["image/png", "image/jpeg", "image/gif"]);

type OfferStore = Required<Pick<StorageProvider, "readAppData" | "listAppDataKeys" | "deleteAppData">>;

export type MaterialOfferDeps = {
  /** 素材を登録する（同じ中身があればそれを返す） */
  uploadAsset: (file: File) => Promise<{ fileId: string; entry: MediaIndexEntry; duplicate: boolean }>;
  /** ノートの題と作成日時（ゴミ箱・見つからないなら undefined — 貼る選択肢を出さない） */
  noteInfo: (noteId: string) => { title: string; createdAt: string } | undefined;
  /** ノートの末尾に素材を貼る */
  pasteToNote: (noteId: string, entry: MediaIndexEntry) => Promise<void>;
};

function getStore(): OfferStore | null {
  if (!isTauri()) return null;
  const p = getActiveProvider();
  if (p.id !== "filesystem" || !p.readAppData || !p.listAppDataKeys || !p.deleteAppData) return null;
  return p as unknown as OfferStore;
}

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readOfferBytes(store: OfferStore, id: string): Promise<Uint8Array> {
  const raw = (await store.readAppData(offerBytesKey(id))) as OfferBytes | null;
  if (!raw || typeof raw.base64 !== "string") throw new Error("offer bytes missing");
  return bytesFromBase64(raw.base64);
}

async function removeOffer(store: OfferStore, id: string): Promise<void> {
  // メタを先に消す（一覧から先に外す）。中身の削除に失敗して残った分は、MCP が次に呼ばれたとき片付ける
  await store.deleteAppData(offerMetaKey(id));
  await store.deleteAppData(offerBytesKey(id));
}

/** 作ったばかりのノートか（申し出の 1 時間前から、5 分後まで） */
export function isFreshNote(createdAt: string | undefined, offeredAt: string): boolean {
  const c = Date.parse(createdAt ?? "");
  const o = Date.parse(offeredAt);
  if (!Number.isFinite(c) || !Number.isFinite(o)) return false;
  return c >= o - 60 * 60 * 1000 && c <= o + 5 * 60 * 1000;
}

export function useMaterialOffers({ enabled, deps }: { enabled: boolean; deps: MaterialOfferDeps }) {
  const [metas, setMetas] = useState<OfferMeta[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  /** 隅の知らせを「あとで」で閉じた申し出（このセッションのあいだは隅に出さない） */
  const [later, setLater] = useState<Set<string>>(new Set());
  const [pasteToNote, setPasteToNote] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialOfferResult | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  /** 読んだメタ（id → メタ）。同じ申し出を毎回読み直さない */
  const cacheRef = useRef(new Map<string, OfferMeta>());
  /** 処理中・処理済みの id（消すまでの間に見張りが拾い直して出し直さないように） */
  const settledRef = useRef(new Set<string>());
  /** 縮小図を作らないと決めた申し出（読み直さない） */
  const noPreviewRef = useRef(new Set<string>());
  const previewsRef = useRef(previews);
  previewsRef.current = previews;

  const refresh = useCallback(async () => {
    const store = getStore();
    if (!store) return;
    const ids = offerIdsFromKeys(await store.listAppDataKeys(OFFER_META_PREFIX));
    const next: OfferMeta[] = [];
    const now = Date.now();
    for (const id of ids) {
      if (settledRef.current.has(id)) continue;
      let meta = cacheRef.current.get(id) ?? null;
      if (!meta) {
        meta = parseOfferMeta(await store.readAppData(offerMetaKey(id)));
        if (!meta || meta.id !== id) {
          // 壊れた申し出は片付ける（MCP は中身→メタの順に書くので、書きかけのメタは無い）
          await removeOffer(store, id).catch(() => undefined);
          continue;
        }
        cacheRef.current.set(id, meta);
      }
      if (isOfferExpired(meta, now)) {
        cacheRef.current.delete(id);
        await removeOffer(store, id).catch(() => undefined);
        continue;
      }
      next.push(meta);
    }
    next.sort((a, b) => a.offeredAt.localeCompare(b.offeredAt));
    setMetas((prev) =>
      prev.length === next.length && prev.every((m, i) => m.id === next[i].id) ? prev : next,
    );
    // 画像の縮小図は 1 度だけ作る
    for (const m of next) {
      if (previewsRef.current[m.id] || noPreviewRef.current.has(m.id)) continue;
      if (!PREVIEW_MIME.has(m.mimeType) || m.size > PREVIEW_MAX_BYTES) {
        noPreviewRef.current.add(m.id);
        continue;
      }
      // 結果によらず 1 度だけ試す（作れない画像を見張りのたびに読み直さない）
      noPreviewRef.current.add(m.id);
      try {
        const bytes = await readOfferBytes(store, m.id);
        // 寸法が巨大な画像はデコードで画面のプロセスを使い切るので、縮小図にしない
        if (!safeForPreview(bytes)) continue;
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: m.mimeType }));
        setPreviews((p) => ({ ...p, [m.id]: url }));
      } catch {
        /* 見た目が作れなければアイコンのまま */
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !getStore()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await refresh();
      } catch (e) {
        console.warn("[material-offer] 受け取り待ちの確認に失敗:", e);
      } finally {
        running = false;
      }
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, OFFER_POLL_MS);
    };
    const onFocus = () => {
      if (timer) clearTimeout(timer);
      void tick();
    };
    window.addEventListener("focus", onFocus);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  // 消えた申し出の縮小図を手放す
  useEffect(() => {
    const alive = new Set(metas.map((m) => m.id));
    const gone = Object.keys(previews).filter((id) => !alive.has(id));
    if (gone.length === 0) return;
    for (const id of gone) URL.revokeObjectURL(previews[id]);
    setPreviews((p) => Object.fromEntries(Object.entries(p).filter(([id]) => alive.has(id))));
  }, [metas, previews]);

  // 結果は数秒だけ出して消す
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [result]);

  const forget = useCallback((id: string) => {
    settledRef.current.add(id);
    cacheRef.current.delete(id);
    setMetas((prev) => prev.filter((m) => m.id !== id));
  }, []);

  /** 1 件を素材にする（ノートに貼る選択なら貼る）。結果を返す（失敗は投げる） */
  const acceptOne = useCallback(
    async (offer: MaterialOffer, paste: boolean): Promise<{ duplicate: boolean; pasted: boolean }> => {
      const store = getStore();
      if (!store) throw new Error("offers unavailable");
      const meta = cacheRef.current.get(offer.id);
      if (!meta) throw new Error("offer meta missing");
      const bytes = await readOfferBytes(store, offer.id);
      // 見せたものと同じ中身か、取り込む直前に確かめ直す（appdata は MCP 以外も書ける。
      // 見せてから押すまでの間に中身を差し替えられても、素材にしない）
      if (bytes.length !== meta.size || (await computeBlobHash(bytes)) !== meta.sha256) {
        throw new Error("offer content changed");
      }
      const blocked = blockedExtOfName(meta.name);
      if (blocked) throw new Error(`blocked extension: ${blocked}`);
      const file = new File([bytes as BlobPart], offer.name, { type: offer.mimeType });
      const { entry, duplicate } = await depsRef.current.uploadAsset(file);
      let pasted = false;
      if (paste && offer.noteId && offer.noteTitle) {
        await depsRef.current.pasteToNote(offer.noteId, entry);
        pasted = true;
      }
      await removeOffer(store, offer.id);
      forget(offer.id);
      return { duplicate, pasted };
    },
    [forget],
  );

  const pasteFor = useCallback(
    (offer: MaterialOffer) => pasteToNote[offer.id] ?? Boolean(offer.pasteDefault),
    [pasteToNote],
  );

  const accept = useCallback(
    async (offer: MaterialOffer) => {
      setBusy(offer.id);
      try {
        const { duplicate, pasted } = await acceptOne(offer, pasteFor(offer));
        setResult(
          duplicate && !pasted
            ? { kind: "duplicate", name: offer.name }
            : { kind: "added", name: offer.name, noteTitle: pasted ? offer.noteTitle : undefined },
        );
      } catch (e) {
        console.error("[material-offer] 取り込みに失敗:", e);
        setResult({ kind: "failed", name: offer.name });
      } finally {
        setBusy(null);
      }
    },
    [acceptOne, pasteFor],
  );

  const decline = useCallback(
    async (offer: MaterialOffer) => {
      const store = getStore();
      if (!store) return;
      setBusy(offer.id);
      try {
        await removeOffer(store, offer.id);
        forget(offer.id);
        setResult({ kind: "declined", name: offer.name });
      } catch (e) {
        console.error("[material-offer] 断る処理に失敗:", e);
        setResult({ kind: "failed", name: offer.name });
      } finally {
        setBusy(null);
      }
    },
    [forget],
  );

  const offers: MaterialOffer[] = metas.map((m) => {
    const note = m.noteId ? deps.noteInfo(m.noteId) : undefined;
    const noteTitle = note?.title;
    return {
      id: m.id,
      name: m.name,
      mimeType: m.mimeType,
      size: m.size,
      sourcePath: m.sourcePath,
      client: m.client,
      offeredAt: m.offeredAt,
      ...(m.noteId && noteTitle ? { noteId: m.noteId, noteTitle, pasteDefault: isFreshNote(note?.createdAt, m.offeredAt) } : {}),
      ...(previews[m.id] ? { previewUrl: previews[m.id] } : {}),
    };
  });

  /**
   * 画面に出ている申し出をまとめて取り込む。渡された一覧（押した時点で利用者に見えていたもの）だけを
   * 対象にする — 待っているすべてにすると、見ていない申し出（3 件目以降・押す直前に届いたもの）まで入る
   */
  const acceptAll = useCallback(async (list: MaterialOffer[]) => {
    if (list.length === 0) return;
    setBusy("all");
    let added = 0;
    let failedName: string | null = null;
    for (const offer of list) {
      try {
        await acceptOne(offer, pasteFor(offer));
        added++;
      } catch (e) {
        console.error("[material-offer] 取り込みに失敗:", offer.name, e);
        failedName ??= offer.name;
      }
    }
    setBusy(null);
    setResult(failedName ? { kind: "failed", name: failedName } : { kind: "addedMany", count: added });
  }, [acceptOne, pasteFor]);

  return {
    /** 待っているすべて（取り込みの画面・件数） */
    offers,
    /** 隅に出すもの（「あとで」を除く） */
    noticeOffers: offers.filter((o) => !later.has(o.id)),
    pasteToNote,
    setPasteToNote: (id: string, value: boolean) => setPasteToNote((p) => ({ ...p, [id]: value })),
    busy,
    result,
    accept: (o: MaterialOffer) => void accept(o),
    decline: (o: MaterialOffer) => void decline(o),
    later: (o: MaterialOffer) => setLater((s) => new Set(s).add(o.id)),
    acceptAll: (list: MaterialOffer[]) => void acceptAll(list),
  };
}
