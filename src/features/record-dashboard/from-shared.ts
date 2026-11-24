// 共有フォルダの記録（SharedEntry の封筒）を、ホームの 1 件の記録（RecordItem）に写す。
// 読むだけの純粋な関数で、封筒に書いてある値だけを使う（本文は読まない。共有フォルダにも書かない）。
//
// 守っていること:
//   - 写すのはノートと AI のページだけ。コメント・提案・テンプレートは記録の流れに混ぜない。
//     文献とデータは、題や種類の持ち方がノートと違うので、まだ写さない
//   - 自分が共有したものは写さない。手元のノートとして、すでにホームに並んでいる
//   - 共有をやめたもの（unshared）は写さない
//   - 「計画の題 › 行の名前」と、共有した時点のチェックの件数は、計画の行の記録にだけ添える。
//     件数は数えた結果をそのまま渡すだけで、並べ替えや絞り込みには使わない
//   - 封筒はほかの人が書くので、題・名前の長さに上限を置き、日時は読める形かを確かめる。
//     先の日時を書かれても、一覧の先頭に居座らせない
import type { SharedEntry } from "../../lib/storage/shared";
import { getSharedChecklistCount } from "../sharing/checklist-count";
import { planRowDisplayName, readPlanRowRef } from "../sharing/plan-row-ref";
import type { SharedDerivedMetaMap } from "../sharing/shared-library-store";
import { timeOf } from "./model";
import type { RecordItem } from "./types";

export type SharedRecordSources = {
  /** 共有フォルダの封筒（共有ストアのスナップショットの entries） */
  entries: readonly SharedEntry[];
  /** この端末で確かめた本文から拾った控え（チェックの件数の補いに使う） */
  derived?: SharedDerivedMetaMap;
  /** 自分のメールアドレス。自分が共有したものを外すのに使う（分からなければ外さない） */
  selfEmail?: string | null;
  /** いま（ISO 8601）。これより先の日時を持つ封筒の扱いを決めるのに使う。省くと端末の時刻 */
  now?: string;
};

/** 題・名前として読む長さの上限（超えた分は切る） */
export const SHARED_TEXT_LIMIT = 300;

function clip(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, SHARED_TEXT_LIMIT) : "";
}

function titleOf(entry: SharedEntry): string {
  return clip((entry.extra as Record<string, unknown> | undefined)?.title);
}

/** 端末どうしの時計のずれとして受け入れる幅。これより先の日時は、書かれた値を信用しない */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/** 日時として読めて、いまより先に行きすぎていなければ、その時刻（ミリ秒）。そうでなければ null */
function readTime(value: unknown, nowMs: number): number | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t) || t > nowMs + CLOCK_SKEW_MS) return null;
  // 時計が少し進んだ端末で共有されたものは、いまの時刻として扱う（明日の記録にしない）
  return Math.min(t, nowMs);
}

/**
 * いつ — 最後に共有した時点（updated_at）。チェックの件数も、この時点のもの。
 * updated_at が読めない・先に行きすぎているときは created_at を使い、どちらも使えなければ空文字
 * （日付の無い記録として、一覧の最後に置かれる）
 */
function sharedAt(entry: SharedEntry, nowMs: number): string {
  const t = readTime(entry.updated_at, nowMs) ?? readTime(entry.created_at, nowMs);
  return t === null ? "" : new Date(t).toISOString();
}

/** 記録の id から共有エントリの id を取り出す。共有の記録でなければ null */
export function sharedIdOfRecord(item: Pick<RecordItem, "id">): string | null {
  return item.id.startsWith("shared:") ? item.id.slice("shared:".length) : null;
}

/** ほかの人が共有フォルダに出したノートと AI のページを、新しい順に並べる */
export function buildSharedRecords({ entries, derived, selfEmail, now }: SharedRecordSources): RecordItem[] {
  const parsedNow = now ? Date.parse(now) : Number.NaN;
  const nowMs = Number.isNaN(parsedNow) ? Date.now() : parsedNow;
  // 計画の題を引くための表（共有中のノートの id → 題）
  const noteTitles = new Map<string, string>();
  for (const e of entries) {
    if (e.type === "note" && e.status !== "unshared") noteTitles.set(e.id, titleOf(e));
  }
  const items: RecordItem[] = [];
  for (const entry of entries) {
    if (entry.type !== "note" && entry.type !== "knowledge") continue;
    if (entry.status === "unshared") continue;
    if (selfEmail && entry.author?.email === selfEmail) continue;
    const item: RecordItem = {
      id: `shared:${entry.id}`,
      kind: entry.type === "knowledge" ? "wiki" : "note",
      at: sharedAt(entry, nowMs),
      origin: "shared",
      who: { type: "other", name: clip(entry.author?.name) || clip(entry.author?.email) },
      title: titleOf(entry),
    };
    const ref = readPlanRowRef(entry);
    if (ref) {
      const planTitle = ref.planIds.map((id) => noteTitles.get(id)).find((t) => !!t);
      item.planRow = { ...(planTitle ? { planTitle } : {}), rowName: planRowDisplayName(ref.rowName) };
      const checks = getSharedChecklistCount(entry, derived);
      if (checks) item.checks = { checked: checks.checked, total: checks.total };
    }
    items.push(item);
  }
  return items.sort((a, b) => timeOf(b.at) - timeOf(a.at));
}
