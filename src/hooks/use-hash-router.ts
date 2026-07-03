// URL ハッシュベースのルーティング
// ブラウザの戻る/進むボタンに対応し、画面状態を URL に反映する

import { useCallback, useEffect, useRef, useState } from "react";
import type { WikiKind } from "../lib/document-types";
import type { MediaType } from "../features/asset-browser";

// ─── ルート定義 ───

export type AppRoute =
  | { view: "editor"; fileId: string }
  | { view: "notes" }
  | { view: "wiki-list"; kind: WikiKind }
  | { view: "wiki-editor"; kind: WikiKind; wikiId: string }
  | { view: "wiki-log" }
  | { view: "wiki-lint" }
  | { view: "assets"; mediaType: MediaType }
  | { view: "labels"; label: string }
  | { view: "memos" }
  | { view: "shared-library" }
  | { view: "home" }; // デフォルト（何も開いていない状態）

// ─── ハッシュ ↔ ルート変換 ───

function routeToHash(route: AppRoute): string {
  switch (route.view) {
    case "editor": return `#note/${route.fileId}`;
    case "notes": return "#notes";
    case "wiki-list": return `#knowledge/${route.kind}`;
    case "wiki-editor": return `#knowledge/${route.kind}/${route.wikiId}`;
    case "wiki-log": return "#knowledge-log";
    case "wiki-lint": return "#knowledge-lint";
    case "assets": return `#assets/${route.mediaType}`;
    case "labels": return `#labels/${encodeURIComponent(route.label)}`;
    case "memos": return "#memos";
    case "shared-library": return "#shared-library";
    case "home": return "";
  }
}

function parseHash(hash: string): AppRoute {
  // "#" を除去
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { view: "home" };

  const parts = raw.split("/");

  switch (parts[0]) {
    case "note":
      if (parts[1]) return { view: "editor", fileId: decodeURIComponent(parts.slice(1).join("/")) };
      break;
    case "notes":
      return { view: "notes" };
    // 新ルート (#knowledge/...) と旧ルート (#wiki/...) を同じ意味として解決。
    // 旧ブックマーク互換のため "wiki" もここで受ける（writes は常に #knowledge/...）。
    case "knowledge":
    case "wiki":
      if (parts.length >= 3) {
        const kind = parts[1] as WikiKind;
        const wikiId = decodeURIComponent(parts.slice(2).join("/"));
        return { view: "wiki-editor", kind, wikiId };
      }
      if (parts[1]) {
        return { view: "wiki-list", kind: parts[1] as WikiKind };
      }
      break;
    case "knowledge-log":
    case "wiki-log":
      return { view: "wiki-log" };
    case "knowledge-lint":
    case "wiki-lint":
      return { view: "wiki-lint" };
    case "assets":
      if (parts[1]) return { view: "assets", mediaType: parts[1] as MediaType };
      break;
    case "labels":
      if (parts[1]) return { view: "labels", label: decodeURIComponent(parts[1]) };
      break;
    case "memos":
      return { view: "memos" };
    case "shared-library":
      return { view: "shared-library" };
  }
  return { view: "home" };
}

// ─── ルートディスパッチ（アプリ状態への反映） ───

export type RouteActions = {
  openFile: (fileId: string) => void;
  openWikiFile: (wikiId: string) => void;
  setShowNoteList: (show: boolean) => void;
  setActiveWikiKind: (kind: WikiKind | null) => void;
  setActiveWikiView: (view: "log" | "lint" | null) => void;
  setActiveAssetType: (type: MediaType | null) => void;
  setActiveLabel: (label: string | null) => void;
  setShowMemos: (show: boolean) => void;
  setShowSharedLibrary?: (show: boolean) => void;
  clearViews: () => void;
};

// ─── Hook ───

