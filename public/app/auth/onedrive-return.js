// OneDrive の認可から戻ってきたページ（onedrive.html）の唯一の処理。
//
// URL の fragment から code / state / error / error_description を読み、
// URL から消してから、同一オリジンの BroadcastChannel（と window.opener があれば
// postMessage）で元のアプリへ渡して窓を閉じる。コードの検証（state の一致）と
// 交換は受け取る側（src/features/mobile-capture/inbox/push/onedrive-auth.ts）がする。
// チャンネル名と type はそちらの ONEDRIVE_AUTH_CHANNEL と揃えること。
// 値は console に出さない。
(function () {
  var NAME = "graphium-onedrive-auth";
  var params = new URLSearchParams(location.hash.replace(/^#/, ""));
  var msg = {
    type: NAME,
    code: params.get("code") || undefined,
    state: params.get("state") || undefined,
    error: params.get("error") || undefined,
    error_description: params.get("error_description") || undefined,
  };

  // コードを履歴・アドレスバーに残さない
  try {
    history.replaceState(null, "", location.pathname);
  } catch (e) {
    // 消せなくても渡す処理は続ける
  }

  if (!msg.code && !msg.error) {
    // 直接開かれた（戻りではない）。何も渡さない
    return;
  }

  try {
    var channel = new BroadcastChannel(NAME);
    channel.postMessage(msg);
    setTimeout(function () {
      channel.close();
    }, 500);
  } catch (e) {
    // BroadcastChannel が無い環境は opener への postMessage に任せる
  }
  try {
    if (window.opener) window.opener.postMessage(msg, location.origin);
  } catch (e) {
    // opener が使えなくても致命的にしない
  }

  var el = document.getElementById("msg");
  if (el) el.textContent = "You can close this window.";
  setTimeout(function () {
    window.close();
  }, 300);
})();
