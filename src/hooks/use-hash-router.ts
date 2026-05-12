// URL ハッシュベースのルーティング
// ブラウザの戻る/進むボタンに対応し、画面状態を URL に反映する

import { useCallback, useEffect, useRef } from "react";
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

  // ルートをアプリ状態に反映
  const applyRoute = useCallback((route: AppRoute) => {
    switch (route.view) {
      case "editor":
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
    suppressRef.current = true;
    if (hash) {
      window.history.pushState(null, "", hash);
    } else {
      // ハッシュをクリア（"#" を残さない）
      window.history.pushState(null, "", window.location.pathname + window.location.search);
    }
    // pushState 後すぐに suppress を解除
    requestAnimationFrame(() => { suppressRef.current = false; });
  }, []);

  // 戻る/進むボタン対応
  useEffect(() => {
    const handler = () => {
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

  return { navigate, parseHash: () => parseHash(window.location.hash) };
}
