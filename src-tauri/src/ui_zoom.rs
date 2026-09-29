// UI の拡大縮小（WebView 本来のページズーム）
//
// 以前は View メニューが `document.body.style.zoom` を書き換えていた。CSS の zoom は
// 中身だけを縮めるので、画面の広さ（innerWidth / innerHeight）や、本文に重ねて出す部品
// （表のラベル・データ表バーなど）の位置計算が元の倍率のまま残り、ずれや空白が出た。
// `WebviewWindow::set_zoom` はブラウザの Ctrl + ± と同じ種類の機構で、CSS px の
// viewport ごと変わる。
//
// 倍率は Rust が一元管理する（段の表・現在値・記憶・二重発火の防止）。
// `tauri.conf.json` の `zoomHotkeysEnabled` は使わない: macOS / Linux では JS の
// polyfill が別の変数で倍率を持ち、Windows では WebView2 の既定動作が動いて、こちらの
// 倍率と食い違うため。フロント（src/lib/ui-zoom.ts）はキー・ホイールを拾って
// `step_ui_zoom` を呼び、結果を `ui-zoom-changed` で受け取るだけにする。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// 倍率の段。上限を 1.5 にしているのは、既定のウィンドウ幅 1200 で 1.5 倍にすると
/// CSS 幅が 800 になり、これ以上だと 768 を割ってモバイルのレイアウトに落ちるため。
/// TS 側には同じ表を持たず、`get_ui_zoom` で受け取る。
pub const ZOOM_LEVELS: [f64; 9] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];

/// 倍率の初期値（記憶が無い・壊れているとき）
const DEFAULT_LEVEL: f64 = 1.0;

/// `app_config_dir()` の下に置く記憶ファイル名
const ZOOM_FILE_NAME: &str = "ui-zoom.json";

/// 変わったことをフロントに知らせるイベント名（payload は `{ level, source }`）
const ZOOM_CHANGED_EVENT: &str = "ui-zoom-changed";

/// メニューのアクセラレータとフロントの keydown が同じキー押下で両方届く環境があり得る
/// （Windows で WebView2 にフォーカスがあるときの経路が未確認）。この時間内に、
/// 別の source から同じ向きの変更が来たら二重発火とみなして捨てる。
const DUPLICATE_WINDOW: Duration = Duration::from_millis(150);

/// 直前に受け付けた段の変更（二重発火の判定に使う）
#[derive(Debug, Clone)]
pub struct LastChange {
    at: Instant,
    source: String,
    /// +1 拡大 / -1 縮小 / 0 元に戻す
    direction: i32,
}

#[derive(Debug)]
pub struct ZoomInner {
    level: f64,
    last: Option<LastChange>,
}

impl Default for ZoomInner {
    fn default() -> Self {
        Self {
            level: DEFAULT_LEVEL,
            last: None,
        }
    }
}

/// 現在の倍率。WebView 側に現在値を読む API が無いので、こちらで持つ。
#[derive(Default)]
pub struct ZoomState(Mutex<ZoomInner>);

