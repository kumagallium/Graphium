//! 声の入力（⌘K とチャット欄のマイク）。
//!
//! - 録音: マイクだけを cpal で録り、16 kHz mono f32 にしてメモリに溜める。ファイルは作らない
//! - 文字起こし: 会議録音と同じ whisper（端末内）。結果の文字を返すだけで、保存しない
//! - 上限: MAX_SECONDS 秒で録音を止め（`voice-input-limit` を送る）、それ以上は溜めない
//! - モデル: 使ったあと ENGINE_IDLE_SECS 秒は読み込んだままにして、続けて話したときの待ちを減らす
//!
//! 声も文字も、素材・索引・PROV に残さない。画面側が入力欄に入れるだけ。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::meeting_transcribe::{
    has_speech_text, is_stock_hallucination, model_path, model_present, normalize_vocabulary, Engine,
};
use crate::require_main_window;

/// whisper が読む標本化周波数
const SAMPLE_RATE: usize = 16_000;
/// 1 回の発話の上限（秒）。検索やチャットの問いには十分な長さ
pub const MAX_SECONDS: usize = 30;
const MAX_SAMPLES: usize = SAMPLE_RATE * MAX_SECONDS;
/// これより短い録音は文字にしない（押してすぐ止めた・ほぼ無音）
const MIN_SAMPLES: usize = SAMPLE_RATE * 3 / 10;
/// モデルを読み込んだままにしておく時間（秒）
const ENGINE_IDLE_SECS: u64 = 180;
/// 音量を画面へ送る間隔（ミリ秒）
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const LEVEL_INTERVAL_MS: u128 = 100;

struct Recording {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<Result<Vec<f32>, String>>,
}

struct Cached {
    size: String,
    engine: Engine,
    last_used: Instant,
}

#[derive(Default)]
pub struct VoiceInputState {
    rec: Mutex<Option<Recording>>,
    engine: Arc<Mutex<Option<Cached>>>,
    /// 文字起こし中。この間は新しい録音を受けない（stop の連打で処理待ちが溜まらないように）
    transcribing: Arc<AtomicBool>,
    /// モデルを外す見張りが動いているか（成功のたびにスレッドを増やさない）
    unload_watch: Arc<AtomicBool>,
}

/// 文字起こし中の印を、どう終わっても（失敗・panic でも）外す
struct TranscribingGuard(Arc<AtomicBool>);
impl Drop for TranscribingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInputResult {
    /// 文字にしたもの。声が無かったときは空文字
    pub text: String,
    /// 録れた長さ（秒）
    pub seconds: f32,
}

/// 言語の指定を確かめる（whisper にそのまま渡すので、決まった値だけを通す）
fn checked_language(language: &str) -> Result<&'static str, String> {
    match language {
        "auto" => Ok("auto"),
        "ja" => Ok("ja"),
        "en" => Ok("en"),
        _ => Err("invalid-language".to_string()),
    }
}


/// 区切りごとの文字をつなぐ。無音の残りかすと定型の幻聴は捨てる
fn join_segments<'a>(texts: impl IntoIterator<Item = &'a str>) -> String {
    let mut out = String::new();
    for t in texts {
        let t = t.trim();
        if !has_speech_text(t) || is_stock_hallucination(t) {
            continue;
        }
        if !out.is_empty() {
            // 日本語どうしは詰め、英字が隣り合うときだけ空白を入れる
            let prev_ascii = out.chars().last().is_some_and(|c| c.is_ascii_alphanumeric());
            let next_ascii = t.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
            if prev_ascii && next_ascii {
                out.push(' ');
            }
        }
        out.push_str(t);
    }
    out
}

/// 溜める先に足す。上限を超えた分は捨て、上限に達したら true
fn push_capped(buf: &mut Vec<f32>, samples: &[f32]) -> bool {
    let room = MAX_SAMPLES.saturating_sub(buf.len());
    buf.extend_from_slice(&samples[..samples.len().min(room)]);
    buf.len() >= MAX_SAMPLES
}

