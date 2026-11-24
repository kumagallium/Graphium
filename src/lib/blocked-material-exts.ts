// 素材として受け付けない拡張子（実行ファイル・スクリプト・ショートカットなど）。
// MCP の add_material / offer_material と、アプリの受け取り待ちの承認（material-offer）が同じ表を使う。
// React にも Node にも依存しない。

/**
 * add_material が断る拡張子。実行ファイル・スクリプト・ショートカットなど、
 * 「アプリで開く」や OS の関連付けで実行されうるもの。外の AI が仕込めないようにする
 */
export const BLOCKED_MATERIAL_EXTS: ReadonlySet<string> = new Set([
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "msp", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
  "hta", "lnk", "url", "jar", "app", "command", "terminal", "sh", "bash", "zsh", "csh", "ksh", "scpt", "workflow",
  "dll", "reg", "cpl", "gadget", "inf", "action",
  // インストーラ・ショートカット／設定ファイル・アプリ形式・OS が関連付けで起動するもの
  // （解析用の .py や、マクロ付き Office は資料としての正当な利用があるので断らない）
  "chm", "jnlp", "msc", "sct", "wsc", "xll", "wll", "ws", "bas", "tool", "run", "xbap", "ocx", "iqy", "diagcab",
  "library-ms", "settingcontent-ms",
  "xlam", "ppam", "appx", "msix", "appinstaller", "appref-ms", "application", "pkg", "dmg", "desktop", "webloc", "scf", "ps1xml",
  "psd1",
]);

/** 名前の拡張子（小文字）が断る対象なら、その拡張子。先頭がドットの名前（".bat"）は全体を拡張子とみなす */
export function blockedExtOfName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return BLOCKED_MATERIAL_EXTS.has(ext) ? ext : null;
}
