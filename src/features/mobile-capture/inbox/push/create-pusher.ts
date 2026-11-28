// 送り先の種別から InboxPusher の実体を作る唯一の場所。
//
// フック（use-push-queue / use-push-settings）は実体のクラス名を知らずに
// ここを呼ぶ。送り先を足すときは、PusherKind・config.ts の getPushProvider の
// ホワイトリスト・この switch の 3 か所を揃える。

import { getPushProvider } from "./config";
import { GoogleDrivePusher } from "./drive-pusher";
import { OneDrivePusher } from "./onedrive-pusher";
import type { InboxPusher, PusherKind } from "./types";

/**
 * 送り先の pusher を作る。kind を省くと、保存済みの選択（未保存・不正値は
 * google-drive）に従う。
 */
export function createPusher(kind: PusherKind = getPushProvider()): InboxPusher {
  switch (kind) {
    case "google-drive":
      return new GoogleDrivePusher();
    case "onedrive":
      return new OneDrivePusher();
    default: {
      // PusherKind を足して case を書き忘れたら、ここで型エラーになる
      const unreachable: never = kind;
      throw new Error(`unknown pusher kind: ${String(unreachable)}`);
    }
  }
}
