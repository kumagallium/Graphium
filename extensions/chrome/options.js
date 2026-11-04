// 設定画面
import { parsePairingCode } from "./lib.js";

const $ = (id) => document.getElementById(id);
const msg = (k, subs) => chrome.i18n.getMessage(k, subs) || k;
const DEFAULT_PORT = 3001;
const PAIR_POLL_MS = 1000;
const PAIR_TIMEOUT_MS = 2 * 60 * 1000;

function setStatus(el, text, ok) {
  el.textContent = text;
  el.className = ok === undefined ? "" : ok ? "ok" : "err";
}

async function refreshQueue() {
  const s = await chrome.storage.local.get("clipQueue");
  const n = Array.isArray(s.clipQueue) ? s.clipQueue.length : 0;
  $("queueCount").textContent = msg("optQueue", [String(n)]);
  $("sendNow").disabled = n === 0;
}

/** @returns {"ok"|"unauthorized"|"unreachable"} */
async function ping(cfg) {
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/api/clip/ping`, {
      headers: { "X-Graphium-Clip-Token": cfg.token },
    });
    if (res.status === 200) return "ok";
    if (res.status === 401) return "unauthorized";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

/** 上の「いまの状態」の行 */
async function refreshConnState() {
  const s = await chrome.storage.local.get("pairingCode");
  const cfg = parsePairingCode(s.pairingCode);
  if (!cfg) return setStatus($("connState"), msg("optNotConnected"));
  const r = await ping(cfg);
  if (r === "ok") setStatus($("connState"), msg("optConnected"), true);
  else if (r === "unauthorized") setStatus($("connState"), msg("optUnauthorized"), false);
  else setStatus($("connState"), msg("optUnreachable"), false);
}

function currentPort() {
  const n = Number($("port").value.trim());
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 承認するペアリング: 申し込む → Graphium で許可 → コードを受け取る ──
async function connect() {
  const port = currentPort();
  if (!port) return setStatus($("pairStatus"), msg("optInvalidPort"), false);
  $("connect").disabled = true;
  $("pairNumber").hidden = true;
  try {
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${port}/api/clip/pair`, { method: "POST" });
    } catch {
      return setStatus($("pairStatus"), msg("optUnreachable"), false);
    }
    if (res.status !== 201) {
      return setStatus($("pairStatus"), msg(res.status === 404 ? "optPairUnsupported" : "optUnreachable"), false);
    }
    const { id, number } = await res.json();
    $("pairNumber").textContent = number;
    $("pairNumber").hidden = false;
    setStatus($("pairStatus"), msg("optPairWaiting"));

    const until = Date.now() + PAIR_TIMEOUT_MS;
    while (Date.now() < until) {
      await sleep(PAIR_POLL_MS);
      let r;
      try {
        r = await fetch(`http://127.0.0.1:${port}/api/clip/pair/${encodeURIComponent(id)}`, { method: "POST" });
      } catch {
        return setStatus($("pairStatus"), msg("optUnreachable"), false);
      }
      const body = await r.json().catch(() => ({}));
      if (body.status === "pending") continue;
      $("pairNumber").hidden = true;
      if (body.status === "approved" && parsePairingCode(body.code)) {
        await chrome.storage.local.set({ pairingCode: body.code });
        $("code").value = body.code;
        setStatus($("pairStatus"), msg("optPairApproved"), true);
        await refreshConnState();
        await sendNow();
        return;
      }
      if (body.status === "denied") return setStatus($("pairStatus"), msg("optPairDenied"), false);
      break; // 切れた・見つからない
    }
    $("pairNumber").hidden = true;
    setStatus($("pairStatus"), msg("optPairExpired"), false);
  } finally {
    $("connect").disabled = false;
  }
}

// ── コードを貼ってつなぐ（予備の方法） ──
async function test() {
  const cfg = parsePairingCode($("code").value);
  if (!cfg) return setStatus($("status"), msg("optInvalid"), false);
  const r = await ping(cfg);
  if (r === "ok") setStatus($("status"), msg("optConnected"), true);
  else if (r === "unauthorized") setStatus($("status"), msg("optUnauthorized"), false);
  else setStatus($("status"), msg("optUnreachable"), false);
}

async function save() {
  const code = $("code").value.trim();
  const cfg = parsePairingCode(code);
  if (!cfg) return setStatus($("status"), msg("optInvalid"), false);
  await chrome.storage.local.set({ pairingCode: code });
  $("port").value = String(cfg.port);
  setStatus($("status"), msg("optSaved"), true);
  await refreshConnState();
  sendNow();
}

async function sendNow() {
  const r = await chrome.runtime.sendMessage({ type: "flush" });
  if (r?.sent > 0) setStatus($("queueStatus"), msg("optSent", [String(r.sent)]), true);
  else if (r?.status === "unauthorized") setStatus($("queueStatus"), msg("optUnauthorized"), false);
  else if (r?.status && r.status !== "ok") setStatus($("queueStatus"), msg("optUnreachable"), false);
  await refreshQueue();
}

async function init() {
  document.title = msg("optTitle");
  for (const [id, key] of [
    ["title", "optTitle"],
    ["connectHelp", "optConnectHelp"],
    ["connect", "optConnect"],
    ["advancedLabel", "optAdvanced"],
    ["portLabel", "optPortLabel"],
    ["portHelp", "optPortHelp"],
    ["codeLabel", "optCodeLabel"],
    ["help", "optHelp"],
    ["save", "optSave"],
    ["test", "optTest"],
    ["sendNow", "optSendNow"],
  ]) {
    $(id).textContent = msg(key);
  }
  const s = await chrome.storage.local.get("pairingCode");
  const cfg = parsePairingCode(s.pairingCode);
  if (s.pairingCode) $("code").value = s.pairingCode;
  $("port").value = String(cfg?.port ?? DEFAULT_PORT);
  $("connect").addEventListener("click", connect);
  $("save").addEventListener("click", save);
  $("test").addEventListener("click", test);
  $("sendNow").addEventListener("click", sendNow);
  await refreshQueue();
  await refreshConnState();
  // 設定画面を開いたときに再送を試みる（コードがあるときだけ）
  if (cfg) sendNow();
}
init();