// ---------------------------------------------------------------------------
// マイクの録音（macOS / Windows）
// ---------------------------------------------------------------------------
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod capture {
    use super::*;
    use crate::meeting_audio::dsp;
    use std::sync::mpsc;
    use tauri::Emitter;

    pub fn spawn(app: tauri::AppHandle, stop: Arc<AtomicBool>) -> JoinHandle<Result<Vec<f32>, String>> {
        std::thread::spawn(move || {
            let r = run(&app, &stop);
            if let Err(msg) = &r {
                let _ = app.emit("voice-input-error", serde_json::json!({ "message": msg }));
            }
            r
        })
    }

    fn run(app: &tauri::AppHandle, stop: &AtomicBool) -> Result<Vec<f32>, String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        use cpal::SampleFormat;

        let host = cpal::default_host();
        let device = host.default_input_device().ok_or_else(|| "no-input-device".to_string())?;
        let cfg = device.default_input_config().map_err(|e| e.to_string())?;
        let ch = cfg.channels().max(1) as usize;
        let rate: u32 = cfg.sample_rate();
        let stream_cfg: cpal::StreamConfig = cfg.into();

        let (tx, rx) = mpsc::channel::<Vec<f32>>();
        let err_app = app.clone();
        let err_fn = move |e: cpal::Error| {
            let _ = err_app.emit("voice-input-error", serde_json::json!({ "message": e.to_string() }));
        };
        let stream = match cfg.sample_format() {
            SampleFormat::F32 => {
                let tx = tx.clone();
                device.build_input_stream(
                    stream_cfg,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let _ = tx.send(dsp::to_mono(data, ch));
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                let tx = tx.clone();
                device.build_input_stream(
                    stream_cfg,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let f: Vec<f32> = data.iter().map(|s| *s as f32 / 32768.0).collect();
                        let _ = tx.send(dsp::to_mono(&f, ch));
                    },
                    err_fn,
                    None,
                )
            }
            other => return Err(format!("unsupported sample format: {other:?}")),
        }
        .map_err(|e| e.to_string())?;
        drop(tx);
        stream.play().map_err(|e| e.to_string())?;

        let mut rs = dsp::Resampler::new(rate, SAMPLE_RATE as u32);
        let mut buf = Vec::<f32>::with_capacity(SAMPLE_RATE * 5);
        let mut out = Vec::<f32>::new();
        let mut last_level = Instant::now();
        let mut peak = 0.0f32;
        let mut full = false;
        while !stop.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(chunk) => {
                    out.clear();
                    rs.process(&chunk, &mut out);
                    peak = peak.max(dsp::rms(&out));
                    if last_level.elapsed().as_millis() >= LEVEL_INTERVAL_MS {
                        let _ = app.emit(
                            "voice-input-level",
                            serde_json::json!({ "level": peak, "seconds": buf.len() as f32 / SAMPLE_RATE as f32 }),
                        );
                        peak = 0.0;
                        last_level = Instant::now();
                    }
                    if push_capped(&mut buf, &out) {
                        full = true;
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(stream);
        if full {
            let _ = app.emit("voice-input-limit", serde_json::json!({ "seconds": MAX_SECONDS }));
        } else {
            out.clear();
            rs.flush(&mut out);
            push_capped(&mut buf, &out);
        }
        Ok(buf)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod capture {
    use super::*;

    pub fn spawn(_app: tauri::AppHandle, _stop: Arc<AtomicBool>) -> JoinHandle<Result<Vec<f32>, String>> {
        std::thread::spawn(|| Err("unsupported platform".to_string()))
    }
}

/// 録音中のものを止めて、録れた音を受け取る
fn finish(rec: Recording) -> Result<Vec<f32>, String> {
    rec.stop.store(true, Ordering::Relaxed);
    rec.handle.join().map_err(|_| "capture thread panicked".to_string())?
}

/// 使い終わったモデルを、しばらく使われなければ外す。見張りは 1 本だけ動かし、
/// 最後に使ってから ENGINE_IDLE_SECS 秒たつまで寝直す
fn schedule_unload(engine: Arc<Mutex<Option<Cached>>>, watch: Arc<AtomicBool>) {
    if watch.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let idle = Duration::from_secs(ENGINE_IDLE_SECS);
        let mut wait = idle;
        loop {
            std::thread::sleep(wait);
            let mut g = engine.lock().unwrap_or_else(|e| e.into_inner());
            match g.as_ref().map(|c| c.last_used.elapsed()) {
                Some(used) if used < idle => wait = idle - used,
                _ => {
                    *g = None;
                    break;
                }
            }
        }
        watch.store(false, Ordering::SeqCst);
    });
}

fn transcribe(
    engine: &Arc<Mutex<Option<Cached>>>,
    samples: &[f32],
    language: &str,
    size: &str,
    vocabulary: Option<&str>,
) -> Result<String, String> {
    let mut g = engine.lock().unwrap_or_else(|e| e.into_inner());
    if g.as_ref().map(|c| c.size.as_str()) != Some(size) {
        // 大きさが変わったら読み直す（先に外して、2 つ同時にメモリに載せない）
        *g = None;
        let path = model_path(size)?;
        *g = Some(Cached { size: size.to_string(), engine: Engine::load(&path)?, last_used: Instant::now() });
    }
    let cached = g.as_mut().expect("engine loaded above");
    // 失敗しても使った扱いにして、見張りが時間どおりに外せるようにする
    cached.last_used = Instant::now();
    let mut st = cached.engine.new_track()?;
    let segs = cached.engine.transcribe(&mut st, samples, 0, language, vocabulary)?;
    Ok(join_segments(segs.iter().map(|s| s.text.as_str())))
}

/// マイクの録音を始める。録音中・文字起こし中なら "busy"。メインウィンドウからだけ受ける
/// （viewer は共有ノートなど外から来た内容を表示するので、マイクに触らせない）
#[tauri::command]
pub fn voice_input_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, VoiceInputState>,
) -> Result<(), String> {
    require_main_window(&window)?;
    if state.transcribing.load(Ordering::SeqCst) {
        return Err("busy".to_string());
    }
    let mut g = state.rec.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(rec) = g.as_ref() {
        if !rec.handle.is_finished() {
            return Err("busy".to_string());
        }
        // 上限で止まったまま受け取られていない前の録音は捨てる
        if let Some(old) = g.take() {
            let _ = finish(old);
        }
    }
    let stop = Arc::new(AtomicBool::new(false));
    let handle = capture::spawn(app, stop.clone());
    *g = Some(Recording { stop, handle });
    Ok(())
}

