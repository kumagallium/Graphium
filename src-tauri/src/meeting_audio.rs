//! 会議録音: OS の再生音（相手の声）とマイク（自分の声）を 2 トラック別ファイルで録る。
//!
//! - system: pinray（macOS は ScreenCaptureKit、Windows は WGC/WASAPI loopback）
//! - mic: cpal の既定入力デバイス
//! - 書き出し: 16 kHz / mono / 16bit の WAV を逐次書く（RAM に溜めない）
//! - 保存先: `media_dir()/<fileId>.wav` + `<fileId>.meta.json`（save_media_file_sync と同形式）
//!
//! 設計: docs/internal/meeting-recorder-design-2026-10.md §2.1

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(unused_imports))]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(unused_imports))]
use std::sync::{Arc, Mutex};
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(unused_imports))]
use std::thread::JoinHandle;
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(unused_imports))]
use std::time::Instant;

use serde::Serialize;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::Emitter;

/// 出力サンプルレート（文字起こし用）
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const OUT_RATE: u32 = 16_000;
/// 自動停止までの上限（3 時間）
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const MAX_DURATION_MS: u64 = 3 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 純関数（実デバイス無しでテストできる部分）
// ---------------------------------------------------------------------------
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
mod dsp {
    /// planar（前半 L・後半 R）のバッファを L R L R … に並べ直す。
    /// pinray 0.2.7 の macOS は Interleaved と報告しつつ実体は planar のため。
    /// チャンネル数 ch が 1 のとき、または長さが ch で割り切れないときはそのまま返す。
    pub fn planar_to_interleaved(samples: &[f32], ch: usize) -> Vec<f32> {
        if ch <= 1 || samples.len() % ch != 0 {
            return samples.to_vec();
        }
        let frames = samples.len() / ch;
        let mut out = Vec::with_capacity(samples.len());
        for i in 0..frames {
            for c in 0..ch {
                out.push(samples[c * frames + i]);
            }
        }
        out
    }

    /// インターリーブ済みサンプルをチャンネル平均でモノラル化する。
    pub fn to_mono(interleaved: &[f32], ch: usize) -> Vec<f32> {
        if ch <= 1 {
            return interleaved.to_vec();
        }
        interleaved
            .chunks_exact(ch)
            .map(|f| f.iter().sum::<f32>() / ch as f32)
            .collect()
    }

    /// 逐次入力に対応したリサンプラ。
    /// 整数比で割り切れるレートは「factor サンプル平均」の簡易ローパス付きデシメーション、
    /// それ以外は線形補間。
    pub struct Resampler {
        kind: Kind,
    }

    enum Kind {
        Decimate { factor: usize, acc: f32, n: usize },
        Linear { step: f64, pos: f64, prev: Option<f32> },
    }

    impl Resampler {
        pub fn new(in_rate: u32, out_rate: u32) -> Self {
            let kind = if in_rate == out_rate {
                Kind::Decimate { factor: 1, acc: 0.0, n: 0 }
            } else if in_rate % out_rate == 0 {
                Kind::Decimate { factor: (in_rate / out_rate) as usize, acc: 0.0, n: 0 }
            } else {
                Kind::Linear { step: in_rate as f64 / out_rate as f64, pos: 0.0, prev: None }
            };
            Self { kind }
        }

        pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
            match &mut self.kind {
                Kind::Decimate { factor, acc, n } => {
                    for &s in input {
                        *acc += s;
                        *n += 1;
                        if *n == *factor {
                            out.push(*acc / *factor as f32);
                            *acc = 0.0;
                            *n = 0;
                        }
                    }
                }
                Kind::Linear { step, pos, prev } => {
                    // pos は「prev を 0、input[0] を 1 とした」連続位置。
                    for &s in input {
                        match *prev {
                            None => {
                                // 最初のサンプルをそのまま出して基準にする
                                out.push(s);
                                *prev = Some(s);
                                *pos = *step;
                                // pos は prev(=0) 基準。次サンプルが 1。
                            }
                            Some(p) => {
                                // p が位置 0、s が位置 1 の区間で pos が 1 以下の間出力
                                while *pos <= 1.0 {
                                    let t = *pos as f32;
                                    out.push(p + (s - p) * t);
                                    *pos += *step;
                                }
                                *pos -= 1.0;
                                *prev = Some(s);
                            }
                        }
                    }
                }
            }
        }
    }

    /// f32(-1..1) を i16 へ（クリップ込み）。
    pub fn f32_to_i16(s: f32) -> i16 {
        (s.clamp(-1.0, 1.0) * 32767.0).round() as i16
    }

    /// RMS（0..1 付近）
    pub fn rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }
}