export function useHashRouter(actions: RouteActions, ready: boolean = true) {
  // 内部フラグ: プログラムからの遷移中は popstate を無視する
  const suppressRef = useRef(false);
  // 初回マウント時の URL 反映を一度だけ行うためのフラグ
  const initialAppliedRef = useRef(false);
  // ─── アプリ内「戻る」用のシーケンス追跡 ───
  // ブラウザ履歴は「今スタックに何段あるか」を問い合わせられないため、
  // navigate のたびに単調増加する連番を history.state に載せて現在深度を持つ。
  // popstate 時に landing entry の連番を読めば、戻る余地があるか（seq > 0）が分かる。
  // これで（可視のブラウザ戻るボタンが無い）デスクトップアプリでも、ネイティブの
  // history.back() を叩くヘッダーの戻るボタンを正しく出し分けできる。
  const seqRef = useRef(0);
  const [canGoBack, setCanGoBack] = useState(false);

  // ルートをアプリ状態に反映
  const applyRoute = useCallback((route: AppRoute) => {
    switch (route.view) {
      case "editor":
        // 本文へ戻るときは上位のオーバーレイ／リストビューを畳んでから開く。
        // これを忘れると、スキル一覧などを開いた状態で戻ると本文でなくその一覧が
        // 残り続ける（note-app 側の巨大な ternary で本文より優先表示されるため）。
        actions.clearViews();
        if (route.fileId.startsWith("wiki:")) {
          actions.openWikiFile(route.fileId.replace(/^wiki:/, ""));
        } else {
          actions.openFile(route.fileId);
        }
        break;
      case "notes":
        actions.clearViews();
        actions.setShowNoteList(true);
        break;
      case "wiki-list":
        actions.clearViews();
        actions.setActiveWikiKind(route.kind);
        break;
      case "wiki-editor":
        actions.clearViews();
        actions.openWikiFile(route.wikiId);
        break;
      case "wiki-log":
        actions.clearViews();
        actions.setActiveWikiView("log");
        break;
      case "wiki-lint":
        actions.clearViews();
        actions.setActiveWikiView("lint");
        break;
      case "assets":
        actions.clearViews();
        actions.setActiveAssetType(route.mediaType);
        break;
      case "labels":
        actions.clearViews();
        actions.setActiveLabel(route.label);
        break;
      case "memos":
        actions.clearViews();
        actions.setShowMemos(true);
        break;
      case "shared-library":
        actions.clearViews();
        actions.setShowSharedLibrary?.(true);
        break;
      case "home":
        actions.clearViews();
        break;
    }
  }, [actions]);

  // URL をプッシュ（ブラウザ履歴に追加）
  const navigate = useCallback((route: AppRoute) => {
    const hash = routeToHash(route);
    const url = hash || window.location.pathname + window.location.search;
    suppressRef.current = true;
    // 同じ URL への再遷移は履歴を積まない（replaceState）。同一ノートを開き直したときに
    // 「戻る」で自分自身へ戻る無限ループのような無駄な履歴段を作らないため。
    if (hash && hash === window.location.hash) {
      window.history.replaceState({ __seq: seqRef.current }, "", url);
    } else {
      seqRef.current += 1;
      window.history.pushState({ __seq: seqRef.current }, "", url);
      setCanGoBack(seqRef.current > 0);
    }
    // pushState 後すぐに suppress を解除
    requestAnimationFrame(() => { suppressRef.current = false; });
  }, []);

  // アプリ内ヘッダーの「戻る」ボタン用。ネイティブの履歴を 1 段戻す。
  // 実際の画面復元は下の popstate ハンドラ（applyRoute）が担う。
  const back = useCallback(() => {
    if (seqRef.current <= 0) return;
    window.history.back();
  }, []);

  // 戻る/進むボタン対応
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      // 着地したエントリの連番で現在深度を更新（戻る余地の有無を出し分けるため）。
      const landedSeq =
        e.state && typeof (e.state as { __seq?: unknown }).__seq === "number"
          ? (e.state as { __seq: number }).__seq
          : 0;
      seqRef.current = landedSeq;
      setCanGoBack(landedSeq > 0);
      if (suppressRef.current) return;
      const route = parseHash(window.location.hash);
      applyRoute(route);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [applyRoute]);

  // 初回マウント時に URL ハッシュからルートを復元する
  // ファイル一覧の読み込み完了（ready=true）を待ってから適用しないと、
  // openFile が「ファイル不在」と判定して何も起きないため。
  useEffect(() => {
    if (!ready || initialAppliedRef.current) return;
    initialAppliedRef.current = true;
    const route = parseHash(window.location.hash);
    if (route.view !== "home") {
      applyRoute(route);
    }
  }, [ready, applyRoute]);

  return { navigate, back, canGoBack, parseHash: () => parseHash(window.location.hash) };
}
