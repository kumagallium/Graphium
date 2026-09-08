// 投入口の実行器（純関数）
//
// classify → Markdown インポート → 素材アップロードの順に処理を進める。
// UI に依存しない形にして、IntakeModal の running/done 表示や useIntake から
// 同じロジックを呼べるようにする。

import { classifyIntakeFiles } from "./classify";
import { commonRootOf, folderOf } from "./folders";
import type { IntakeFile } from "./types";

/**
 * path から拡張子を取り出す（小文字・ドット付き。例: ".pptx"）。
 * ドット始まりのパス（.obsidian/app.json 等）は先頭のドットではなく、
 * 中のファイル名（app.json）の拡張子を数える。拡張子が無ければ "(none)"
 */
function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dotIndex = base.lastIndexOf(".");
  // dotIndex <= 0 は「拡張子が無い」（隠しファイル自体の . は拡張子ではない）
  if (dotIndex <= 0) return "(none)";
  return base.slice(dotIndex).toLowerCase();
}

/** Markdown インポート（importMarkdown 実装）が返す結果 */
export type MarkdownImportResult = {
  created: number;
  /** 中身が同じファイルが既にノートとして存在し、新規作成せず既存ノートを使い回した件数 */
  existing: number;
  linksResolved: number;
  linksUnresolved: number;
  failed: string[];
  lastNewId: string | null;
};

/** 投入口全体の進捗（notes + materials を合算した done/total） */
export type IntakeProgress = { done: number; total: number; current?: string; failed: string[] };

export type IntakeDeps = {
  /**
   * notes を Graphium ノートとして取り込む。onProgress は notes 内の進捗
   * （done/total は notes 件数基準）。ctx.allFiles は classify 前の全ファイル
   * （notes + materials + skipped）で、Markdown 内の画像参照（![[img.png]] 等）を
   * 同じフォルダの他ファイルから解決するために使う。
   */
  importMarkdown: (
    files: IntakeFile[],
    onProgress: (p: IntakeProgress) => void,
    ctx: { allFiles: IntakeFile[]; folderOf: (file: IntakeFile) => string | undefined },
  ) => Promise<MarkdownImportResult>;
  /**
   * 素材を 1 件アップロードする。戻り値の duplicate が true なら
   * 「新規登録ではなく既存の素材を返した」ことを表す（materialsExisting の集計に使う）
   */
  uploadAsset: (file: File) => Promise<{ fileId?: string; duplicate?: boolean } | void | unknown>;
  /**
   * 素材のフォルダ（noteContexts）を差し替える。登録済みの素材（duplicate）は
   * 既存のフォルダを尊重して呼ばない。失敗しても取り込み自体は続行する
   */
  setAssetFolder?: (fileId: string, folder: string) => Promise<void> | void;
  /** 全件終了後に 1 回だけ呼ぶ（インデックス再構築など） */
  afterRun?: () => Promise<void> | void;
};

export type IntakeOutcome = {
  notes: number;
  /**
   * notes とは別カウント: 中身が同じファイルが既に取り込み済みのノートとして
   * 存在し、新規作成せず既存ノートを使い回した件数（notes には含まれない。
   * 素材の materialsExisting は「アップロード扱いにした件数の内数」だが、
   * こちらはそもそも作成しないので notes の外側になる）
   */
  notesExisting: number;
  materials: number;
  /** materials のうち、新規登録ではなく既に登録済みだった件数（materials ⊇ materialsExisting） */
  materialsExisting: number;
  linksResolved: number;
  linksUnresolved: number;
  failed: string[];
  skipped: number;
  /** 対象外ファイルの内訳。キーは拡張子（小文字・ドット付き、無ければ "(none)"） */
  skippedByExt: Record<string, number>;
  lastNewId: string | null;
  /** フォルダを付けたファイルの「異なるフォルダ数」（ノート・素材あわせて重複なし） */
  folders: number;
};

/**
 * 2 回分の IntakeOutcome を 1 つに畳む。実行中に次のバッチが積まれたとき、
 * バッチごとの結果を合算して最終的な done を 1 回だけ出すために使う。
 * notes / materials / materialsExisting / linksResolved / linksUnresolved / skipped は
 * 加算、skippedByExt はキーごとに加算、failed は連結、lastNewId は後勝ち
 * （新しい方が null なら前を保つ）。
 * folders は本来「異なるフォルダ数」の集合和だが、この関数は集合を持たず件数しか
 * 持たないため、加算で近似する（バッチをまたいで同じフォルダ名が使われていても
 * 別カウントとして足してしまう）。復元レポートの目安表示なので許容する
 */
