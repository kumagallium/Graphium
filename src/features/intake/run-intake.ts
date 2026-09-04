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
  /** notes を Graphium ノートとして取り込む。onProgress は notes 内の進捗（done/total は notes 件数基準） */
  importMarkdown: (files: IntakeFile[], onProgress: (p: IntakeProgress) => void) => Promise<MarkdownImportResult>;
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

  // notes: importMarkdown 側の進捗（0..notes.length）をそのまま全体の done として流す
  const markdownResult = await deps.importMarkdown(notes, (p) => {
    onProgress({ done: p.done, total, current: p.current, failed: [...failed, ...p.failed] });
  });
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

  if (deps.afterRun) {
    await deps.afterRun();
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
