// Graphium Web クリップ — service worker
import { parsePairingCode, buildClipPayload, isClippableUrl, enqueue, extractDoi } from "./lib.js";

const MENU_SELECTION = "graphium-clip-selection";
const MENU_PAGE = "graphium-clip-page";
const KEY_CODE = "pairingCode";
const KEY_QUEUE = "clipQueue";
const MAX_QUEUE = 200;

const msg = (k, subs) => chrome.i18n.getMessage(k, subs) || k;

// ---- コンテキストメニュー ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SELECTION, title: msg("menuSelection"), contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU_PAGE, title: msg("menuPage"), contexts: ["page"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const kind = info.menuItemId === MENU_SELECTION ? "selection" : "page";
  clip(tab, info, kind);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "clip-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) clip(tab, null, "selection"); // 選択が空ならページ扱いになる
});

// ツールバーのアイコン → 設定画面
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ---- バッジ ----
let badgeTimer = null;
function showBadge(text, color, title, clearAfterMs) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title });
  if (badgeTimer) clearTimeout(badgeTimer);
  if (clearAfterMs) {
    badgeTimer = setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: msg("extName") });
    }, clearAfterMs);
  }
}

// ---- ページ情報の取得（押したときだけ、そのタブだけ） ----
// 注入先で実行される関数。外の変数を参照してはいけない。
function readPage() {
  const metas = [];
  for (const name of ["citation_doi", "dc.identifier", "prism.doi", "DC.identifier"]) {
    document.querySelectorAll(`meta[name="${name}" i]`).forEach((el) => {
      const v = el.getAttribute("content");
      if (!v) return;
      // dc.identifier は doi を含むものだけ
      if (name.toLowerCase() === "dc.identifier" && !/doi/i.test(v)) return;
      metas.push(v);
    });
  }
  return {
    selection: window.getSelection()?.toString() ?? "",
    title: document.title,
    url: location.href,
    metas,
  };
}

async function gather(tab, info) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    const r = res?.result;
    if (r) {
      return {
        // PDF ビューアでは注入できても、選択はビューアの中にあって空になる → メニューが渡す選択文字を使う
        selection: r.selection || info?.selectionText || "",
        title: r.title,
        url: r.url,
        doi: extractDoi(r.metas),
      };
    }
  } catch {
    // PDF ビューア・chrome:// などは注入できない → メニュー情報で代替
  }
  return {
    selection: info?.selectionText ?? "",
    title: tab.title ?? "",
    // PDF ビューアの frameUrl は chrome-extension:// になることがあるので、ページの URL を先に見る
    url: info?.pageUrl || tab.url || info?.frameUrl || "",
    doi: null,
  };
}

// ---- 送信 ----
async function getConfig() {
  const stored = await chrome.storage.local.get(KEY_CODE);
  return parsePairingCode(stored[KEY_CODE]);
}

/** @returns {"ok"|"unauthorized"|"rejected"|"unreachable"} */
async function post(cfg, payload) {
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/api/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Graphium-Clip-Token": cfg.token },
      body: JSON.stringify(payload),
    });
    if (res.status === 201) return "ok";
    if (res.status === 401) return "unauthorized";
    // 中身を断られた（URL が不正・大きすぎる）。送り直しても通らないので溜めない
    if (res.status === 400 || res.status === 413) return "rejected";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

// キューの読み書きは直列化する（競合で件数が壊れないように）
let chain = Promise.resolve();
function serialize(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

async function readQueue() {
  const s = await chrome.storage.local.get(KEY_QUEUE);
  return Array.isArray(s[KEY_QUEUE]) ? s[KEY_QUEUE] : [];
}

/** 溜まっているクリップを古い順に送る。送れた件数を返す */
export function flushQueue() {
  return serialize(async () => {
    const cfg = await getConfig();
    if (!cfg) return { sent: 0, status: "unreachable" };
    let queue = await readQueue();
    let sent = 0;
    let status = "ok";
    while (queue.length > 0) {
      status = await post(cfg, queue[0]);
      if (status === "rejected") {
        // 先頭で詰まって後ろが永遠に送れなくならないよう、断られた分は捨てる
        queue = queue.slice(1);
        continue;
      }
      if (status !== "ok") break;
      queue = queue.slice(1);
      sent++;
    }
    await chrome.storage.local.set({ [KEY_QUEUE]: queue });
    return { sent, status };
  });
}

function pushQueue(payload) {
  return serialize(async () => {
    const queue = enqueue(await readQueue(), payload, MAX_QUEUE);
    await chrome.storage.local.set({ [KEY_QUEUE]: queue });
  });
}

async function clip(tab, info, kind) {
  const page = await gather(tab, info);
  if (!isClippableUrl(page.url)) {
    showBadge("!", "#d93025", msg("titleBadUrl"), 4000);
    return;
  }
  const cfg = await getConfig();
  if (!cfg) {
    showBadge("!", "#d93025", msg("titleNotPaired"));
    chrome.runtime.openOptionsPage();
    return;
  }
  const payload = buildClipPayload({ ...page, kind, now: new Date() });
  const status = await post(cfg, payload);
  if (status === "ok") {
    showBadge("✓", "#188038", msg("titleOk"), 2000);
    flushQueue(); // つながったので溜まっていた分も送る
  } else if (status === "rejected") {
    showBadge("!", "#d93025", msg("titleRejected"), 4000);
  } else if (status === "unauthorized") {
    // 合言葉違いはキューに溜めない
    showBadge("!", "#d93025", msg("titleUnauthorized"));
    chrome.runtime.openOptionsPage();
  } else {
    await pushQueue(payload);
    showBadge("…", "#f9ab00", msg("titleQueued"), 4000);
  }
}

// 設定画面からの再送依頼
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  // 自分の拡張機能のページ（設定画面）からだけ受ける
  if (sender.id !== chrome.runtime.id) return false;
  if (m?.type === "flush") {
    flushQueue().then(sendResponse);
    return true;
  }
  return false;
});

// 起動時にも再送を試みる
chrome.runtime.onStartup.addListener(() => { flushQueue(); });
