// 記録の画面で使う 1 件の記録の形。
// 実データからは from-indexes.ts が写す。各項目の横に「実データのどこから取れるか」を書く。
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
 * 導けないもの（スマホで書いた文字のメモ）は種類を作らない。
 */
export type RecordOrigin =
  /** 手で書いたノート — 下のどれにも当たらないノート */
  | "written"
  /** 録音から — 録音済みの文字起こしブロックを持つノート（note-index の hasRecording）と、そのノートが使っている音声・動画の素材 */
  | "recording"
  /** Web クリップ — 素材の webClip、または type が "url" の素材 */
  | "webClip"
  /** AI から — AI が書いたノート（note-index の model あり・source は human）。MCP 経由の保存も、論文からの抽出もここ */
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

/** 素材の種類（media-index の type。メモを素材として見せる一時エントリの "memo" は除く） */
export type RecordMediaType = "image" | "video" | "audio" | "pdf" | "url" | "document" | "data" | "conversation" | "other";

/** この記録から辿れる先（来歴の入口） */
export type RecordTrace =
  /** 使われているノートの数 — 素材・メモの usedIn */
  | { type: "usedIn"; count: number }
  /** 元になった記録の数 — AI のページの derivedFromNotes */
  | { type: "sources"; count: number };

export type RecordItem = {
  id: string;
  kind: RecordKind;
  /** いつ — ノートは createdAt、素材は uploadedAt、メモは createdAt、共有フォルダの記録は最後に共有した時点の updated_at（ISO 8601） */
  at: string;
  origin: RecordOrigin;
  who: RecordWho;
  /** 何を（題）— ノートは title、素材は name。メモは題を持たない */
  title?: string;
  /** 何を（本文）— メモの text。ノートの本文は索引に無いので入れない */
  text?: string;
  /** 題の下の 1 行 — ノートは headings、URL は urlMeta.excerpt（無ければ description） */
  detail?: string;
  /** ページ数 — 素材の pageCount（PDF・Word・PowerPoint） */
  pageCount?: number;
  /** URL の素材のドメイン — urlMeta.domain */
  domain?: string;
  mediaType?: RecordMediaType;
  trace?: RecordTrace;
  /** 入っているフォルダ — ノート・素材・メモの noteContexts（1 つの記録が複数のフォルダに入ることがある） */
  folders?: readonly string[];
  /**
   * どの計画のどの行の記録か — 共有ライブラリの記録の SharedEntry.extra.planRow。
   * planTitle は計画の封筒の extra.title（計画が共有フォルダに無い・読めていないときは省く）
   */
  planRow?: { planTitle?: string; rowName: string };
  /**
   * 共有した時点のチェックの件数 — 共有ライブラリの記録の SharedEntry.extra.checklist。
   * 計画の行の記録（planRow のある記録）にだけ付く。
   * 数えた結果をそのまま出すだけで、割合や並べ替えには使わない
   */
  checks?: { checked: number; total: number };
  /**
   * 更新の行 — 自分のノート（AI のページは除く）を、作った日とは別に、書き換えた日ごとに 1 行ずつ出すときに付く
   * （note-index の editedAt と modifiedAt から）。このとき at はその日の最後の保存時刻、createdAt は作った日時。
   * 作成の行はそのまま作った日に残る。過去の日の更新の行も、あとで書き換えても動かない
   */
  update?: { createdAt: string };
};

/** 仮データ（Storybook）の言語。画面の表示言語は i18n の Locale を使う */
export type SampleLocale = "ja" | "en";

/**
 * 誰での絞り込み。selfWithAi は「自分」「AI」のどちらにも当たる。
 * all は自分の保存先の記録のすべて。共有フォルダにほかの人が出した記録は other のときだけ出す
 */
export type WhoFilter = "all" | "self" | "ai" | "other";
