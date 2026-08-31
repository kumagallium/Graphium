// PROV ソース ID の「外部プレフィックス」を一元的に扱うヘルパー。
//
// 来歴ビュー（lineage-builder）と近接グラフ（graph-builder）は、いずれも
// wikiMeta.derivedFromNotes などに入る ID を解決して上流ソースを描画する。
// その際 "pdf:" / "url:" だけを特別扱いし、それ以外を「通常ノートの素 ID」とみなす
// 実装が両ファイルに重複していたため、Word(.docx) 由来の "document:" や
// AI チャット由来の "chat:" が取りこぼされ、fileIds に無い ID として黙って落ちていた
// （来歴が知見止まりになる原因）。
//
// ここを単一の真実として、対応プレフィックスの追加漏れ・ファイル間ドリフトを防ぐ。
//
// 規約: derivedFromNotes / derivedFromClaims などに入りうる ID の形式
//   - "pdf:<mediaFileId>"      PDF 素材を Knowledge 化したソース
//   - "url:<url>"              URL を Knowledge 化したソース
//   - "document:<mediaFileId>" Word(.docx) など document 素材を Knowledge 化したソース
//   - "chat:<timestamp>"       AI チャットを Knowledge 化したソース
//   - "memo:<captureId>"       メモ（CaptureEntry）を Knowledge 化したソース
//   - "shared:<sharedId>"      team-shared storage のエントリを引用したソース
//                              （EditActivity.used にのみ入る。derivedFromNotes には入らない）
//   - "data:<mediaFileId>"     区切りテキスト（.csv/.txt/.dat）のデータ素材への引用リンク
//                              （@メンションの linkStore にのみ入る。Knowledge 化の対象では
//                              ないため derivedFromNotes には入らず、ingester のモード判定
//                              （server/routes/wiki.ts）にも関与しない）
//   上記以外（プレフィックス無し）は通常ノート / Knowledge ノートの素 ID。
//
// 注: server/routes/wiki.ts のモード判定 regex はここを import できない
// （バンドル境界）ため列挙を複製している。pdf:/document:/url:/chat: は
// document モード（多数の知見を収穫）、memo: は memo モード（1 断片 ≈ 1 着想を
// 抽出）と、ingester の Claim ガイダンスがソース種別で切り替わる。

export type ExternalSourceKind = "pdf" | "url" | "document" | "chat" | "memo" | "shared" | "data";

const PREFIXES: { kind: ExternalSourceKind; prefix: string }[] = [
  { kind: "pdf", prefix: "pdf:" },
  { kind: "url", prefix: "url:" },
  { kind: "document", prefix: "document:" },
  { kind: "chat", prefix: "chat:" },
  { kind: "memo", prefix: "memo:" },
  { kind: "shared", prefix: "shared:" },
  { kind: "data", prefix: "data:" },
];

/**
 * 外部ソース ID なら { kind, key }（key はプレフィックスを除いた本体）を返す。
 * 通常ノート / Knowledge ノートの素 ID なら null。
 */
export function parseExternalSource(
  id: string,
): { kind: ExternalSourceKind; key: string } | null {
  for (const { kind, prefix } of PREFIXES) {
    if (id.startsWith(prefix)) return { kind, key: id.slice(prefix.length) };
  }
  return null;
}

/** 外部ソース ID かどうか（pdf: / url: / document: / chat: / memo:）。 */
export function isExternalSourceId(id: string): boolean {
  return parseExternalSource(id) !== null;
}
