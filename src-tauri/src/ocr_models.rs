//! 端末内の画像 OCR（PP-OCRv6 small = 検出 + 認識を ONNX Runtime で実行）とモデル管理。
//!
//! - モデル: `appdata/models/ocr/pp-ocrv6-small/{det.onnx,rec.onnx}`。PaddlePaddle 公式（Apache-2.0）の
//!   ONNX を Hugging Face のコミットを固定して取得し、SHA256 を検証する。モデルは同梱しない。
//!   文字辞書（ocr_rec_dict.txt）だけは認識モデルと対で版が決まるのでバイナリに埋め込む
//! - 推論: 検出・認識のセッションを 1 組だけ遅延ロードして保持する（embedding_models.rs と同じ作法）。
//!   前後処理は ocr_engine.rs
//! - 解放: IDLE_UNLOAD_SECS 使われなかったエンジンは置き場から外す。次の OCR で読み直す
//! - 画像は IPC の Raw body（生バイト）で受ける。JSON の数値配列や base64 にしないのでコピーが少ない
//! - 評価・設計: Crucible experiments/2026-11-18-ocr-engine-compare

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::model_download::{download_file, part_path, DownloadTarget, CANCELLED};
use crate::ocr_engine::{
    decode_image, layout_text, lock_recover, parse_dict, OcrEngine, OcrLine, OcrOptions, OCR_TIMEOUT,
};

// ---------------------------------------------------------------------------
// モデル定義
// ---------------------------------------------------------------------------
/// 設定・イベント・戻り値の engine に使う名前
pub const MODEL_NAME: &str = "pp-ocrv6-small";
/// これだけ使われなかったエンジンをメモリから降ろす（秒）。埋め込みと同じ
const IDLE_UNLOAD_SECS: u64 = crate::embedding_models::IDLE_UNLOAD_SECS;
/// 降ろす判定の間隔（秒）
const REAPER_TICK_SECS: u64 = 60;
/// `ocr_recognize` が受ける画像のバイト数の上限（64 MB）。超えたら `OCR_INPUT_TOO_LARGE`
pub const OCR_INPUT_MAX_BYTES: usize = 64 * 1024 * 1024;
/// 順番待ちの件数の上限。実行中の 1 件のほかにこれだけ待てる。超えたら `OCR_BUSY`
pub const OCR_MAX_WAITING: usize = 32;
/// 1 件の持ち時間（秒）。デコードの後から数え、過ぎたら `OCR_TIMEOUT`。
/// TS 側（ocr.ts の OCR_JOB_TIMEOUT_MS = 120 秒）より短いので、TS が諦めて次のジョブを始める前に
/// Rust 側のジョブは必ず止まっている（前のジョブと次のジョブが並走しない）
pub const OCR_DEADLINE_SECS: u64 = 90;
/// 認識用の文字辞書（モデルの版と対）
const REC_DICT: &str = include_str!("ocr_rec_dict.txt");