export function mergeOutcome(a: IntakeOutcome, b: IntakeOutcome): IntakeOutcome {
  const skippedByExt: Record<string, number> = { ...a.skippedByExt };
  for (const [ext, count] of Object.entries(b.skippedByExt)) {
    skippedByExt[ext] = (skippedByExt[ext] ?? 0) + count;
  }
  return {
    notes: a.notes + b.notes,
    notesExisting: a.notesExisting + b.notesExisting,
    materials: a.materials + b.materials,
    materialsExisting: a.materialsExisting + b.materialsExisting,
    linksResolved: a.linksResolved + b.linksResolved,
    linksUnresolved: a.linksUnresolved + b.linksUnresolved,
    failed: [...a.failed, ...b.failed],
    skipped: a.skipped + b.skipped,
    skippedByExt,
    lastNewId: b.lastNewId ?? a.lastNewId,
    folders: a.folders + b.folders,
  };
}

/**
 * 投入口の実行本体。classify → notes（importMarkdown）→ materials（uploadAsset）
 * の順で処理し、進捗を全体の done/total に写像して onProgress に流す。
 */
export async function runIntake(
  files: IntakeFile[],
  deps: IntakeDeps,
  onProgress: (p: IntakeProgress) => void,
): Promise<IntakeOutcome> {
  const { notes, materials, skipped } = classifyIntakeFiles(files);
  const total = notes.length + materials.length;
  const failed: string[] = [];

  // フォルダの引き継ぎ: 落としたファイル群に共通の根があれば 1 回だけ計算し、
  // 以降は folderOfFile(file) で「親/子」文字列（無ければ undefined=未分類）を引く
  const root = commonRootOf(files);
  const folderOfFile = (file: IntakeFile) => folderOf(file.path, root);
  const foldersSeen = new Set<string>();

  // notes: importMarkdown 側の進捗（0..notes.length）をそのまま全体の done として流す。
  // 実装側が丸ごと throw しても（保存先が開けない等）素材の登録まで止めない。
  // その場合は notes 全件を失敗扱いにして先へ進む
  let markdownResult: MarkdownImportResult = {
    created: 0,
    existing: 0,
    linksResolved: 0,
    linksUnresolved: 0,
    failed: [],
    lastNewId: null,
  };
  if (notes.length > 0) {
    try {
      markdownResult = await deps.importMarkdown(
        notes,
        (p) => {
          onProgress({ done: p.done, total, current: p.current, failed: [...failed, ...p.failed] });
        },
        { allFiles: files, folderOf: folderOfFile },
      );
    } catch (err) {
      console.warn("[intake] Markdown の取り込みが途中で失敗:", err);
      markdownResult = { ...markdownResult, failed: notes.map((n) => n.file.name) };
    }
  }
  failed.push(...markdownResult.failed);
  for (const n of notes) {
    const folder = folderOfFile(n);
    if (folder) foldersSeen.add(folder);
  }

  // materials: 1 件ずつアップロード。失敗しても続行する
  let materialsUploaded = 0;
  let materialsExisting = 0;
  const notesDone = notes.length;
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    onProgress({ done: notesDone + i, total, current: m.file.name, failed });
    try {
      const result = await deps.uploadAsset(m.file);
      materialsUploaded += 1;
      const duplicate =
        result && typeof result === "object" && (result as { duplicate?: boolean }).duplicate === true;
      if (duplicate) {
        materialsExisting += 1;
      }
      const folder = folderOfFile(m);
      if (folder) {
        foldersSeen.add(folder);
        // 登録済みの素材（duplicate）は既存のフォルダを尊重して触らない
        if (!duplicate && deps.setAssetFolder) {
          const fileId = result && typeof result === "object" ? (result as { fileId?: string }).fileId : undefined;
          if (fileId) {
            try {
              await deps.setAssetFolder(fileId, folder);
            } catch (err) {
              console.warn(`[intake] 素材のフォルダ設定に失敗: ${m.file.name}`, err);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[intake] 素材のアップロードに失敗: ${m.file.name}`, err);
      failed.push(m.file.name);
    }
  }
  onProgress({ done: total, total, failed });

  // 対象外ファイルの内訳を拡張子ごとに数える
  const skippedByExt: Record<string, number> = {};
  for (const s of skipped) {
    const ext = extOf(s.path);
    skippedByExt[ext] = (skippedByExt[ext] ?? 0) + 1;
  }

  // 後処理（一覧の再読込など）が失敗しても、入ったものは入っているので結果は返す
  if (deps.afterRun) {
    try {
      await deps.afterRun();
    } catch (err) {
      console.warn("[intake] 取り込み後の処理に失敗:", err);
    }
  }

  return {
    notes: markdownResult.created,
    notesExisting: markdownResult.existing,
    materials: materialsUploaded,
    materialsExisting,
    linksResolved: markdownResult.linksResolved,
    linksUnresolved: markdownResult.linksUnresolved,
    failed,
    skipped: skipped.length,
    skippedByExt,
    lastNewId: markdownResult.lastNewId,
    folders: foldersSeen.size,
  };
}
