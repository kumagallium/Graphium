// 個人テンプレートの保存（StorageProvider の appData）。
//
// 設計判断:
// - 公式（TemplateDef）・チーム共有（共有ライブラリ）とは別に、「自分だけの雛形」を持つ。
//   保存先は今使っている保存先の appData なので、共有フォルダ設定が無くても使える。
// - 1 テンプレート = 1 キー（`user-template-<id>`）。一覧は listAppDataKeys で引く。
//   なぜ 1 本の配列にしないか: 2 つの端末・タブが同時に保存したとき、配列だと片方が消える。
// - 本文は PageTemplate をそのまま持つ。メディアは auto-blob せず URL のまま
//   （同じ保存先の中なので、チーム共有のように外へ持ち出す必要がない）。
// - 一覧の変化は小さな購読ストアで通知する。ピッカーを開き直さなくても、
//   保存・改名・削除の直後に表へ反映されるようにするため。

import { useCallback, useSyncExternalStore } from "react";
import type { GraphiumPage } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { getActiveProvider } from "../../lib/storage/registry";
import type { StepAttributes } from "../context-label/label-attributes";
import { extractMediaFromBlocks } from "../asset-browser/media-index";
import { createTemplate } from "./save";
import type { PageTemplate } from "./types";

export const USER_TEMPLATE_KEY_PREFIX = "user-template-";

export type UserTemplateRecord = {
  version: 1;
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  template: PageTemplate;
};

/** ストアが使う appData の 4 メソッドだけを要求する（テストで偽物を渡しやすくする） */
export type UserTemplateProvider = Pick<
  StorageProvider,
  "readAppData" | "writeAppData" | "listAppDataKeys" | "deleteAppData"
>;

/** appData の 4 メソッドがすべてそろっているか。欠けた保存先では機能ごと隠す */
export function isUserTemplateSupported(
  provider: Partial<UserTemplateProvider> | null | undefined,
): provider is UserTemplateProvider {
  return (
    !!provider &&
    typeof provider.readAppData === "function" &&
    typeof provider.writeAppData === "function" &&
    typeof provider.listAppDataKeys === "function" &&
    typeof provider.deleteAppData === "function"
  );
}

// テストやストーリーが保存先を差し替えるための上書き
let providerOverride: UserTemplateProvider | null = null;

/** テスト・Storybook 用。null で既定（アクティブな保存先）に戻す */
export function __setUserTemplateProviderForTest(provider: UserTemplateProvider | null): void {
  providerOverride = provider;
  resetSnapshot();
}

