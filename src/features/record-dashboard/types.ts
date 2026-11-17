// 記録のダッシュボード（デザイン提案・Storybook のみ）で使う 1 件の記録の形。
// アプリの実データにはまだつないでいない。各項目の横に「実データのどこから取れるか」を書く。
// ここに無い項目（会議で話した人、ノート本文の冒頭、素材を入れた人）は、いまのデータに無いので持たない。

/** 記録の種類。保存先がそのまま種類になる */
export type RecordKind =
  /** ノート — note-index の source が "human"（または未設定） */
  | "note"
  /** AI のページ — note-index の source が "ai"（wikiKind あり） */
  | "wiki"
  /** 素材 — media-index */
  | "media"
  /** メモ — .graphium-captures.json */
  | "memo";

/**
 * 出どころ（どこで残したか）。専用の欄は無く、どれも既存の項目から導く。
 * 導けないもの（スマホで書いた文字のメモ、など）は種類を作らない。
 */
export type RecordOrigin =
  /** 手で書いたノート — 下のどれにも当たらないノート */
  | "written"
  /** 会議の録音 — 文字起こしブロックを持つノート（media-index の音声素材の usedIn から引く） */
  | "meeting"
  /** Web クリップ — 素材の webClip、または type が "url" の素材 */
  | "webClip"
  /** AI との対話 — ノートの generatedBy（note-index の model あり・source は human） */
  | "aiChat"
  /** ナレッジ化 — AI のページ（wikiMeta.derivedFromNotes を持つ） */
  | "knowledge"
  /** スマホから — 素材の capture（受信箱から取り込んだ写真・音声・動画） */
  | "phone"
  /** 取り込んだファイル — ノートの importSource、または手元から入れた素材 */
  | "file"
  /** テンプレートから — ノートの templateFrom */
  | "template"
  /** 素材からの引用 — メモの sourceAsset */
  | "quote"
  /** メモ — 出典を持たないメモ（どの端末で書いたかは記録に無い） */
  | "memo"
  /** 共有ライブラリ — SharedEntry（作者は author.name） */
  | "shared";

/** 残した人（誰が） */
export type RecordWho =
  /** 自分 — AI の印も共有の作者も無い記録。素材・メモには専用の欄が無く、ここは導出 */
  | { type: "self" }
  /** AI — AI のページ。model は note-index の model */
  | { type: "ai"; model?: string }
  /** 自分と AI — AI が書き、自分が指示したノート（note-index の author と model） */
  | { type: "selfWithAi"; model?: string }
  /** 共有の作者 — SharedEntry.author.name */
  | { type: "other"; name: string };

/** 素材の種類（media-index の type のうち、絵で見分けたいもの） */
export type RecordMediaType = "image" | "audio" | "pdf" | "url";

/** この記録から辿れる先（来歴の入口） */
export type RecordTrace =
  /** 使われているノートの数 — 素材・メモの usedIn */
  | { type: "usedIn"; count: number }
  /** 元になった記録の数 — AI のページの derivedFromNotes */
  | { type: "sources"; count: number };

export type RecordItem = {
  id: string;
  kind: RecordKind;
  /** いつ — ノートは createdAt、素材は uploadedAt、メモは createdAt（ISO 8601） */
  at: string;
  origin: RecordOrigin;
  who: RecordWho;
  /** 何を（題）— ノートは title、素材は name。メモは題を持たない */
  title?: string;
  /** 何を（本文）— メモの text。ノートの本文は索引に無いので入れない */
  text?: string;
  /** 題の下の 1 行 — ノートは headings、URL は urlMeta.excerpt、PDF は pageCount */
  detail?: string;
  /** URL の素材のドメイン — urlMeta.domain */
  domain?: string;
  mediaType?: RecordMediaType;
  trace?: RecordTrace;
};

export type RecordLocale = "ja" | "en";

/** 誰での絞り込み。selfWithAi は「自分」「AI」のどちらにも当たる */
export type WhoFilter = "all" | "self" | "ai" | "other";