pub struct ModelFile {
    /// 保存するファイル名
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

/// 検出 → 認識の順（小さい検出モデルから取る）
pub const MODEL_FILES: [ModelFile; 2] = [
    ModelFile {
        name: "det.onnx",
        url: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx",
        sha256: "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e",
        bytes: 9_880_512,
    },
    ModelFile {
        name: "rec.onnx",
        url: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx",
        sha256: "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634",
        bytes: 21_159_378,
    },
];

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrModelStatus {
    pub name: &'static str,
    pub present: bool,
    pub bytes: u64,
    pub expected_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRecognizeResult {
    pub text: String,
    /// 行の信頼度の平均（0〜100 の整数）
    pub confidence: u32,
    pub engine: &'static str,
}

#[derive(Default)]
pub struct OcrState {
    /// 取得中のモデル名 → 取り消しフラグ
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// ロード済みのエンジン
    engine: Mutex<Option<Arc<OcrEngine>>>,
    /// 最後に使った時刻（降ろす判定用）
    last_used: Mutex<Option<Instant>>,
    /// 降ろすスレッドを起動済みか
    reaper_started: AtomicBool,
    /// 推論の通り道。デコードから推論までの 1 件全体を直列にする（WebView から並列に呼ばれても同時に走るのは 1 件）。
    /// 許可証はブロッキング側へ move するので、呼び出しが取り消されても処理が終わるまで次は入れない
    gate: Arc<tauri::async_runtime::Mutex<()>>,
    /// 通り道を待っている件数
    waiting: Arc<AtomicUsize>,
}

// ---------------------------------------------------------------------------
// 純関数
// ---------------------------------------------------------------------------
/// 揃っているファイルのバイト数の合計と、全ファイルが期待どおりの大きさかどうか
pub fn status_of(sizes: impl Fn(&str) -> u64) -> (u64, bool) {
    let mut bytes = 0;
    let mut present = true;
    for f in &MODEL_FILES {
        let b = sizes(f.name);
        bytes += b;
        if b != f.bytes {
            present = false;
        }
    }
    (bytes, present)
}

/// 行の信頼度（0〜1）の平均を 0〜100 の整数に丸める。行が無ければ 0
pub fn confidence_percent(lines: &[OcrLine]) -> u32 {
    if lines.is_empty() {
        return 0;
    }
    let mean = lines.iter().map(|l| l.score as f64).sum::<f64>() / lines.len() as f64;
    (mean * 100.0).round().clamp(0.0, 100.0) as u32
}

/// `idle` 以上使われていなければ true（降ろす対象）
pub fn is_idle(last: Option<Instant>, now: Instant, idle: Duration) -> bool {
    last.map(|t| now.saturating_duration_since(t) >= idle)
        .unwrap_or(false)
}

/// 順番待ちの 1 件分の席。Drop で件数を戻す（取り消されても残さない）
pub struct WaitSlot(Arc<AtomicUsize>);

impl Drop for WaitSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// 順番待ちに入る。すでに `max` 件待っていれば入れない
pub fn enter_queue(waiting: &Arc<AtomicUsize>, max: usize) -> Option<WaitSlot> {
    let prev = waiting.fetch_add(1, Ordering::SeqCst);
    let slot = WaitSlot(waiting.clone());
    if prev >= max {
        return None; // slot が Drop されて件数は戻る
    }
    Some(slot)
}

/// 本文のバイト数の検査
pub fn check_input_size(len: usize) -> Result<(), String> {
    if len > OCR_INPUT_MAX_BYTES {
        Err("OCR_INPUT_TOO_LARGE".to_string())
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// モデル管理
// ---------------------------------------------------------------------------
fn models_dir() -> Result<PathBuf, String> {
    Ok(crate::appdata_dir()?
        .join("models")
        .join("ocr")
        .join(MODEL_NAME))
}

fn model_present() -> bool {
    let Ok(dir) = models_dir() else {
        return false;
    };
    status_of(|f| std::fs::metadata(dir.join(f)).map(|m| m.len()).unwrap_or(0)).1
}

#[tauri::command]
pub fn ocr_model_status() -> Result<OcrModelStatus, String> {
    let dir = models_dir()?;
    let (bytes, present) =
        status_of(|f| std::fs::metadata(dir.join(f)).map(|m| m.len()).unwrap_or(0));
    Ok(OcrModelStatus {
        name: MODEL_NAME,
        present,
        bytes,
        expected_bytes: MODEL_FILES.iter().map(|f| f.bytes).sum(),
    })
}

/// downloads への登録を Drop で外す（panic や早期 return でも残さない）
struct DownloadGuard<'a> {
    state: &'a OcrState,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        lock_recover(&self.state.downloads).remove(MODEL_NAME);
    }
}

async fn download_model(app: &tauri::AppHandle, cancel: &AtomicBool) -> Result<(), String> {
    let dir = models_dir()?;
    let total: u64 = MODEL_FILES.iter().map(|f| f.bytes).sum();
    let mut done_bytes: u64 = 0;
    for f in &MODEL_FILES {
        let final_path = dir.join(f.name);
        if std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0) == f.bytes {
            done_bytes += f.bytes;
            continue;
        }
        let target = DownloadTarget {
            url: f.url.to_string(),
            final_path,
            sha256: f.sha256.to_string(),
            expected_bytes: f.bytes,
        };
        download_file(&target, cancel, |received, _| {
            let _ = app.emit(
                "ocr-model-progress",
                serde_json::json!({ "name": MODEL_NAME, "received": done_bytes + received, "total": total }),
            );
        })
        .await?;
        done_bytes += f.bytes;
    }
    Ok(())
}

#[tauri::command]
pub async fn ocr_model_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, OcrState>,
) -> Result<(), String> {
    if model_present() {
        let _ = app.emit("ocr-model-done", serde_json::json!({ "name": MODEL_NAME }));
        return Ok(());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut d = lock_recover(&state.downloads);
        if d.contains_key(MODEL_NAME) {
            return Err("already downloading".to_string());
        }
        d.insert(MODEL_NAME.to_string(), cancel.clone());
    }
    let _guard = DownloadGuard { state: &state };
    match download_model(&app, &cancel).await {
        Ok(()) => {
            let _ = app.emit("ocr-model-done", serde_json::json!({ "name": MODEL_NAME }));
            Ok(())
        }
        Err(e) if e == CANCELLED => {
            let _ = app.emit(
                "ocr-model-cancelled",
                serde_json::json!({ "name": MODEL_NAME }),
            );
            Ok(())
        }
        Err(message) => {
            let _ = app.emit(
                "ocr-model-error",
                serde_json::json!({ "name": MODEL_NAME, "message": message }),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn ocr_model_cancel(state: tauri::State<'_, OcrState>) -> Result<(), String> {
    if let Some(flag) = lock_recover(&state.downloads).get(MODEL_NAME) {
        flag.store(true, Ordering::Relaxed);
    }
    let dir = models_dir()?;
    for f in &MODEL_FILES {
        let _ = std::fs::remove_file(part_path(&dir.join(f.name)));
    }
    Ok(())
}

/// 取得中なら取り消してから消す。ロード済みのエンジンも手放す
#[tauri::command]
pub fn ocr_model_delete(state: tauri::State<'_, OcrState>) -> Result<(), String> {
    if let Some(flag) = lock_recover(&state.downloads).get(MODEL_NAME) {
        flag.store(true, Ordering::Relaxed);
    }
    // poison されていても手放せる（エンジンを捨てて読み直せる状態に戻す）
    *lock_recover(&state.engine) = None;
    let dir = models_dir()?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("モデルを削除できません: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 推論
// ---------------------------------------------------------------------------
fn load_engine() -> Result<OcrEngine, String> {
    let dir = models_dir()?;
    OcrEngine::load(
        &dir.join("det.onnx"),
        &dir.join("rec.onnx"),
        parse_dict(REC_DICT),
    )
    .map_err(|e| format!("OCR モデルを読み込めません: {e}"))
}

fn touch(state: &OcrState) {
    *lock_recover(&state.last_used) = Some(Instant::now());
}

/// 使われていないエンジンを置き場から外す。外したら true
fn unload_idle(state: &OcrState, idle: Duration) -> bool {
    let mut last = lock_recover(&state.last_used);
    if !is_idle(*last, Instant::now(), idle) {
        return false;
    }
    *lock_recover(&state.engine) = None;
    *last = None;
    true
}

/// 降ろすスレッド（アプリに 1 本）。embedding_models.rs の ensure_reaper と同じ形
fn ensure_reaper(app: &tauri::AppHandle, state: &OcrState) {
    if state.reaper_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("ocr-reaper".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(REAPER_TICK_SECS));
            let state = app.state::<OcrState>();
            if unload_idle(&state, Duration::from_secs(IDLE_UNLOAD_SECS)) {
                eprintln!("[ocr] unloaded {MODEL_NAME} after {IDLE_UNLOAD_SECS}s idle");
            }
        })
        .ok();
}

fn engine_for(app: &tauri::AppHandle, state: &OcrState) -> Result<Arc<OcrEngine>, String> {
    touch(state);
    let mut slot = lock_recover(&state.engine);
    if let Some(e) = slot.as_ref() {
        return Ok(e.clone());
    }
    if !model_present() {
        return Err("OCR_MODEL_NOT_DOWNLOADED".to_string());
    }
    let started = Instant::now();
    let engine = Arc::new(load_engine()?);
    eprintln!(
        "[ocr] loaded {MODEL_NAME} in {} ms",
        started.elapsed().as_millis()
    );
    *slot = Some(engine.clone());
    ensure_reaper(app, state);
    Ok(engine)
}

/// 本文は画像（PNG・JPEG など）の生バイト。
/// - モデルが未取得なら `OCR_MODEL_NOT_DOWNLOADED`、本文が 64 MB 超なら `OCR_INPUT_TOO_LARGE`、
///   順番待ちが 32 件を超えたら `OCR_BUSY`、90 秒を過ぎたら `OCR_TIMEOUT` で失敗する
/// - デコードから推論までは 1 件ずつ（WebView のスクリプトが並列に呼んでも同時に走るのは 1 件）
#[tauri::command]
pub async fn ocr_recognize(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<OcrRecognizeResult, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("invalid image body".to_string());
    };
    check_input_size(body.len())?;
    let state = app.state::<OcrState>();
    // 順番を待つ。待ち行列が長すぎれば待たずに断る
    let slot = enter_queue(&state.waiting, OCR_MAX_WAITING).ok_or_else(|| "OCR_BUSY".to_string())?;
    let permit = state.gate.clone().lock_owned().await;
    drop(slot);
    // 持ち時間は順番が来てから数える（待った時間は含めない）
    let deadline = Instant::now() + Duration::from_secs(OCR_DEADLINE_SECS);
    // Tauri の Request は本文を借りるだけで所有できないので、ここで 1 回だけ所有に移す
    // （順番を待っている間は複製しない＝同時に持つ複製は常に 1 つ）
    let bytes = body.clone();
    // デコード・推論は CPU を長く使うので async runtime のスレッドを塞がない
    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<OcrRecognizeResult, String> {
        // 許可証はこの処理が終わるまで持つ
        let _permit = permit;
        let state = task_app.state::<OcrState>();
        let engine = engine_for(&task_app, &state)?;
        let img = decode_image(&bytes).map_err(|e| format!("画像を読めません: {e}"))?;
        drop(bytes);
        let started = Instant::now();
        let opt = OcrOptions { deadline: Some(deadline), ..OcrOptions::default() };
        let lines = engine.recognize(&img, &opt).map_err(|e| {
            let msg = e.to_string();
            if msg == OCR_TIMEOUT {
                msg
            } else {
                format!("OCR に失敗: {e}")
            }
        })?;
        eprintln!(
            "[ocr] {} lines in {} ms",
            lines.len(),
            started.elapsed().as_millis()
        );
        Ok(OcrRecognizeResult {
            text: layout_text(&lines),
            confidence: confidence_percent(&lines),
            engine: MODEL_NAME,
        })
    })
    .await
    .map_err(|e| format!("ocr task failed: {e}"))??;
    touch(&app.state::<OcrState>());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(score: f32) -> OcrLine {
        OcrLine {
            text: "a".into(),
            score,
            quad: [[0.0; 2]; 4],
        }
    }

    #[test]
    fn status_requires_every_file_at_expected_size() {
        let (bytes, present) = status_of(|f| MODEL_FILES.iter().find(|x| x.name == f).unwrap().bytes);
        assert!(present);
        assert_eq!(bytes, MODEL_FILES.iter().map(|f| f.bytes).sum::<u64>());
        // 認識モデルが途中（0 バイト）なら present にならない
        let (bytes2, present2) = status_of(|f| {
            if f == "rec.onnx" {
                0
            } else {
                MODEL_FILES.iter().find(|x| x.name == f).unwrap().bytes
            }
        });
        assert!(!present2);
        assert!(bytes2 < bytes);
    }

    #[test]
    fn confidence_is_rounded_mean_percent() {
        assert_eq!(confidence_percent(&[]), 0);
        assert_eq!(confidence_percent(&[line(0.9), line(0.8)]), 85);
        assert_eq!(confidence_percent(&[line(0.994)]), 99);
    }

    #[test]
    fn idle_only_past_the_threshold() {
        let now = Instant::now();
        let idle = Duration::from_secs(600);
        assert!(is_idle(Some(now - Duration::from_secs(700)), now, idle));
        assert!(!is_idle(Some(now - Duration::from_secs(30)), now, idle));
        assert!(!is_idle(None, now, idle));
    }

    #[test]
    fn input_over_the_limit_is_rejected() {
        assert!(check_input_size(OCR_INPUT_MAX_BYTES).is_ok());
        assert_eq!(check_input_size(OCR_INPUT_MAX_BYTES + 1), Err("OCR_INPUT_TOO_LARGE".to_string()));
    }

    #[test]
    fn queue_admits_up_to_the_limit_then_says_busy() {
        let waiting = Arc::new(AtomicUsize::new(0));
        let slots: Vec<_> = (0..3).map(|_| enter_queue(&waiting, 3).unwrap()).collect();
        assert!(enter_queue(&waiting, 3).is_none());
        // 断られた分は件数に残らない
        assert_eq!(waiting.load(Ordering::SeqCst), 3);
        drop(slots);
        assert_eq!(waiting.load(Ordering::SeqCst), 0);
        assert!(enter_queue(&waiting, 3).is_some());
    }

    #[test]
    fn poisoned_state_is_recovered_and_engine_can_be_dropped() {
        let state = Arc::new(OcrState::default());
        let s2 = state.clone();
        let _ = std::thread::spawn(move || {
            let _g = s2.engine.lock().unwrap();
            panic!("poison にする");
        })
        .join();
        assert!(state.engine.lock().is_err());
        // poison されていても touch / unload が動く
        touch(&state);
        *state.last_used.lock().unwrap() = Some(Instant::now() - Duration::from_secs(10_000));
        assert!(unload_idle(&state, Duration::from_secs(60)));
        assert!(lock_recover(&state.engine).is_none());
    }

    #[test]
    fn model_urls_are_pinned_to_a_commit() {
        for f in &MODEL_FILES {
            assert!(f.url.starts_with("https://huggingface.co/PaddlePaddle/"));
            assert!(!f.url.contains("/resolve/main/"));
            assert_eq!(f.sha256.len(), 64);
        }
    }

    #[test]
    fn bundled_dict_matches_the_recognition_head() {
        // 認識モデルの出力クラス数 = blank + 辞書 + 空白。辞書が差し替わったら気づけるよう行数を固定する
        assert_eq!(parse_dict(REC_DICT).len(), 18_708);
    }
}
