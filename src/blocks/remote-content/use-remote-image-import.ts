// 本文に入ったばかりの画像を、その場でローカルメディアへ取り込む hook。
//
// 自分で貼った・自分で書かせた画像まで「外部画像を読み込む」を押させるのは筋が悪い。
// 挿入の瞬間に一度だけ取り込んでローカル URL に差し替えれば、以後そのノートは
// 外部を参照しないので、バーもプレースホルダも出ない。
//
// エディタの変更ハンドラ 1 箇所に挿すことで、貼り付け・ドロップ・Markdown 取り込み・
// AI の回答挿入・FilePanel の Embed タブを一度に覆う（挿入経路ごとに書くと必ず漏れる）。
//
// 扱う入力は 2 種類あり、理由も落ち方も別:
//
//   外部ホストの URL … 取り込みは sidecar の image-proxy 経由（remote-image.ts）。
//     失敗したら URL はそのまま残し、リモート URL のまま描画へ回すことはしない ——
//     ゲートがブロックしたままになるのが正しい落ち方で、ここでフォールバックすると
//     取り込みの意味が消える。失敗したことはトーストで伝える（黙って枠のままだと
//     壊れて見える）。取り込み中はゲートの件数から外す。
//
//   `data:image/…` … 中身は既に手元にあるので要求は出ない＝同意の対象ではない。
//     ゲートにもトーストにも出さず、ネットワークにも出ずに File へ組み直して保存する。
//     取り込む理由は保存の都合で、base64 のまま置くとノート JSON がその画像ぶん
//     丸ごと膨らむため。失敗したら data URL のまま残す（そのまま表示できる）。
//
// video / audio は対象外。image-proxy は画像しか返さないので、取り込みようがない。
// それらは外部 URL のままブロックされ、ユーザーが読み込みを選べる状態で残る。
//
// ここが動くのは「ノートを開いている間に入ったブロック」だけ。開いた時点で本文に
// あった画像には触らない —— 開いただけで配信元へ要求が出る、というまさに止めたい
// 挙動になるため。既存ノートの外部画像はゲートのバーから明示的に読み込む。

import { useCallback, useEffect, useRef, useState } from "react";
import { isLocalMediaRef } from "../../features/asset-browser/local-media-ref";
import {
  saveDataImageAsMedia,
  saveRemoteImageAsMedia,
} from "../../features/asset-browser/remote-image";
import { clearRemoteImportPending, markRemoteImportPending } from "./store";

type ImportTarget = {
  id: string;
  url: string;
  scope: string;
  /**
   * remote … 外部ホストの URL。ゲートの「取り込み中」に数え、結果をトーストに出す。
   * data … `data:image/…`。要求を出さないので、ゲートにもトーストにも関わらせない。
   */
  kind: "remote" | "data";
};

/** 取り込みの進行を出すトーストの状態（media-ocr の OcrToast と同じ形）。 */
export type RemoteImportToastState = {
  /** 取り込み中の枚数（0 なら完了表示） */
  running: number;
  /** 完了時: ローカルに取り込めた枚数 */
  imported: number;
  /** 完了時: 取り込めずブロックのまま残した枚数 */
  failed: number;
} | null;

/** 取り込み中の目印のキー。ブロック id はノートをまたぐと衝突し得るので scope と組にする。 */
function pendingKey(target: ImportTarget): string {
  return `${target.scope}\0${target.id}`;
}

/**
 * 画像の実体が本文に直接埋まっている形か。isLocalMediaRef はこれを「手元にある実体」と
 * して通す —— 判定としてはそれで正しい（要求は出ない）ので、取り込む理由が別の枠として
 * 先に見る。
 */
function isDataImageUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith("data:image/");
}

/**
 * ブロックツリーから取り込み対象の画像ブロックを再帰的に集める。
 * children も辿るのは、カラムやリストの中に入った画像も同じ 1 回の挿入で入るため。
 */
function collectImportTargets(blocks: unknown[], scope: string, out: ImportTarget[] = []): ImportTarget[] {
  for (const raw of blocks ?? []) {
    const b = raw as { id?: string; type?: string; props?: { url?: unknown }; children?: unknown[] };
    if (b?.type === "image" && typeof b.id === "string") {
      const url = typeof b.props?.url === "string" ? b.props.url : "";
      if (isDataImageUrl(url)) out.push({ id: b.id, url, scope, kind: "data" });
      else if (url && !isLocalMediaRef(url)) out.push({ id: b.id, url, scope, kind: "remote" });
    }
    if (b?.children?.length) collectImportTargets(b.children, scope, out);
  }
  return out;
}

