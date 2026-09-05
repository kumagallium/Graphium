// 投入口の実行器（純関数）
//
// classify → Markdown インポート → 素材アップロードの順に処理を進める。
// UI に依存しない形にして、IntakeModal の running/done 表示や useIntake から
// 同じロジックを呼べるようにする。

import { classifyIntakeFiles } from "./classify";
import type { IntakeFile } from "./types";

/** Markdown インポート（importMarkdown 実装）が返す結果 */
export type MarkdownImportResult = {
  created: number;
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
    ctx: { allFiles: IntakeFile[] },
  ) => Promise<MarkdownImportResult>;
  /** 素材を 1 件アップロードする */
  uploadAsset: (file: File) => Promise<unknown>;
  /** 全件終了後に 1 回だけ呼ぶ（インデックス再構築など） */
  afterRun?: () => Promise<void> | void;
};

export type IntakeOutcome = {
  notes: number;
  materials: number;
  linksResolved: number;
  linksUnresolved: number;
  failed: string[];
  skipped: number;
  lastNewId: string | null;
};

/**
 * 2 回分の IntakeOutcome を 1 つに畳む。実行中に次のバッチが積まれたとき、
 * バッチごとの結果を合算して最終的な done を 1 回だけ出すために使う。
 * notes / materials / linksResolved / linksUnresolved / skipped は加算、
 * failed は連結、lastNewId は後勝ち（新しい方が null なら前を保つ）。
 */
export function mergeOutcome(a: IntakeOutcome, b: IntakeOutcome): IntakeOutcome {
  return {
    notes: a.notes + b.notes,
    materials: a.materials + b.materials,
    linksResolved: a.linksResolved + b.linksResolved,
    linksUnresolved: a.linksUnresolved + b.linksUnresolved,
    failed: [...a.failed, ...b.failed],
    skipped: a.skipped + b.skipped,
    lastNewId: b.lastNewId ?? a.lastNewId,
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

  // notes: importMarkdown 側の進捗（0..notes.length）をそのまま全体の done として流す。
  // 実装側が丸ごと throw しても（保存先が開けない等）素材の登録まで止めない。
  // その場合は notes 全件を失敗扱いにして先へ進む
  let markdownResult: MarkdownImportResult = {
    created: 0,
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
        { allFiles: files },
      );
    } catch (err) {
      console.warn("[intake] Markdown の取り込みが途中で失敗:", err);
      markdownResult = { ...markdownResult, failed: notes.map((n) => n.file.name) };
    }
  }
  failed.push(...markdownResult.failed);

  // materials: 1 件ずつアップロード。失敗しても続行する
  let materialsUploaded = 0;
  const notesDone = notes.length;
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    onProgress({ done: notesDone + i, total, current: m.file.name, failed });
    try {
      await deps.uploadAsset(m.file);
      materialsUploaded += 1;
    } catch (err) {
      console.warn(`[intake] 素材のアップロードに失敗: ${m.file.name}`, err);
      failed.push(m.file.name);
    }
  }
  onProgress({ done: total, total, failed });

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
    materials: materialsUploaded,
    linksResolved: markdownResult.linksResolved,
    linksUnresolved: markdownResult.linksUnresolved,
    failed,
    skipped: skipped.length,
    lastNewId: markdownResult.lastNewId,
  };
}