/** 既定の保存先。未設定（起動直後など）は null として扱い、例外にしない */
export function getUserTemplateProvider(): UserTemplateProvider | null {
  if (providerOverride) return providerOverride;
  try {
    const p = getActiveProvider();
    return isUserTemplateSupported(p) ? p : null;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 壊れたレコード・形の違うレコードは null（一覧から静かに外す） */
function parseRecord(raw: unknown, key: string): UserTemplateRecord | null {
  if (!isObject(raw) || raw.version !== 1) return null;
  if (typeof raw.id !== "string" || `${USER_TEMPLATE_KEY_PREFIX}${raw.id}` !== key) return null;
  if (typeof raw.title !== "string") return null;
  if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") return null;
  const tpl = raw.template;
  if (!isObject(tpl) || !Array.isArray(tpl.blocks)) return null;
  return {
    version: 1,
    id: raw.id,
    title: raw.title,
    ...(typeof raw.description === "string" && raw.description ? { description: raw.description } : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    template: tpl as unknown as PageTemplate,
  };
}

/** 保存済みの個人テンプレート（更新日時の新しい順）。壊れたレコードは飛ばす */
export async function listUserTemplates(
  provider: UserTemplateProvider,
): Promise<UserTemplateRecord[]> {
  const keys = await provider.listAppDataKeys!(USER_TEMPLATE_KEY_PREFIX);
  const records = await Promise.all(
    keys.map(async (key) => {
      try {
        return parseRecord(await provider.readAppData!(key), key);
      } catch {
        return null;
      }
    }),
  );
  return records
    .filter((r): r is UserTemplateRecord => r !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 1 件だけ読む（挿入時）。無い・壊れているときは null */
export async function getUserTemplate(
  id: string,
  provider: UserTemplateProvider | null = getUserTemplateProvider(),
): Promise<UserTemplateRecord | null> {
  if (!provider) return null;
  const key = `${USER_TEMPLATE_KEY_PREFIX}${id}`;
  try {
    return parseRecord(await provider.readAppData!(key), key);
  } catch {
    return null;
  }
}

export type SaveUserTemplateParams = {
  title: string;
  description?: string;
  page: GraphiumPage;
  /** 連動属性（blockId → StepAttributes）。ラベルストアにしか無いので呼び出し側が渡す */
  attributes?: [string, StepAttributes][];
  provider?: UserTemplateProvider | null;
};

/** ページを個人テンプレートとして保存する。毎回新しい id */
export async function saveUserTemplate(params: SaveUserTemplateParams): Promise<UserTemplateRecord> {
  const provider = params.provider ?? getUserTemplateProvider();
  if (!provider) throw new Error("This storage does not support personal templates.");
  const { page } = params;
  const title = params.title.trim() || page.title || "Untitled";
  const labels = Object.entries(page.labels ?? {});
  // 連動属性はラベル付きブロックにしか意味がない（チーム共有と同じ絞り込み）
  const labeledIds = new Set(labels.map(([blockId]) => blockId));
  const attributes = (params.attributes ?? []).filter(([blockId]) => labeledIds.has(blockId));
  const template = createTemplate({
    name: title,
    pageTitle: page.title,
    blocks: page.blocks,
    labels,
    attributes,
    tableMeta: page.tableMeta,
    mediaInlineLabels: page.mediaInlineLabels,
  });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const description = params.description?.trim();
  const record: UserTemplateRecord = {
    version: 1,
    id,
    title,
    ...(description ? { description } : {}),
    createdAt: now,
    updatedAt: now,
    template,
  };
  await provider.writeAppData!(`${USER_TEMPLATE_KEY_PREFIX}${id}`, record);
  await refreshUserTemplates(provider);
  return record;
}

/** 題名を変える。空の題名は受け付けない。見つからなければ false */
export async function renameUserTemplate(
  id: string,
  title: string,
  provider: UserTemplateProvider | null = getUserTemplateProvider(),
): Promise<boolean> {
  const next = title.trim();
  if (!provider || !next) return false;
  const current = await getUserTemplate(id, provider);
  if (!current) return false;
  await provider.writeAppData!(`${USER_TEMPLATE_KEY_PREFIX}${id}`, {
    ...current,
    title: next,
    updatedAt: new Date().toISOString(),
  });
  await refreshUserTemplates(provider);
  return true;
}

/**
 * 素材（の URL）を本文に持つ個人テンプレートの数。素材の削除ダイアログ用。
 * なぜ要るか: 個人テンプレートは素材の URL をそのまま持つが、usedIn の走査は
 * ノートしか見ないので、素材を消すと差し込んだときに参照切れになる。
 * 照合は usedIn・版スナップショットと同じ extractMediaFromBlocks（props.url とインラインリンク）。
 */
export async function countUserTemplatesReferencingAsset(
  asset: { url: string },
  provider: UserTemplateProvider | null = getUserTemplateProvider(),
): Promise<number> {
  if (!provider || !asset.url) return 0;
  const items = await listUserTemplates(provider);
  return items.filter((r) => extractMediaFromBlocks(r.template.blocks ?? []).has(asset.url)).length;
}

export async function deleteUserTemplate(
  id: string,
  provider: UserTemplateProvider | null = getUserTemplateProvider(),
): Promise<void> {
  if (!provider) return;
  await provider.deleteAppData!(`${USER_TEMPLATE_KEY_PREFIX}${id}`);
  await refreshUserTemplates(provider);
}

// ── 購読ストア ──

type Snapshot = { items: UserTemplateRecord[]; loading: boolean };

const EMPTY: Snapshot = { items: [], loading: false };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();
// 読み出しの世代。古い読みが新しい結果を上書きしないようにする
let generation = 0;

function emit(next: Snapshot): void {
  snapshot = next;
  listeners.forEach((l) => l());
}

function resetSnapshot(): void {
  generation++;
  emit(EMPTY);
}

/** 一覧を読み直す。保存先が非対応なら空にする */
export async function refreshUserTemplates(
  provider: UserTemplateProvider | null = getUserTemplateProvider(),
): Promise<void> {
  const mine = ++generation;
  if (!provider) {
    emit(EMPTY);
    return;
  }
  emit({ items: snapshot.items, loading: true });
  try {
    const items = await listUserTemplates(provider);
    if (mine === generation) emit({ items, loading: false });
  } catch {
    // 一覧が読めないときは空として扱う（ピッカーを壊さない）
    if (mine === generation) emit({ items: [], loading: false });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUserTemplatesSnapshot(): Snapshot {
  return snapshot;
}

/** 個人テンプレート一覧。読み込みは refresh を呼んだとき（ピッカーを開いたとき）に走る */
export function useUserTemplates(): Snapshot & { refresh: () => Promise<void> } {
  const snap = useSyncExternalStore(subscribe, getUserTemplatesSnapshot, getUserTemplatesSnapshot);
  const refresh = useCallback(() => refreshUserTemplates(), []);
  return { items: snap.items, loading: snap.loading, refresh };
}