// ---------------------------------------------------------------------------
// コマンドの入出力型
// ---------------------------------------------------------------------------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub screen: &'static str,
    pub mic: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub id: String,
    pub started_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopResult {
    pub id: String,
    pub system_file_id: Option<String>,
    pub mic_file_id: Option<String>,
    pub duration_ms: u64,
    pub dropped_packets: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResult {
    pub recording: bool,
    pub id: Option<String>,
    pub elapsed_ms: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
struct LevelEvent {
    id: String,
    elapsed_ms: u64,
    system: f32,
    mic: f32,
}

/// 1 トラックの結果（スレッドから返る）
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
struct TrackOutcome {
    /// WAV を開いて書けたときだけ Some(fileId)
    file_id: Option<String>,
    dropped: u64,
}

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
struct Running {
    id: String,
    started: Instant,
    stop: Arc<AtomicBool>,
    system: Option<JoinHandle<TrackOutcome>>,
    mic: Option<JoinHandle<TrackOutcome>>,
    ticker: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct MeetingRecState(Mutex<Option<Running>>);

// ---------------------------------------------------------------------------
// 権限
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod mac_perm {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGRequestScreenCaptureAccess() -> bool;
    }
}

#[tauri::command]
pub fn meeting_rec_permission(request: Option<bool>) -> PermissionStatus {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: 引数なしで bool を返すだけの CoreGraphics 関数
        let mut ok = unsafe { mac_perm::CGPreflightScreenCaptureAccess() };
        if !ok && request == Some(true) {
            // 同意後の明示要求のときだけ OS のダイアログを出し、システム設定の一覧に Graphium を載せる（結果は待たない）
            // SAFETY: 引数なしで bool を返すだけの CoreGraphics 関数
            let _ = unsafe { mac_perm::CGRequestScreenCaptureAccess() };
            ok = false;
        }
        PermissionStatus { screen: if ok { "granted" } else { "denied" }, mic: "unknown" }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = request;
        PermissionStatus { screen: "granted", mic: "unknown" }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = request;
        PermissionStatus { screen: "denied", mic: "denied" }
    }
}

/// システム設定の「画面収録」ペインを開く（macOS 以外は何もしない）。
#[tauri::command]
pub fn meeting_rec_open_screen_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("設定を開けません: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 録音本体（macOS / Windows）
// ---------------------------------------------------------------------------
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod imp {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime};
    use tauri::Manager;

    type Writer = hound::WavWriter<std::io::BufWriter<fs::File>>;

    /// 日時 `YYYYMMDD-HHMM`（ローカル時刻。取れなければ UTC）
    fn timestamp_label() -> String {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        #[cfg(unix)]
        {
            let t = secs as libc::time_t;
            let mut tm: libc::tm = unsafe { std::mem::zeroed() };
            // SAFETY: t, tm とも有効なポインタ
            if !unsafe { libc::localtime_r(&t, &mut tm) }.is_null() {
                return format!(
                    "{:04}{:02}{:02}-{:02}{:02}",
                    tm.tm_year + 1900,
                    tm.tm_mon + 1,
                    tm.tm_mday,
                    tm.tm_hour,
                    tm.tm_min
                );
            }
        }
        // UTC フォールバック（days から civil date を求める）
        let days = secs.div_euclid(86_400);
        let rem = secs.rem_euclid(86_400);
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z.rem_euclid(146_097);
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
        format!("{:04}{:02}{:02}-{:02}{:02}", y, m, d, rem / 3600, (rem % 3600) / 60)
    }

    /// WAV だけを作って Writer を返す（meta.json は録音終了後に write_meta で書く）。
    fn open_track(label: &str, kind: &str) -> Result<(String, String, Writer), String> {
        let dir: PathBuf = crate::media_dir()?;
        let file_id = uuid::Uuid::new_v4().to_string();
        let name = format!("meeting-{label}-{kind}.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: OUT_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let w = hound::WavWriter::create(dir.join(format!("{file_id}.wav")), spec)
            .map_err(|e| format!("WAV 作成失敗: {e}"))?;
        Ok((file_id, name, w))
    }

    /// 開始に失敗したトラックの WAV を消す
    fn discard_track(file_id: &str, writer: Writer) {
        drop(writer);
        remove_wav(file_id);
    }

    fn remove_wav(file_id: &str) {
        if let Ok(dir) = crate::media_dir() {
            let _ = fs::remove_file(dir.join(format!("{file_id}.wav")));
        }
    }

    /// finalize 後に meta.json を書く（一覧は meta から作られるので、録音中は載らない）
    fn write_meta(
        file_id: &str,
        name: &str,
        started_wall: SystemTime,
        start_offset_ms: u64,
    ) -> Result<(), String> {
        let dir = crate::media_dir()?;
        let meta = serde_json::json!({
            "id": file_id,
            "name": name,
            "mimeType": "audio/wav",
            "createdTime": humantime::format_rfc3339(started_wall).to_string(),
            "startOffsetMs": start_offset_ms,
        });
        fs::write(
            dir.join(format!("{file_id}.meta.json")),
            serde_json::to_string(&meta).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("メタデータ書き込み失敗: {e}"))
    }

    fn emit_error(app: &tauri::AppHandle, id: &str, message: String) {
        let _ = app.emit("meeting-rec-error", serde_json::json!({ "id": id, "message": message }));
    }

    /// 16 kHz mono f32 を WAV へ書き、RMS を共有に残す。
    fn write_chunk(w: &mut Writer, samples: &[f32], level: &AtomicU32) -> Result<(), String> {
        for &s in samples {
            w.write_sample(dsp::f32_to_i16(s)).map_err(|e| format!("WAV 書き込み失敗: {e}"))?;
        }
        // 直近チャンクの RMS。ticker 側が読んで 500 ms ごとに送る（最大値を保持）
        let r = dsp::rms(samples);
        let cur = f32::from_bits(level.load(Ordering::Relaxed));
        if r > cur {
            level.store(r.to_bits(), Ordering::Relaxed);
        }
        Ok(())
    }

    // ---- system ----
    pub fn spawn_system(
        app: tauri::AppHandle,
        id: String,
        label: String,
        stop: Arc<AtomicBool>,
        level: Arc<AtomicU32>,
        clock: (Instant, SystemTime),
    ) -> JoinHandle<TrackOutcome> {
        std::thread::spawn(move || match run_system(&app, &id, &label, &stop, &level, clock) {
            Ok(o) => o,
            Err(msg) => {
                emit_error(&app, &id, format!("再生音の録音を開始できません: {msg}"));
                TrackOutcome { file_id: None, dropped: 0 }
            }
        })
    }

    /// Err は (メッセージ, 既に開けていた fileId)
    fn run_system(
        app: &tauri::AppHandle,
        id: &str,
        label: &str,
        stop: &AtomicBool,
        level: &AtomicU32,
        (started, started_wall): (Instant, SystemTime),
    ) -> Result<TrackOutcome, String> {
        use pinray::{
            AudioCapture, AudioData, BackendPreference, CaptureEvent, CaptureSession, SourceId,
            VideoCaptureTarget,
        };
        #[cfg(target_os = "macos")]
        let backend = BackendPreference::MacScreenCaptureKit;
        #[cfg(target_os = "windows")]
        let backend = BackendPreference::WindowsWgc;

        let mut session = CaptureSession::builder()
            .backend_preference(backend)
            // 映像は不要だが、無いとディスプレイフィルタが作られないため指定は必須
            .video_target(VideoCaptureTarget::Display(SourceId::new("auto")))
            .audio(AudioCapture::SystemMix)
            .frame_rate(Some(1))
            .build()
            .map_err(|e| e.to_string())?;
        let (file_id, name, mut writer) = open_track(label, "system")?;
        if let Err(e) = session.start() {
            discard_track(&file_id, writer);
            return Err(e.to_string());
        }
        let mut start_offset_ms: Option<u64> = None;

        let mut resampler: Option<(u32, dsp::Resampler)> = None;
        let mut out = Vec::<f32>::new();
        let mut first_seq: Option<u64> = None;
        let mut last_seq: Option<u64> = None;
        let mut packets = 0u64;
        let mut since_flush = 0usize;
        let mut written = 0u64;
        let mut result: Result<(), String> = Ok(());

        while !stop.load(Ordering::Relaxed) {
            let ev = match session.next_event(Some(Duration::from_millis(200))) {
                Ok(ev) => ev,
                // 待ち時間内にイベントが無いだけ。停止フラグを見に戻る
                Err(pinray::PinrayError::Timeout(_)) => continue,
                Err(e) => {
                    result = Err(e.to_string());
                    break;
                }
            };
            match ev {
                CaptureEvent::Audio(f) => {
                    start_offset_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
                    packets += 1;
                    first_seq.get_or_insert(f.sequence);
                    last_seq = Some(f.sequence);
                    let ch = f.channels.max(1) as usize;
                    let (floats, planar) = match &f.data {
                        AudioData::Interleaved(b) => (bytes_to_f32(b), cfg!(target_os = "macos")),
                        AudioData::Planar(planes) => {
                            // 面ごとに並んでいる。連結して planar 扱いにする
                            let mut v = Vec::new();
                            for p in planes {
                                v.extend(bytes_to_f32(p));
                            }
                            (v, true)
                        }
                    };
                    let inter = if planar { dsp::planar_to_interleaved(&floats, ch) } else { floats };
                    let mono = dsp::to_mono(&inter, ch);
                    let rs = match &mut resampler {
                        Some((rate, r)) if *rate == f.sample_rate => r,
                        slot => {
                            *slot = Some((f.sample_rate, dsp::Resampler::new(f.sample_rate, OUT_RATE)));
                            &mut slot.as_mut().unwrap().1
                        }
                    };
                    out.clear();
                    rs.process(&mono, &mut out);
                    if let Err(e) = write_chunk(&mut writer, &out, level) {
                        result = Err(e);
                        break;
                    }
                    since_flush += out.len();
                    written += out.len() as u64;
                    if since_flush >= OUT_RATE as usize * 5 {
                        let _ = writer.flush();
                        since_flush = 0;
                    }
                }
                CaptureEvent::End => {
                    emit_error(app, id, "再生音の取得が終了しました".to_string());
                    break;
                }
                _ => {}
            }
        }
        let _ = session.stop();
        let _ = writer.finalize();
        if written == 0 {
            // 一度もデータが来なかったトラックは空 WAV を残さない（meta も書かない）
            remove_wav(&file_id);
            if let Err(e) = result {
                emit_error(app, id, format!("再生音の録音中にエラー: {e}"));
            }
            return Ok(TrackOutcome { file_id: None, dropped: 0 });
        }
        if let Err(e) = write_meta(&file_id, &name, started_wall, start_offset_ms.unwrap_or(0)) {
            emit_error(app, id, format!("再生音のメタデータを保存できません: {e}"));
        }
        if let Err(e) = result {
            emit_error(app, id, format!("再生音の録音中にエラー: {e}"));
        }
        let dropped = match (first_seq, last_seq) {
            (Some(a), Some(b)) => b.saturating_sub(a).saturating_add(1).saturating_sub(packets),
            _ => 0,
        };
        Ok(TrackOutcome { file_id: Some(file_id), dropped })
    }

    fn bytes_to_f32(b: &[u8]) -> Vec<f32> {
        b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
    }

    // ---- mic ----
    pub fn spawn_mic(
        app: tauri::AppHandle,
        id: String,
        label: String,
        stop: Arc<AtomicBool>,
        level: Arc<AtomicU32>,
        clock: (Instant, SystemTime),
    ) -> JoinHandle<TrackOutcome> {
        std::thread::spawn(move || match run_mic(&app, &id, &label, &stop, &level, clock) {
            Ok(o) => o,
            Err(msg) => {
                emit_error(&app, &id, format!("マイクの録音を開始できません: {msg}"));
                TrackOutcome { file_id: None, dropped: 0 }
            }
        })
    }

    fn run_mic(
        app: &tauri::AppHandle,
        id: &str,
        label: &str,
        stop: &AtomicBool,
        level: &AtomicU32,
        (started, started_wall): (Instant, SystemTime),
    ) -> Result<TrackOutcome, String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        use cpal::SampleFormat;

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "入力デバイスが見つかりません".to_string())?;
        let cfg = device.default_input_config().map_err(|e| e.to_string())?;
        let ch = cfg.channels().max(1) as usize;
        let rate: u32 = cfg.sample_rate();
        let stream_cfg: cpal::StreamConfig = cfg.clone().into();

        // コールバックはモノラル化した塊だけを送る（重い処理・I/O はスレッド側）
        let (tx, rx) = mpsc::channel::<Vec<f32>>();
        let err_app = app.clone();
        let err_id = id.to_string();
        let err_fn = move |e: cpal::Error| {
            emit_error(&err_app, &err_id, format!("マイクのストリームエラー: {e}"));
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
            other => return Err(format!("未対応のサンプル形式: {other:?}")),
        }
        .map_err(|e| e.to_string())?;
        drop(tx);

        let (file_id, name, mut writer) = open_track(label, "mic")?;
        if let Err(e) = stream.play() {
            drop(stream);
            discard_track(&file_id, writer);
            return Err(e.to_string());
        }
        let mut start_offset_ms: Option<u64> = None;

        let mut rs = dsp::Resampler::new(rate, OUT_RATE);
        let mut out = Vec::<f32>::new();
        let mut since_flush = 0usize;
        let mut written = 0u64;
        let mut result: Result<(), String> = Ok(());
        while !stop.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(chunk) => {
                    start_offset_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
                    out.clear();
                    rs.process(&chunk, &mut out);
                    if let Err(e) = write_chunk(&mut writer, &out, level) {
                        result = Err(e);
                        break;
                    }
                    since_flush += out.len();
                    written += out.len() as u64;
                    if since_flush >= OUT_RATE as usize * 5 {
                        let _ = writer.flush();
                        since_flush = 0;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(stream);
        let _ = writer.finalize();
        if written == 0 {
            // 一度もデータが来なかったトラックは空 WAV を残さない（meta も書かない）
            remove_wav(&file_id);
            if let Err(e) = result {
                emit_error(app, id, format!("マイクの録音中にエラー: {e}"));
            }
            return Ok(TrackOutcome { file_id: None, dropped: 0 });
        }
        if let Err(e) = write_meta(&file_id, &name, started_wall, start_offset_ms.unwrap_or(0)) {
            emit_error(app, id, format!("マイクのメタデータを保存できません: {e}"));
        }
        if let Err(e) = result {
            emit_error(app, id, format!("マイクの録音中にエラー: {e}"));
        }
        Ok(TrackOutcome { file_id: Some(file_id), dropped: 0 })
    }

    // ---- ticker（レベル通知と 3 時間上限）----
    pub fn spawn_ticker(
        app: tauri::AppHandle,
        id: String,
        started: Instant,
        stop: Arc<AtomicBool>,
        sys_level: Arc<AtomicU32>,
        mic_level: Arc<AtomicU32>,
    ) -> JoinHandle<()> {
        std::thread::spawn(move || {
            let mut last = Instant::now();
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(50));
                if last.elapsed() < Duration::from_millis(500) {
                    continue;
                }
                last = Instant::now();
                let elapsed_ms = started.elapsed().as_millis() as u64;
                let take = |a: &AtomicU32| f32::from_bits(a.swap(0f32.to_bits(), Ordering::Relaxed)).min(1.0);
                let _ = app.emit(
                    "meeting-rec-level",
                    LevelEvent { id: id.clone(), elapsed_ms, system: take(&sys_level), mic: take(&mic_level) },
                );
                if elapsed_ms >= MAX_DURATION_MS {
                    stop.store(true, Ordering::Relaxed);
                    // 自分自身を join しないよう、停止処理は別スレッドで行う
                    let app = app.clone();
                    let id = id.clone();
                    std::thread::spawn(move || {
                        let result = stop_running(&app.state::<MeetingRecState>()).ok();
                        let _ = app.emit(
                            "meeting-rec-stopped",
                            serde_json::json!({ "id": id, "reason": "limit", "result": result }),
                        );
                    });
                    break;
                }
            }
        })
    }

    pub fn start(app: tauri::AppHandle, state: &MeetingRecState) -> Result<StartResult, String> {
        let mut guard = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        if guard.is_some() {
            return Err("already recording".to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let label = timestamp_label();
        let stop = Arc::new(AtomicBool::new(false));
        let sys_level = Arc::new(AtomicU32::new(0));
        let mic_level = Arc::new(AtomicU32::new(0));
        let started = Instant::now();
        let started_wall = SystemTime::now();
        let started_at = humantime::format_rfc3339_seconds(started_wall).to_string();
        let clock = (started, started_wall);

        let system =
            spawn_system(app.clone(), id.clone(), label.clone(), stop.clone(), sys_level.clone(), clock);
        let mic = spawn_mic(app.clone(), id.clone(), label, stop.clone(), mic_level.clone(), clock);
        let ticker = spawn_ticker(app, id.clone(), started, stop.clone(), sys_level, mic_level);
        *guard = Some(Running {
            id: id.clone(),
            started,
            stop,
            system: Some(system),
            mic: Some(mic),
            ticker: Some(ticker),
        });
        Ok(StartResult { id, started_at })
    }

    /// deadline までハンドルの終了を待つ（過ぎたら待たずに None。スレッドは放置）
    fn join_until<T>(h: JoinHandle<T>, deadline: Instant) -> Option<T> {
        while !h.is_finished() {
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        h.join().ok()
    }

    /// 録音を止めて finalize と meta 書き出しまで済ませる。
    /// 3 時間上限からは別スレッドで呼ばれる（emit は呼び出し側）。
    pub fn stop_running(state: &MeetingRecState) -> Result<StopResult, String> {
        let mut running = state
            .0
            .lock()
            .map_err(|_| "state poisoned".to_string())?
            .take()
            .ok_or_else(|| "not recording".to_string())?;
        running.stop.store(true, Ordering::Relaxed);
        let duration_ms = running.started.elapsed().as_millis() as u64;
        let deadline = Instant::now() + Duration::from_secs(3);
        let sys = running.system.take().and_then(|h| join_until(h, deadline));
        let mic = running.mic.take().and_then(|h| join_until(h, deadline));
        if let Some(t) = running.ticker.take() {
            // 万一 ticker スレッド自身から呼ばれても自分を join しない
            if t.thread().id() != std::thread::current().id() {
                let _ = join_until(t, deadline);
            }
        }
        Ok(StopResult {
            id: running.id,
            system_file_id: sys.as_ref().and_then(|o| o.file_id.clone()),
            mic_file_id: mic.as_ref().and_then(|o| o.file_id.clone()),
            duration_ms,
            dropped_packets: sys.map(|o| o.dropped).unwrap_or(0)
                + mic.map(|o| o.dropped).unwrap_or(0),
        })
    }

    pub fn stop(state: &MeetingRecState) -> Result<StopResult, String> {
        stop_running(state)
    }
}

/// アプリ終了前に呼ぶ。録音中なら止めて finalize / meta 書き出しまで済ませる。無ければ何もしない。
pub fn stop_if_running(app: &tauri::AppHandle) {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        use tauri::Manager;
        let state = app.state::<MeetingRecState>();
        let running = state.0.lock().map(|g| g.is_some()).unwrap_or(false);
        if running {
            let _ = imp::stop(&state);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
    }
}

// ---------------------------------------------------------------------------
// コマンド
// ---------------------------------------------------------------------------
#[tauri::command]
pub fn meeting_rec_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, MeetingRecState>,
) -> Result<StartResult, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        imp::start(app, &state)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, state);
        Err("unsupported platform".to_string())
    }
}

