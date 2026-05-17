// material-science プロファイルのエントリ。
//
// Phase 5a では profile = "material-science" 固定。Phase 5b 以降で
// general / biology-wet / ml-experiment などのプロファイルが追加される予定。

export {
  buildMaterialScienceSystemPrompt,
  buildMaterialScienceUserMessage,
} from "./material-science-prompt";
export { parseMatProvOutput } from "./matprov-parser";
export {
  matProvToProvIngester,
  buildBlocksFromProcedure,
} from "./matprov-to-prov-ingester";
export type {
  MatProvActivity,
  MatProvEdge,
  MatProvEntity,
  MatProvGeneration,
  MatProvGraphItem,
  MatProvNode,
  MatProvOutput,
  MatProvProcedure,
  MatProvUsage,
  MatProvValueEntry,
} from "./matprov-types";

/** Phase 5a でサポートする profile 名。Phase 5b で union 型を拡張する。 */
export type ProvProfile = "material-science";