/// 録音を止めて文字にする。モデルが無ければ "model-missing"、録音していなければ "not-recording"
#[tauri::command]
pub async fn voice_input_stop(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, VoiceInputState>,
    language: String,
    model_size: String,
    vocabulary: Option<String>,
) -> Result<VoiceInputResult, String> {
    require_main_window(&window)?;
    let rec = state.rec.lock().unwrap_or_else(|e| e.into_inner()).take();
    let rec = rec.ok_or_else(|| "not-recording".to_string())?;
    // 録音を取り出したのと同じ流れで印を立てる（終わるまで次の start を断る）
    state.transcribing.store(true, Ordering::SeqCst);
    let guard = TranscribingGuard(state.transcribing.clone());
    // 先に引数を確かめる（だめでも録音は止める）
    let checked = checked_language(&language).and_then(|lang| {
        if model_present(&model_size) {
            Ok(lang)
        } else {
            Err("model-missing".to_string())
        }
    });
    let engine = state.engine.clone();
    let watch = state.unload_watch.clone();
    // 会議録音と同じ整え方（制御文字を落とす。NUL は whisper-rs が panic する）
    let vocabulary = normalize_vocabulary(vocabulary.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let samples = finish(rec)?;
        let lang = checked?;
        let seconds = samples.len() as f32 / SAMPLE_RATE as f32;
        if samples.len() < MIN_SAMPLES {
            return Ok(VoiceInputResult { text: String::new(), seconds });
        }
        let result = transcribe(&engine, &samples, lang, &model_size, vocabulary.as_deref());
        // 成功しても失敗しても見張りを付ける（失敗のあとモデルが載ったまま残らないように）
        schedule_unload(engine, watch);
        Ok(VoiceInputResult { text: result?, seconds })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 録音を止めて捨てる（文字にしない）
#[tauri::command]
pub fn voice_input_cancel(window: tauri::WebviewWindow, state: tauri::State<'_, VoiceInputState>) {
    if require_main_window(&window).is_err() {
        return;
    }
    let rec = state.rec.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(rec) = rec {
        // 止めるだけで待たない（録音スレッドは 100 ms 以内に抜ける）
        rec.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_language_only_known_values() {
        assert_eq!(checked_language("auto").unwrap(), "auto");
        assert_eq!(checked_language("ja").unwrap(), "ja");
        assert!(checked_language("fr").is_err());
        assert!(checked_language("ja\0").is_err());
    }

    #[test]
    fn voice_vocabulary_drops_nul_before_whisper() {
        // NUL は set_initial_prompt が panic するので、渡す前に落ちていること
        assert_eq!(normalize_vocabulary(Some("焼\u{0}成")).as_deref(), Some("焼成"));
        assert_eq!(normalize_vocabulary(Some(" \u{0} ")), None);
    }

    #[test]
    fn voice_transcribing_guard_clears_on_drop() {
        let flag = Arc::new(AtomicBool::new(true));
        {
            let _g = TranscribingGuard(flag.clone());
        }
        assert!(!flag.load(Ordering::SeqCst));
    }

    #[test]
    fn voice_join_drops_noise_and_spaces_ascii() {
        assert_eq!(join_segments(["焼成温度の", "記録"]), "焼成温度の記録");
        assert_eq!(join_segments(["bake", "temperature"]), "bake temperature");
        assert_eq!(join_segments(["ー", "ご視聴ありがとうございました", "塩"]), "塩");
        assert_eq!(join_segments([]), "");
    }

    #[test]
    fn voice_push_capped_stops_at_limit() {
        let mut buf = vec![0.0; MAX_SAMPLES - 10];
        assert!(push_capped(&mut buf, &[0.5; 30]));
        assert_eq!(buf.len(), MAX_SAMPLES);
        assert!(push_capped(&mut buf, &[0.5; 30]));
        assert_eq!(buf.len(), MAX_SAMPLES);
        let mut small = Vec::new();
        assert!(!push_capped(&mut small, &[0.1; 100]));
        assert_eq!(small.len(), 100);
    }
}