impl ZoomState {
    fn lock(&self) -> std::sync::MutexGuard<'_, ZoomInner> {
        // 他スレッドが panic しても倍率の値自体は壊れないので、毒化は無視する
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// --- 純粋な関数（テスト対象） ---

/// 段の表で最も近い添字。NaN・無限大は 1.0 の段に倒す。
fn nearest_index(raw: f64) -> usize {
    let raw = if raw.is_finite() { raw } else { DEFAULT_LEVEL };
    let mut best = 0;
    let mut best_diff = f64::INFINITY;
    for (i, level) in ZOOM_LEVELS.iter().enumerate() {
        let diff = (level - raw).abs();
        if diff < best_diff {
            best = i;
            best_diff = diff;
        }
    }
    best
}

/// 段の表で最も近い値に丸める
pub fn snap_level(raw: f64) -> f64 {
    ZOOM_LEVELS[nearest_index(raw)]
}

/// 1 段動かした先。`direction` が 0 なら 1.0 に戻す。端では動かない（同じ値を返す）。
pub fn next_level(current: f64, direction: i32) -> f64 {
    if direction == 0 {
        return DEFAULT_LEVEL;
    }
    let index = nearest_index(current);
    let next = if direction > 0 {
        (index + 1).min(ZOOM_LEVELS.len() - 1)
    } else {
        index.saturating_sub(1)
    };
    ZOOM_LEVELS[next]
}

/// 直前の変更から見て、これが二重発火かどうか。
/// 「150ms 以内・source が違う・向きが同じ」だけを捨てる。同じ source の連続
/// （キー長押しのリピート）は受け付ける。
pub fn is_duplicate_step(
    last: Option<&LastChange>,
    now: Instant,
    source: &str,
    direction: i32,
) -> bool {
    match last {
        Some(prev) => {
            now.saturating_duration_since(prev.at) <= DUPLICATE_WINDOW
                && prev.source != source
                && prev.direction == direction
        }
        None => false,
    }
}

/// `{"level": 0.9}` を読んで段に丸める。壊れていたら 1.0。
pub fn parse_saved_level(content: &str) -> f64 {
    #[derive(Deserialize)]
    struct Saved {
        level: f64,
    }
    match serde_json::from_str::<Saved>(content) {
        Ok(saved) => snap_level(saved.level),
        Err(_) => DEFAULT_LEVEL,
    }
}

/// 変更を受け付けるかを決める。受け付けるなら新しい倍率を返す。
/// 二重発火・端・すでに同じ倍率のときは None（何もしない・イベントも出さない）。
pub fn plan_step(inner: &ZoomInner, now: Instant, direction: i32, source: &str) -> Option<f64> {
    if is_duplicate_step(inner.last.as_ref(), now, source, direction) {
        return None;
    }
    let next = next_level(inner.level, direction);
    if next == inner.level {
        return None;
    }
    Some(next)
}

// --- 記憶 ---

fn zoom_file_path() -> Result<PathBuf, String> {
    Ok(super::app_config_dir()?.join(ZOOM_FILE_NAME))
}

/// 記憶した倍率を読む。無い・壊れている・読めないときは 1.0。
fn load_saved_level() -> f64 {
    let Ok(path) = zoom_file_path() else {
        return DEFAULT_LEVEL;
    };
    match fs::read_to_string(&path) {
        Ok(content) => parse_saved_level(&content),
        Err(_) => DEFAULT_LEVEL,
    }
}

fn save_level(level: f64) -> Result<(), String> {
    let path = zoom_file_path()?;
    let content = serde_json::json!({ "level": level }).to_string();
    fs::write(&path, content).map_err(|e| format!("倍率の書き込み失敗: {e}"))
}

// --- WebView への反映 ---

fn apply_to_window(app: &tauri::AppHandle, level: f64) {
    if let Some(main) = app.get_webview_window(super::MAIN_LABEL) {
        if let Err(e) = main.set_zoom(level) {
            eprintln!("[ui-zoom] set_zoom({level}) failed: {e}");
        }
    }
}

/// setup から呼ぶ。main を見せる前に記憶した倍率を当てて、初回の描画から正しい幅にする
/// （`innerWidth < 768` の判定などが 100% の幅で誤判定しない）。
pub fn restore_at_startup(app: &tauri::AppHandle) {
    let level = load_saved_level();
    {
        let state = app.state::<ZoomState>();
        state.lock().level = level;
    }
    if level != DEFAULT_LEVEL {
        apply_to_window(app, level);
    }
}

/// `app_ready` から呼ぶ。ページの読み直しで倍率が戻る WebView があっても揃える。
pub fn reapply(app: &tauri::AppHandle) {
    let level = app.state::<ZoomState>().lock().level;
    if level != DEFAULT_LEVEL {
        apply_to_window(app, level);
    }
}

#[derive(Serialize, Clone)]
struct ZoomChangedPayload {
    level: f64,
    source: String,
}

/// 状態を更新し、WebView に当て、記憶し、フロントに知らせる。
fn commit(app: &tauri::AppHandle, level: f64, direction: i32, source: &str, now: Instant) {
    {
        let state = app.state::<ZoomState>();
        let mut inner = state.lock();
        inner.level = level;
        inner.last = Some(LastChange {
            at: now,
            source: source.to_string(),
            direction,
        });
    }
    apply_to_window(app, level);
    if let Err(e) = save_level(level) {
        // 記憶できなくても、今回の起動中の倍率は変えたままにする
        eprintln!("[ui-zoom] {e}");
    }
    if let Some(main) = app.get_webview_window(super::MAIN_LABEL) {
        let _ = main.emit(
            ZOOM_CHANGED_EVENT,
            ZoomChangedPayload {
                level,
                source: source.to_string(),
            },
        );
    }
}

/// 1 段動かす（メニュー・コマンドの共通入口）。`direction`: +1 拡大 / -1 縮小 / 0 で 1.0 に戻す。
pub fn step(app: &tauri::AppHandle, direction: i32, source: &str) {
    let direction = direction.signum();
    let now = Instant::now();
    let planned = {
        let state = app.state::<ZoomState>();
        let inner = state.lock();
        plan_step(&inner, now, direction, source)
    };
    if let Some(level) = planned {
        commit(app, level, direction, source, now);
    }
}

// --- コマンド ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiZoomInfo {
    level: f64,
    levels: Vec<f64>,
}

#[tauri::command]
pub fn get_ui_zoom(app: tauri::AppHandle) -> UiZoomInfo {
    UiZoomInfo {
        level: app.state::<ZoomState>().lock().level,
        levels: ZOOM_LEVELS.to_vec(),
    }
}