export function useRemoteImageImport({
  editorRef,
  scope,
  uploadFile,
}: {
  /**
   * 走査と書き戻しの相手。**いま画面にあるインスタンスを指していること**。
   *
   * 呼び出し側でエディタだけが作り直され得るなら（note-app.tsx の
   * key={fileId || "new"}）、SandboxEditor の liveEditorRef prop に渡した ref を
   * そのまま使うこと。onEditorReady で埋める ref は passive effect 待ちなので、
   * 作り直しのコミット直後の一瞬だけ捨てられた前のインスタンスを指し、
   * そこへ書いた取り込みは誰にも見えないまま消える。
   * SidePeek のようにエディタと hook が同じ key で一緒に作り直される側は、
   * その隙が生じないので onEditorReady 由来の ref のままでよい。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorRef: React.RefObject<any>;
  /**
   * このエディタ 1 回分のゲート scope（useRemoteContentScope が作る）。
   * SandboxEditor の remoteContentScope・RemoteContentBar と同じ値を渡すこと。
   * ずれると取り込み中のブロックがバーの件数から外れない。
   *
   * ノートの識別子ではないので、開いているノートが保存されて ID が付いても変わらない。
   * 保存で値が変われば、その途中だった取り込みは行き先を失う。
   */
  scope: string;
  uploadFile?: (file: File) => Promise<string>;
}) {
  const knownRef = useRef<Set<string> | null>(null);
  const scopeRef = useRef(scope);
  const queueRef = useRef<ImportTarget[]>([]);
  /** ゲートへ「取り込み中」を立てたブロック。必ずここから外して立て札を下ろす。 */
  const pendingRef = useRef<Map<string, ImportTarget>>(new Map());
  const drainingRef = useRef(false);
  /** この hook が生きているか。閉じた後のエディタには書き戻さない。 */
  const mountedRef = useRef(true);
  const [toast, setToast] = useState<RemoteImportToastState>(null);

  // scope が変わったら既知集合を捨てる。持ち越すと、次の本文の既存画像を「今貼られた」
  // と誤認して取り込みに行き、まさに止めたい要求を出してしまう。
  // 通常はここは通らない —— 別のノートを開くとエディタごと作り直されて、この hook も
  // 新しく始まるため（scope は開いている間ずっと同じ値）。
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    knownRef.current = null;
  }

  // 閉じるときの後始末。取り込みの途中でノートを閉じると立て札が残り、同じノートを
  // 開き直したとき（ブロック id は同じ）そのブロックがバーの件数から外れたままになる。
  useEffect(() => {
    mountedRef.current = true;
    const pending = pendingRef.current;
    return () => {
      mountedRef.current = false;
      for (const target of pending.values()) clearRemoteImportPending(target.scope, target.id);
      pending.clear();
    };
  }, []);

  /** 取り込めたローカル URL をブロックへ書き戻す。書ける状態でなければ何もしない。 */
  const applyImported = useCallback(
    (target: ImportTarget, local: { url: string; name: string }) => {
      // ノートを閉じた後は書き戻さない。別のノートを開くとこの hook ごと作り直される。
      if (!mountedRef.current) return false;

      // 書き戻し先は「取り込みを始めたときのインスタンス」ではなく「いま画面にある
      // インスタンス」。取り込みの最中にエディタだけが作り直されることがあるため
      // （未採番のノートに自動保存で id が付くと note-app の key={fileId || "new"} が
      // 変わる）。作り直された側は、保存された本文から組み直されるので同じ block id が
      // 同じ外部 URL のまま入っている＝この書き戻しの行き先として正しい。
      //
      // 前のインスタンスは捨てられても getBlock / updateBlock は成功してしまうので、
      // 「まだ画面にあるか」を hook の生死だけで判定すると、誰も見ていない document へ
      // 書いて取り込みが消え、本文にはトラッカー URL が残ったまま保存される。
      // 行き先が正しいことは editorRef の中身が保証する（上のドキュメント参照）。
      const editor = editorRef.current;
      // 画面にエディタが無い（閉じた直後など）なら書き戻さない。呼び出し元が失敗として
      // 数え、ブロックは外部 URL のままゲートに止められる（リモート URL では描かない）。
      if (!editor) return false;
      const block = editor.getBlock?.(target.id);
      // 取り込み中に消された・別の URL に差し替えられたブロックも触らない。
      // 作り直し後のインスタンスに対しても同じ照合が効くので、別の本文へ紛れ込むことはない。
      if (!block || block.props?.url !== target.url) return false;
      editor.updateBlock(target.id, {
        props: { url: local.url, name: block.props?.name || local.name },
      });
      return true;
    },
    [editorRef],
  );

  /**
   * 待ち行列を順に処理する。
   *
   * 同じ URL は 1 回だけ取りに行き、結果を同 URL の全ブロックへ配る（Markdown に
   * 同じ画像が 2 回出てくる形が普通にあるため）。まとめるのはこの待ち行列の中だけで、
   * 別の貼り付けで同じ画像を入れれば素材はもう 1 件できる —— 同じファイルを 2 回
   * アップロードしたときと同じ結果で、URL を素材に覚えさせない（＝永続データに
   * 外部 URL を書かない）ほうを取る。
   */
  const drain = useCallback(
    async (upload: (file: File) => Promise<string>) => {
      if (drainingRef.current) return;
      drainingRef.current = true;
      let imported = 0;
      let failed = 0;
      const release = (target: ImportTarget) => {
        pendingRef.current.delete(pendingKey(target));
        clearRemoteImportPending(target.scope, target.id);
      };
      try {
        while (queueRef.current.length > 0) {
          const batch = queueRef.current;
          queueRef.current = [];
          const byUrl = new Map<string, ImportTarget[]>();
          for (const target of batch) {
            const same = byUrl.get(target.url);
            if (same) same.push(target);
            else byUrl.set(target.url, [target]);
          }
          for (const [url, targets] of byUrl) {
            setToast({ running: pendingRef.current.size, imported, failed });
            // 同じ URL のブロックは同じ種別（url の形だけで決まる）なので先頭で判る
            const local =
              targets[0].kind === "data"
                ? await saveDataImageAsMedia(url, upload)
                : await saveRemoteImageAsMedia(url, upload);
            for (const target of targets) {
              let ok = false;
              try {
                ok = !!local && applyImported(target, local);
              } catch {
                ok = false; // 書き戻せなくても、外部 URL のまま描かせるよりブロックのまま
              }
              // data URL はゲートにもトーストにも出していないので、下ろす立て札も
              // 伝えることも無い。取り込めなくても本文の data URL がそのまま描かれる。
              if (target.kind !== "remote") continue;
              if (ok) imported += 1;
              else failed += 1;
              release(target);
            }
          }
        }
      } finally {
        drainingRef.current = false;
        // 途中で抜けた場合の後始末。立て札を残すとバーの件数が減ったままになる
        for (const target of pendingRef.current.values()) release(target);
        setToast({ running: 0, imported, failed });
      }
    },
    [applyImported],
  );

  /** エディタの変更ごとに呼ぶ。新しく入った画像があれば取り込みを始める。 */
  const scan = useCallback(() => {
    const editor = editorRef.current;
    if (!editor?.document || !uploadFile) return;

    const targets = collectImportTargets(editor.document, scope);
    if (knownRef.current === null) {
      // ノートを開いた直後。既にあった画像は「今入った」ではないので触らない。
      // ここで取り込みに走ると、開いただけで配信元へ要求が出る＝この機能の逆になる。
      knownRef.current = new Set(targets.map((i) => i.id));
      return;
    }

    const known = knownRef.current;
    const fresh = targets.filter((i) => !known.has(i.id));
    // 一度見たブロックは（取り込みに失敗しても）二度と拾わない。変更のたびに
    // 走るハンドラなので、失敗を再試行すると打鍵ごとに要求を出すことになる。
    for (const i of targets) known.add(i.id);
    if (fresh.length === 0) return;

    for (const target of fresh) {
      // 取り込み中はゲートの件数から外す（自分で貼った画像でバーを点滅させない）。
      // data URL はそもそもゲートに数えられていないので、立て札も要らない。
      if (target.kind === "remote") {
        pendingRef.current.set(pendingKey(target), target);
        markRemoteImportPending(target.scope, target.id);
      }
      queueRef.current.push(target);
    }
    void drain(uploadFile);
  }, [editorRef, scope, uploadFile, drain]);

  return { scan, toast };
}
