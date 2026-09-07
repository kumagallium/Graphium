// 共有されたテンプレート（PageTemplate JSON）を「擬似 GraphiumDocument」に包む純関数。
//
// なぜ必要か:
//   テンプレートの本文は GraphiumDocument ではなく PageTemplate JSON。
//   ところが「読み取り専用プレビュー（SharedEntryBody）」も「AI に渡す Markdown
//   （shared-chat）」も、入口が GraphiumDocument に揃っている。包むだけで足りるのは、
//   どちらも読むのが pages[].blocks（と表の注釈）だけだから。
//
//   包む処理を 2 か所に書くと、片方だけ tableMeta を落とす等のズレが出て
//   「プレビューには表の名前が出るのに AI には渡っていない」が起きる。ここ 1 か所に置く。
//
// React にも I/O にも依存しない（テストしやすさのため）。

import type { GraphiumDocument } from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
// 直接 save.ts から取る（features/template の index はピッカーのモーダルまで引き込むため）
import { deserializeTemplate } from "../template/save";
import type { PageTemplate } from "../template/types";

/**
 * PageTemplate を表示・変換用の擬似 GraphiumDocument に包む。
 *
 * 日時はテンプレートの保存時刻で埋める（読み手は使わないが
 * GraphiumDocument の必須フィールドなので空にできない）。
 */
export function templateToPseudoDocument(template: PageTemplate): GraphiumDocument {
  return {
    version: LATEST_DOCUMENT_VERSION,
    title: template.name,
    createdAt: template.savedAt,
    modifiedAt: template.savedAt,
    pages: [
      {
        id: "main",
        title: template.pageTitle || template.name,
        blocks: template.blocks,
        labels: Object.fromEntries(template.labels ?? []),
        provLinks: [],
        knowledgeLinks: [],
        ...(template.tableMeta ? { tableMeta: template.tableMeta } : {}),
        ...(template.mediaInlineLabels
          ? { mediaInlineLabels: template.mediaInlineLabels }
          : {}),
      },
    ],
  };
}

/**
 * 共有エントリの本文（テンプレート JSON 文字列）を擬似 GraphiumDocument に読む。
 * PageTemplate として読めない本文は null（呼び出し側は raw 表示などにフォールバックする）。
 */
export function parseSharedTemplateBody(body: string): GraphiumDocument | null {
  try {
    const template = deserializeTemplate(body);
    if (!Array.isArray(template?.blocks)) return null;
    return templateToPseudoDocument(template);
  } catch {
    return null;
  }
}