/// 停止はキャプチャスレッドの join（最長で next_event の待ち時間ぶん）を伴うので、
/// メインスレッドを塞がないよう blocking プールで行う（save_media_file と同じ作法）。
#[tauri::command]
pub async fn meeting_rec_stop(app: tauri::AppHandle) -> Result<StopResult, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<MeetingRecState>();
            imp::stop(&state)
        })
        .await
        .map_err(|e| format!("stop task failed: {e}"))?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Err("unsupported platform".to_string())
    }
}

#[tauri::command]
pub fn meeting_rec_status(state: tauri::State<'_, MeetingRecState>) -> StatusResult {
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(r) => StatusResult {
            recording: true,
            id: Some(r.id.clone()),
            elapsed_ms: Some(r.started.elapsed().as_millis() as u64),
        },
        None => StatusResult { recording: false, id: None, elapsed_ms: None },
    }
}


#[cfg(test)]
mod tests {
    use super::dsp::*;

    fn sine(freq: f32, rate: u32, secs: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.5)
            .collect()
    }

    fn est_hz(x: &[f32], rate: u32) -> f32 {
        let mut zc = 0;
        for w in x.windows(2) {
            if w[0] < 0.0 && w[1] >= 0.0 {
                zc += 1;
            }
        }
        zc as f32 / (x.len() as f32 / rate as f32)
    }

    #[test]
    fn planar_roundtrip_keeps_frequency() {
        let l = sine(440.0, 48_000, 1.0);
        let r = vec![0.0f32; l.len()];
        let mut planar = l.clone();
        planar.extend(&r);
        let inter = planar_to_interleaved(&planar, 2);
        assert_eq!(inter.len(), planar.len());
        assert_eq!(inter[2], l[1]);
        assert_eq!(inter[3], 0.0);
        let mono = to_mono(&inter, 2);
        let mut rs = Resampler::new(48_000, 16_000);
        let mut out = Vec::new();
        rs.process(&mono, &mut out);
        assert_eq!(out.len(), 16_000);
        let hz = est_hz(&out, 16_000);
        assert!((hz - 440.0).abs() < 5.0, "hz={hz}");
    }

    #[test]
    fn mono_average() {
        assert_eq!(to_mono(&[1.0, 3.0, -1.0, 1.0], 2), vec![2.0, 0.0]);
        assert_eq!(to_mono(&[0.5, 0.25], 1), vec![0.5, 0.25]);
    }

    #[test]
    fn decimate_streaming_matches_whole() {
        let x = sine(300.0, 48_000, 0.5);
        let mut whole = Vec::new();
        Resampler::new(48_000, 16_000).process(&x, &mut whole);
        let mut rs = Resampler::new(48_000, 16_000);
        let mut parts = Vec::new();
        for c in x.chunks(1001) {
            rs.process(c, &mut parts);
        }
        assert_eq!(whole.len(), parts.len());
        for (a, b) in whole.iter().zip(&parts) {
            assert!((a - b).abs() < 1e-5);
        }
    }

    #[test]
    fn linear_resample_44100() {
        let x = sine(440.0, 44_100, 1.0);
        let mut rs = Resampler::new(44_100, 16_000);
        let mut out = Vec::new();
        for c in x.chunks(512) {
            rs.process(c, &mut out);
        }
        assert!((out.len() as i64 - 16_000).abs() <= 2, "len={}", out.len());
        let hz = est_hz(&out, 16_000);
        assert!((hz - 440.0).abs() < 5.0, "hz={hz}");
    }

    #[test]
    fn i16_conversion_clips() {
        assert_eq!(f32_to_i16(0.0), 0);
        assert_eq!(f32_to_i16(1.0), 32767);
        assert_eq!(f32_to_i16(2.0), 32767);
        assert_eq!(f32_to_i16(-2.0), -32767);
    }

    #[test]
    fn rms_of_sine() {
        let x = sine(440.0, 16_000, 1.0);
        let r = rms(&x);
        assert!((r - 0.5 / 2f32.sqrt()).abs() < 0.01, "rms={r}");
        assert_eq!(rms(&[]), 0.0);
    }
}
