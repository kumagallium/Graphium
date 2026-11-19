// 世界照合の判定（WikiMeta.grounding.validity）を保存する入口。
//
// handleSaveWikiFile は、ほかの保存の最中だと書かずに false を返す。照合は LLM を待つあいだに
// エディタの保存と重なりやすく、以前はその false を無視していたので、判定が黙って消えていた。
// 自動の世界照合では、判定（checkedAt）が残らない知見が「未照合」のまま選び直され、
// LLM を何度も呼ぶ原因にもなる。
//
// 出典照合（source-check/save.ts）と同じく、断られたら待ってやり直し、やり直すたびに
// 最新の文書から作り直す（LLM を待つあいだのエディタの保存を巻き戻さないため）。
// 最後まで書けなければ例外にする（自動の照合はそれを失敗として記録し、同じ回では選び直さない）。

import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";
import { saveWikiWithRetry } from "../wiki/claim-topic-link";
import { attachValidity } from "./index";

type Validity = Parameters<typeof attachValidity>[1];

export type SaveWorldValidityDeps = {
  getCachedDoc: (id: string) => GraphiumDocument | null | undefined;
  loadDoc: (id: string) => Promise<GraphiumDocument | null>;
  /** fm.handleSaveWikiFile 相当（activityType は渡さない）。保存中で書けなければ false */
  saveWikiFile: (wikiId: string, doc: GraphiumDocument) => Promise<boolean | void>;
  /** 断られたときに待つ間隔の基準（ミリ秒）。テスト用 */
  retryDelayMs?: number;
};

/**
 * 1 件の知見の世界照合の判定を書き換えて保存する。
 * makeValidity は最新の wikiMeta から次の判定を作る。null を返したら書かない。
 * 戻り値は書いたかどうか。最後まで書けなければ例外。
 */
export async function saveWorldValidity(
  wikiId: string,
  makeValidity: (meta: WikiMeta) => Validity | null,
  deps: SaveWorldValidityDeps,
): Promise<boolean> {
  const key = `wiki:${wikiId}`;
  const outcome = await saveWikiWithRetry(
    deps.saveWikiFile,
    wikiId,
    async () => {
      const doc = deps.getCachedDoc(key) ?? (await deps.loadDoc(key));
      if (!doc?.wikiMeta) return null;
      const validity = makeValidity(doc.wikiMeta);
      if (validity === null) return null;
      return {
        ...doc,
        wikiMeta: attachValidity(doc.wikiMeta, validity),
        modifiedAt: new Date().toISOString(),
      };
    },
    deps.retryDelayMs,
  );
  if (outcome === "failed") throw new Error(`failed to save the world check: ${wikiId}`);
  return outcome === "saved";
}
