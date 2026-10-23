// export_asterism_claims の本体。wiki/ の知見を列挙して Asterism 向け flat JSON を組む。
// 変換は features/wiki/asterism-export.ts の純関数を共有する（GUI の書き出しと同じ列の契約）。
// 設定（asterism）は Node 側から localStorage を読めないため、引数で受ける。

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { WikiMeta } from "../lib/document-types";
import type { AsterismSettings } from "../features/settings/store";
import {
  buildAsterismBundle,
  serializeAsterismBundle,
  type AsterismSkipReason,
} from "../features/wiki/asterism-export";
import { readSentLedger, SentLedgerCorruptError } from "./asterism-sent";
import { readNote, readNoteIndex, resolveGraphiumRoot, wikiDir } from "./vault";

/** 設定が渡されないときの既定（全て空。type の IRI は展開できず null になる） */
export const EMPTY_ASTERISM: AsterismSettings = {
  vocabBaseIri: "",
  claimBaseIri: "",
  typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
};

export type ExportAsterismClaimsInput = {
  includeUntyped?: boolean;
  includeInferred?: boolean;
  /** true ならトピックも topics.json として出す（既定 false） */
  includeTopics?: boolean;
  ids?: string[];
  /** true なら「Asterism に送った」台帳にある知見を外し、skipped に already-sent で返す（既定 false） */
  onlyUnsent?: boolean;
  // 語の基底 IRI・知見の基底 IRI（必須）・型の語（ファイル振り分け用）。設定は Node 側から読めないため引数で受ける
  asterism?: {
    vocabBaseIri?: string;
    claimBaseIri?: string;
    /** source_url の土台（Graphium アプリの URL）。省略時は公開アプリ */
    noteUrlBase?: string;
    typeSlugs?: Partial<AsterismSettings["typeSlugs"]>;
  };
};

export type ExportAsterismClaimsResult =
  | {
      // ファイル名 → 2 スペース JSON 文字列（ZIP にはしない）
      files: Record<string, string>;
      counts: Record<string, number>;
      skipped: { id: string; reason: AsterismSkipReason }[];
    }
  | { error: string };

/** 引数の asterism を既定で埋めて AsterismSettings にする */
function resolveAsterism(input: ExportAsterismClaimsInput["asterism"]): AsterismSettings {
  return {
    vocabBaseIri: input?.vocabBaseIri ?? "",
    claimBaseIri: input?.claimBaseIri ?? "",
    typeSlugs: { ...EMPTY_ASTERISM.typeSlugs, ...(input?.typeSlugs ?? {}) },
  };
}

export function exportAsterismClaims(
  input: ExportAsterismClaimsInput,
  exportedAt: string,
  root = resolveGraphiumRoot(),
): ExportAsterismClaimsResult {
  const dir = wikiDir(root);
  const fileIds = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
    : [];
  const wikiIds = new Set(fileIds);
  // ゴミ箱・アーカイブ済みは一覧（GUI の書き出し）と同じく対象から外す
  const hidden = new Set(
    (readNoteIndex(root)?.notes ?? []).filter((n) => n.deletedAt || n.archivedAt).map((n) => n.noteId),
  );
  const allIds = fileIds.filter((id) => !hidden.has(id));
  const targets = input.ids && input.ids.length > 0 ? input.ids : allIds;

  let sent: Record<string, unknown> = {};
  if (input.onlyUnsent) {
    try {
      sent = readSentLedger(root).sent;
    } catch (e) {
      if (e instanceof SentLedgerCorruptError) return { error: e.message };
      throw e;
    }
  }
  const alreadySent: { id: string; reason: AsterismSkipReason }[] = [];
  const items: { id: string; meta: WikiMeta; title?: string }[] = [];
  for (const id of targets) {
    // wiki/ 直下のものだけを対象にする（notes/ のノートは知見ではない）
    if (!wikiIds.has(id) || hidden.has(id)) continue;
    const doc = readNote(id, root);
    if (!doc?.wikiMeta) continue;
    if (Object.prototype.hasOwnProperty.call(sent, id) &&
      (doc.wikiMeta.kind === "claim" || (input.includeTopics && doc.wikiMeta.kind === "topic"))
    ) {
      alreadySent.push({ id, reason: "already-sent" });
      continue;
    }
    items.push({ id, meta: doc.wikiMeta, title: doc.title });
  }

  const asterism = resolveAsterism(input.asterism);
  const common = {
    includeUntyped: input.includeUntyped ?? false,
    includeInferred: input.includeInferred ?? false,
    includeTopics: false,
    exportedAt,
    isWikiId: (id: string) => wikiIds.has(id),
    noteUrlBase: input.asterism?.noteUrlBase,
  };
  // トピックの参照先: ids／onlyUnsent で選ぶ前の全 wiki から「書き出せる知見」を決める
  let eligibleClaimIds: Set<string> | undefined;
  if (input.includeTopics) {
    const all: { id: string; meta: WikiMeta; title?: string }[] = [];
    for (const id of allIds) {
      const doc = readNote(id, root);
      if (doc?.wikiMeta?.kind === "claim") all.push({ id, meta: doc.wikiMeta, title: doc.title });
    }
    const elig = buildAsterismBundle(all, asterism, common);
    eligibleClaimIds = new Set();
    if (!("error" in elig)) {
      for (const f of ["judgments.json", "rules.json", "observations.json", "interpretations.json", "untyped.json"]) {
        for (const row of elig.files[f] ?? []) eligibleClaimIds.add((row as { id: string }).id);
      }
    }
  }

  const bundle = buildAsterismBundle(items, asterism, {
    ...common,
    includeTopics: input.includeTopics ?? false,
    eligibleClaimIds,
  });
  if ("error" in bundle) {
    if (bundle.error === "note-url-base-invalid") {
      return { error: "noteUrlBase が不正です（http(s) の URL で、# や ? を含まないこと）。省略すると公開アプリの URL を使います。" };
    }
    return {
      error:
        "claimBaseIri が必要です（http(s) の URL。末尾が / か # でなければ / を補う）。asterism.claimBaseIri に実在の安定した base（例: https://kumagallium.github.io/graphium/claim/）を渡してください。",
    };
  }
  // 知見以外（トピック等）は「除外」ではなく対象外なので skipped から外して件数を読みやすくする
  return {
    files: serializeAsterismBundle(bundle.files),
    counts: bundle.counts,
    skipped: [...bundle.skipped.filter((s) => s.reason !== "not-claim"), ...alreadySent],
  };
}