/// 倍率を直接指定する（設定画面・案内のボタン）。段に丸めて反映する。
#[tauri::command]
pub fn set_ui_zoom(app: tauri::AppHandle, level: f64, source: String) {
    let target = snap_level(level);
    let now = Instant::now();
    let current = app.state::<ZoomState>().lock().level;
    if target == current {
        return;
    }
    let direction = if target > current { 1 } else { -1 };
    commit(&app, target, direction, &source, now);
}

/// 1 段動かす。+1 拡大 / -1 縮小 / 0 で 1.0 に戻す。端では何もしない。
#[tauri::command]
pub fn step_ui_zoom(app: tauri::AppHandle, direction: i32, source: String) {
    step(&app, direction, &source);
}

// --- テスト ---

#[cfg(test)]
mod tests {
    use super::*;

    fn last(at: Instant, source: &str, direction: i32) -> LastChange {
        LastChange {
            at,
            source: source.to_string(),
            direction,
        }
    }

    #[test]
    fn snap_rounds_to_nearest_level() {
        assert_eq!(snap_level(1.0), 1.0);
        assert_eq!(snap_level(0.9), 0.9);
        // 段の間は近い方
        assert_eq!(snap_level(0.86), 0.9);
        assert_eq!(snap_level(0.6), 0.67);
        // 範囲外は端の段
        assert_eq!(snap_level(0.1), 0.5);
        assert_eq!(snap_level(9.0), 1.5);
        // 壊れた値は 1.0
        assert_eq!(snap_level(f64::NAN), 1.0);
        assert_eq!(snap_level(f64::INFINITY), 1.0);
    }

    #[test]
    fn step_moves_one_level_and_clamps_at_ends() {
        assert_eq!(next_level(1.0, 1), 1.1);
        assert_eq!(next_level(1.0, -1), 0.9);
        assert_eq!(next_level(0.67, -1), 0.5);
        assert_eq!(next_level(0.5, -1), 0.5);
        assert_eq!(next_level(1.25, 1), 1.5);
        assert_eq!(next_level(1.5, 1), 1.5);
        // 段の外の値から始めても近い段から 1 つ動く
        assert_eq!(next_level(0.86, 1), 1.0);
    }

    #[test]
    fn step_zero_resets_to_one() {
        assert_eq!(next_level(0.5, 0), 1.0);
        assert_eq!(next_level(1.5, 0), 1.0);
        assert_eq!(next_level(1.0, 0), 1.0);
    }

    #[test]
    fn duplicate_is_same_direction_different_source_within_window() {
        let t0 = Instant::now();
        let prev = last(t0, "menu", 1);
        let soon = t0 + Duration::from_millis(50);
        // 別の source・同じ向き・150ms 以内 → 二重発火
        assert!(is_duplicate_step(Some(&prev), soon, "key", 1));
        // 同じ source の連続（長押しのリピート）は受け付ける
        assert!(!is_duplicate_step(Some(&prev), soon, "menu", 1));
        // 向きが違えば受け付ける
        assert!(!is_duplicate_step(Some(&prev), soon, "key", -1));
        // 150ms を過ぎたら受け付ける
        let late = t0 + Duration::from_millis(151);
        assert!(!is_duplicate_step(Some(&prev), late, "key", 1));
        // 直前が無ければ受け付ける
        assert!(!is_duplicate_step(None, soon, "key", 1));
    }

    #[test]
    fn plan_step_ignores_duplicates_and_ends() {
        let t0 = Instant::now();
        let mut inner = ZoomInner::default();
        // 100% から拡大
        assert_eq!(plan_step(&inner, t0, 1, "menu"), Some(1.1));
        inner.level = 1.1;
        inner.last = Some(last(t0, "menu", 1));
        // 同じキー押下の 2 経路目は捨てる
        assert_eq!(plan_step(&inner, t0 + Duration::from_millis(10), 1, "key"), None);
        // 同じ source なら進む
        assert_eq!(
            plan_step(&inner, t0 + Duration::from_millis(10), 1, "menu"),
            Some(1.25)
        );
        // 端では何もしない
        inner.level = 1.5;
        inner.last = None;
        assert_eq!(plan_step(&inner, t0, 1, "key"), None);
        inner.level = 0.5;
        assert_eq!(plan_step(&inner, t0, -1, "key"), None);
        // すでに 1.0 のときのリセットは何もしない
        inner.level = 1.0;
        assert_eq!(plan_step(&inner, t0, 0, "key"), None);
    }

    #[test]
    fn saved_level_is_snapped_and_broken_falls_back() {
        assert_eq!(parse_saved_level(r#"{"level": 0.9}"#), 0.9);
        assert_eq!(parse_saved_level(r#"{"level": 0.86}"#), 0.9);
        assert_eq!(parse_saved_level(r#"{"level": 99}"#), 1.5);
        assert_eq!(parse_saved_level(""), 1.0);
        assert_eq!(parse_saved_level("not json"), 1.0);
        assert_eq!(parse_saved_level(r#"{"level": "big"}"#), 1.0);
        assert_eq!(parse_saved_level(r#"{"other": 1}"#), 1.0);
    }
}
