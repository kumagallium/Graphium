// インラインラベルのノート横断（MCP 用の包み）。本体は features/prov-graph/entities.ts。
// vault の索引を読んで本体に渡すだけ。

import {
  findNotesUsing as findNotesUsingIn,
  listEntities as listEntitiesIn,
  type EntityGroup,
  type FindNotesUsingQuery,
  type ListEntitiesOptions,
} from "../features/prov-graph/entities";
import { allEntries } from "./search";
import { resolveGraphiumRoot } from "./vault";

export {
  ENTITY_LABELS,
  normalizeEntityText,
  type EntityGroup,
  type EntityLabel,
  type EntityOccurrence,
  type FindNotesUsingQuery,
  type ListEntitiesOptions,
} from "../features/prov-graph/entities";

/** vault 全体のラベル一覧を、横断件数の多い順に返す */
export function listEntities(options: ListEntitiesOptions = {}, root = resolveGraphiumRoot()): EntityGroup[] {
  return listEntitiesIn(allEntries(root), options);
}

/** 指定した材料・道具・条件・出力を使っているノートを横断で探す */
export function findNotesUsing(query: FindNotesUsingQuery, root = resolveGraphiumRoot()): EntityGroup[] {
  return findNotesUsingIn(allEntries(root), query);
}
