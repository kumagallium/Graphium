// splash.html の文言をアプリの言語設定に合わせる。
//
// アプリ本体（src/i18n）の辞書はバンドルの中にあり、それを待っていては
// スプラッシュの意味が無いので、この 2 文だけはここに持つ。言語の解決順は
// i18n と同じく「保存された選択 → ブラウザの言語」。
(function () {
  var TEXT = {
    ja: {
      title: "Graphium を準備しています…",
      sub: "ノートはこのパソコンの中だけにあります。",
    },
    en: {
      title: "Getting Graphium ready…",
      sub: "Your notes stay on this computer.",
    },
  };

  var lang = "en";
  try {
    // src/i18n/index.tsx の STORAGE_KEY と同じキー。
    var saved = localStorage.getItem("graphium_locale");
    if (saved === "ja" || saved === "en") {
      lang = saved;
    } else if (navigator.language && navigator.language.toLowerCase().indexOf("ja") === 0) {
      lang = "ja";
    }
  } catch (e) {
    // localStorage が読めない環境（プライベートモード等）は既定の英語のまま。
  }

  document.documentElement.lang = lang;
  document.getElementById("title").textContent = TEXT[lang].title;
  document.getElementById("sub").textContent = TEXT[lang].sub;
})();
