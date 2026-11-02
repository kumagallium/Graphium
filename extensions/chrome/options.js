// 設定画面
import { parsePairingCode } from "./lib.js";

const $ = (id) => document.getElementById(id);
const msg = (k, subs) => chrome.i18n.getMessage(k, subs) || k;

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

async function test() {
  const cfg = parsePairingCode($("code").value);
  if (!cfg) return setStatus($("status"), msg("optInvalid"), false);
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/api/clip/ping`, {
      headers: { "X-Graphium-Clip-Token": cfg.token },
    });
    if (res.status === 200) setStatus($("status"), msg("optConnected"), true);
    else if (res.status === 401) setStatus($("status"), msg("optUnauthorized"), false);
    else setStatus($("status"), msg("optUnreachable"), false);
  } catch {
    setStatus($("status"), msg("optUnreachable"), false);
  }
}

async function save() {
  const code = $("code").value.trim();
  if (!parsePairingCode(code)) return setStatus($("status"), msg("optInvalid"), false);
  await chrome.storage.local.set({ pairingCode: code });
  setStatus($("status"), msg("optSaved"), true);
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
  $("title").textContent = msg("optTitle");
  $("codeLabel").textContent = msg("optCodeLabel");
  $("help").textContent = msg("optHelp");
  $("save").textContent = msg("optSave");
  $("test").textContent = msg("optTest");
  $("sendNow").textContent = msg("optSendNow");
  const s = await chrome.storage.local.get("pairingCode");
  if (s.pairingCode) $("code").value = s.pairingCode;
  $("save").addEventListener("click", save);
  $("test").addEventListener("click", test);
  $("sendNow").addEventListener("click", sendNow);
  await refreshQueue();
  // 設定画面を開いたときに再送を試みる（コードがあるときだけ）
  if (s.pairingCode) sendNow();
}
init();
