//! 会議録音: OS の再生音（相手の声）とマイク（自分の声）を 1 本の stereo WAV（左 = 相手、右 = 自分）で録る。
//!
//! - system: pinray（macOS は ScreenCaptureKit、Windows は WGC/WASAPI loopback）
//! - mic: cpal の既定入力デバイス
//! - 書き出し: ミキサースレッドが両トラックを録音開始からの時刻で揃え、16 kHz / stereo / 16bit の WAV を逐次書く
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
// ミキサーの揃え処理（I/O を持たない純粋な部分）
// ---------------------------------------------------------------------------
/// トラック番号（stereo の左 = system、右 = mic）
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const SYSTEM: usize = 0;
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const MIC: usize = 1;

/// 録音開始からの ms → 16 kHz のサンプル数
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
fn ms_to_samples(ms: u64) -> usize {
    (ms * OUT_RATE as u64 / 1000) as usize
}

/// 左右（L = system, R = mic）を交互に並べた i16 にする
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
fn interleave_i16(left: &[f32], right: &[f32]) -> Vec<i16> {
    let mut v = Vec::with_capacity(left.len() * 2);
    for (l, r) in left.iter().zip(right.iter()) {
        v.push(dsp::f32_to_i16(*l));
        v.push(dsp::f32_to_i16(*r));
    }
    v
}

/// 片方の最初のチャンクから、もう片方の最初のチャンクをこれだけ待つ。過ぎたら「無音で始まっている」扱い
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const LEAD_WAIT_MS: u64 = 2000;
/// 後続チャンクが期待位置よりこれを超えて遅れていたら、差ぶんの無音を挿入する
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const GAP_FILL_MS: u64 = 200;

/// 2 トラックの未書き込みサンプルを持ち、両方そろった長さまで取り出す。
/// - 各トラックの最初のチャンクには、録音開始からの遅れぶんの無音を先頭に足す
/// - 2 個目以降も到着時刻から期待位置を求め、GAP_FILL_MS を超えて遅れていれば隙間を無音で埋める
///   （早く来た分＝ドリフトは何もしない）
/// - 取り出せるのは「閉じていない・無音開始でないトラックの未書き込み長」の短い方まで
///   （最初のチャンクがまだのトラックは 0 扱いなので待つ。待ち切れなければ start_silent）
/// - 閉じた／無音開始のトラックは無音で埋める。両方閉じたら短い方を無音で埋めて長い方に揃える
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
struct Aligner {
    buf: [std::collections::VecDeque<f32>; 2],
    closed: [bool; 2],
    /// 最初のチャンクが届いたか
    started: [bool; 2],
    /// 最初のチャンクを待たずに無音で書き始めたトラック（実データが届くと通常扱いに戻る）
    silent: [bool; 2],
    /// そのトラックのタイムライン上の長さ（書き込み済み + バッファ + 無音の補填）
    total: [usize; 2],
}

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
impl Aligner {
    fn new() -> Self {
        Self {
            buf: Default::default(),
            closed: [false; 2],
            started: [false; 2],
            silent: [false; 2],
            total: [0; 2],
        }
    }

    /// `at_samples` はチャンク到着時刻の録音開始からのサンプル位置。
    /// 最初のチャンクはその位置までを先頭の無音にする。以降はチャンクの先頭位置
    /// （到着位置 − チャンク長）が書き込み済みの長さを GAP_FILL_MS 超で先行していれば隙間を埋める
    fn push(&mut self, track: usize, at_samples: usize, samples: &[f32]) {
        let first = !self.started[track] && self.total[track] == 0;
        let expected = if first { at_samples } else { at_samples.saturating_sub(samples.len()) };
        let gap = if first {
            expected
        } else if expected > self.total[track] + ms_to_samples(GAP_FILL_MS) {
            expected - self.total[track]
        } else {
            0
        };
        let b = &mut self.buf[track];
        b.extend(std::iter::repeat(0.0).take(gap));
        b.extend(samples.iter().copied());
        self.total[track] += gap + samples.len();
        self.started[track] = true;
        self.silent[track] = false;
    }

    fn close(&mut self, track: usize) {
        self.closed[track] = true;
    }

    /// 最初のチャンクを待たずに、このトラックを無音で書き始める
    fn start_silent(&mut self, track: usize) {
        if !self.started[track] && !self.closed[track] {
            self.silent[track] = true;
        }
    }

    /// 書ける分を (左, 右) の同じ長さで取り出す
    fn drain(&mut self) -> (Vec<f32>, Vec<f32>) {
        let open_min = (0..2)
            .filter(|&t| !self.closed[t] && !self.silent[t])
            .map(|t| self.buf[t].len())
            .min();
        let n = match open_min {
            Some(n) => n,
            None => self.buf[0].len().max(self.buf[1].len()),
        };
        let mut out: [Vec<f32>; 2] = Default::default();
        for t in 0..2 {
            let k = n.min(self.buf[t].len());
            let mut v: Vec<f32> = self.buf[t].drain(..k).collect();
            if v.len() < n {
                // 無音の補填もタイムラインの長さに数える
                self.total[t] += n - v.len();
                v.resize(n, 0.0);
            }
            out[t] = v;
        }
        let [l, r] = out;
        (l, r)
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
    /// 録音ファイルの fileId（open_file で決まる。停止結果の fileId と同じ）
    pub file_id: String,
    pub started_at: String,
    /// 録音中の逐次文字起こしジョブ。無効・モデル未取得のときは None（録音は続く）
    pub transcribe_job_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopResult {
    pub id: String,
    /// 何も録れなかったときは None
    pub file_id: Option<String>,
    pub duration_ms: u64,
    pub dropped_packets: u64,
    /// それぞれ音声が録れたか（開けなかった・データが来なかったトラックは false）
    pub tracks: TracksFlags,
    /// 逐次文字起こしジョブ（停止後も残りを処理して meeting-transcribe-done で終わる）
    pub transcribe_job_id: Option<String>,
}

#[derive(Serialize, Clone, Copy)]
pub struct TracksFlags {
    pub system: bool,
    pub mic: bool,
}

/// 録音中の文字起こしへ流す 16 kHz mono f32 のチャンク（ミキサーが揃えた後の、WAV の各チャンネルと同じ内容）
pub struct LiveChunk {
    /// "system" / "mic"
    pub track: &'static str,
    /// 録音ファイルの fileId（stereo 1 本なので両トラックで同じ）
    pub file_id: Arc<str>,
    pub samples: Vec<f32>,
}

/// 文字起こしワーカーへの送り口。受け手が落ちていても録音は止めない（送信エラーは無視）
pub type LiveFeed = std::sync::mpsc::Sender<LiveChunk>;

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
    /// キャプチャを開始できたか
    opened: bool,
    dropped: u64,
}

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
struct Running {
    id: String,
    /// 録音ファイルの fileId（open_file 時点で決まる）
    file_id: String,
    started: Instant,
    stop: Arc<AtomicBool>,
    system: Option<JoinHandle<TrackOutcome>>,
    mic: Option<JoinHandle<TrackOutcome>>,
    mixer: Option<JoinHandle<imp::MixOutcome>>,
    ticker: Option<JoinHandle<()>>,
    transcribe_job_id: Option<String>,
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
pub fn meeting_rec_permission(request: Option<bool>, capture_system: Option<bool>) -> PermissionStatus {
    // 相手側を録らないなら画面収録は不要。granted 扱いで返し、OS のダイアログも出さない
    if capture_system == Some(false) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let _ = request;
            return PermissionStatus { screen: "granted", mic: "unknown" };
        }
    }
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

    /// stereo（左 = system、右 = mic）の WAV を作って Writer を返す
    /// （meta.json は録音終了後に write_meta で書く）。
    fn open_file(label: &str) -> Result<(String, String, Writer), String> {
        let dir: PathBuf = crate::media_dir()?;
        let file_id = uuid::Uuid::new_v4().to_string();
        let name = format!("meeting-{label}.wav");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: OUT_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let w = hound::WavWriter::create(dir.join(format!("{file_id}.wav")), spec)
            .map_err(|e| format!("WAV 作成失敗: {e}"))?;
        Ok((file_id, name, w))
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
        start_offset_ms: [u64; 2],
        tracks: [bool; 2],
    ) -> Result<(), String> {
        let dir = crate::media_dir()?;
        let meta = serde_json::json!({
            "id": file_id,
            "name": name,
            "mimeType": "audio/wav",
            "createdTime": humantime::format_rfc3339(started_wall).to_string(),
            "channels": { "left": "system", "right": "mic" },
            "startOffsetMs": { "system": start_offset_ms[SYSTEM], "mic": start_offset_ms[MIC] },
            "tracks": { "system": tracks[SYSTEM], "mic": tracks[MIC] },
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

    /// 直近チャンクの RMS を共有に残す。ticker 側が読んで 500 ms ごとに送る（最大値を保持）
    fn note_level(samples: &[f32], level: &AtomicU32) {
        let r = dsp::rms(samples);
        let cur = f32::from_bits(level.load(Ordering::Relaxed));
        if r > cur {
            level.store(r.to_bits(), Ordering::Relaxed);
        }
    }

    // ---- system ----
    pub fn spawn_system(
        app: tauri::AppHandle,
        id: String,
        stop: Arc<AtomicBool>,
        level: Arc<AtomicU32>,
        started: Instant,
        tx: mpsc::Sender<MixMsg>,
    ) -> JoinHandle<TrackOutcome> {
        std::thread::spawn(move || {
            let outcome = match run_system(&app, &id, &stop, &level, started, &tx) {
                Ok(o) => o,
                Err(msg) => {
                    emit_error(&app, &id, format!("再生音の録音を開始できません: {msg}"));
                    TrackOutcome { opened: false, dropped: 0 }
                }
            };
            let _ = tx.send(MixMsg::Closed { track: SYSTEM, opened: outcome.opened });
            outcome
        })
    }

    /// Err はキャプチャを開始できなかったとき（opened = false 扱い）
    fn run_system(
        app: &tauri::AppHandle,
        id: &str,
        stop: &AtomicBool,
        level: &AtomicU32,
        started: Instant,
        tx: &mpsc::Sender<MixMsg>,
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
        session.start().map_err(|e| e.to_string())?;

        let mut resampler: Option<(u32, dsp::Resampler)> = None;
        let mut out = Vec::<f32>::new();
        let mut first_seq: Option<u64> = None;
        let mut last_seq: Option<u64> = None;
        let mut packets = 0u64;
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
                    // 到着時刻（ミキサーが先頭の無音と startOffsetMs を決める材料）
                    let at_ms = started.elapsed().as_millis() as u64;
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
                    note_level(&out, level);
                    let _ = tx.send(MixMsg::Chunk { track: SYSTEM, at_ms, samples: std::mem::take(&mut out) });
                }
                CaptureEvent::End => {
                    emit_error(app, id, "再生音の取得が終了しました".to_string());
                    break;
                }
                _ => {}
            }
        }
        let _ = session.stop();
        if let Err(e) = result {
            emit_error(app, id, format!("再生音の録音中にエラー: {e}"));
        }
        let dropped = match (first_seq, last_seq) {
            (Some(a), Some(b)) => b.saturating_sub(a).saturating_add(1).saturating_sub(packets),
            _ => 0,
        };
        Ok(TrackOutcome { opened: true, dropped })
    }

    fn bytes_to_f32(b: &[u8]) -> Vec<f32> {
        b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
    }

    // ---- mic ----
    pub fn spawn_mic(
        app: tauri::AppHandle,
        id: String,
        stop: Arc<AtomicBool>,
        level: Arc<AtomicU32>,
        started: Instant,
        tx: mpsc::Sender<MixMsg>,
    ) -> JoinHandle<TrackOutcome> {
        std::thread::spawn(move || {
            let outcome = match run_mic(&app, &id, &stop, &level, started, &tx) {
                Ok(o) => o,
                Err(msg) => {
                    emit_error(&app, &id, format!("マイクの録音を開始できません: {msg}"));
                    TrackOutcome { opened: false, dropped: 0 }
                }
            };
            let _ = tx.send(MixMsg::Closed { track: MIC, opened: outcome.opened });
            outcome
        })
    }

    fn run_mic(
        app: &tauri::AppHandle,
        id: &str,
        stop: &AtomicBool,
        level: &AtomicU32,
        started: Instant,
        mix_tx: &mpsc::Sender<MixMsg>,
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

        if let Err(e) = stream.play() {
            drop(stream);
            return Err(e.to_string());
        }

        let mut rs = dsp::Resampler::new(rate, OUT_RATE);
        let mut out = Vec::<f32>::new();
        while !stop.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(chunk) => {
                    let at_ms = started.elapsed().as_millis() as u64;
                    out.clear();
                    rs.process(&chunk, &mut out);
                    note_level(&out, level);
                    let _ = mix_tx.send(MixMsg::Chunk { track: MIC, at_ms, samples: std::mem::take(&mut out) });
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(stream);
        Ok(TrackOutcome { opened: true, dropped: 0 })
    }

    // ---- ミキサー（2 トラックを揃えて 1 本の stereo WAV に書く）----
    /// キャプチャスレッドからミキサーへ
    pub enum MixMsg {
        /// 16 kHz mono f32。at_ms は録音開始からの到着時刻
        Chunk { track: usize, at_ms: u64, samples: Vec<f32> },
        /// そのトラックはもう来ない（opened = キャプチャを開始できたか）
        Closed { track: usize, opened: bool },
    }

    pub struct MixOutcome {
        /// 1 つもデータが来なければ None（WAV は消す）
        file_id: Option<String>,
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_mixer(
        app: tauri::AppHandle,
        id: String,
        file_id: String,
        name: String,
        writer: Writer,
        rx: mpsc::Receiver<MixMsg>,
        stop: Arc<AtomicBool>,
        started_wall: SystemTime,
        live: Option<LiveFeed>,
    ) -> JoinHandle<MixOutcome> {
        std::thread::spawn(move || {
            run_mixer(&app, &id, file_id, &name, writer, rx, &stop, started_wall, live)
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn run_mixer(
        app: &tauri::AppHandle,
        id: &str,
        file_id: String,
        name: &str,
        mut writer: Writer,
        rx: mpsc::Receiver<MixMsg>,
        stop: &AtomicBool,
        started_wall: SystemTime,
        live: Option<LiveFeed>,
    ) -> MixOutcome {
        const TRACK_NAMES: [&str; 2] = ["system", "mic"];
        let live_id: Arc<str> = Arc::from(file_id.as_str());
        let mut al = Aligner::new();
        let mut got = [false; 2];
        let mut opened = [false; 2];
        let mut closed = [false; 2];
        let mut start_offset_ms = [0u64; 2];
        let mut stop_seen: Option<Instant> = None;
        // どちらかの最初のチャンクを受けた時刻（もう片方を待つ上限の起点）
        let mut first_seen: Option<Instant> = None;
        let mut since_flush = 0usize;
        let mut write_err: Option<String> = None;

        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(MixMsg::Chunk { track, at_ms, samples }) => {
                    if !got[track] {
                        got[track] = true;
                        start_offset_ms[track] = at_ms;
                    }
                    first_seen.get_or_insert_with(Instant::now);
                    al.push(track, ms_to_samples(at_ms), &samples);
                }
                Ok(MixMsg::Closed { track, opened: o }) => {
                    opened[track] = o;
                    closed[track] = true;
                    al.close(track);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    closed = [true; 2];
                    al.close(SYSTEM);
                    al.close(MIC);
                }
            }
            // 片方の最初のチャンクから LEAD_WAIT_MS たっても他方が来なければ、無音で書き始める
            if first_seen.is_some_and(|t| t.elapsed() >= Duration::from_millis(LEAD_WAIT_MS)) {
                for t in [SYSTEM, MIC] {
                    if !got[t] {
                        al.start_silent(t);
                    }
                }
            }
            // 停止後しばらく待っても閉じないトラックは打ち切る（スレッドが固まっていても finalize できるように）
            if stop.load(Ordering::Relaxed) {
                let t = *stop_seen.get_or_insert_with(Instant::now);
                if t.elapsed() > Duration::from_millis(2500) {
                    closed = [true; 2];
                    al.close(SYSTEM);
                    al.close(MIC);
                }
            }
            let (left, right) = al.drain();
            if !left.is_empty() {
                if write_err.is_none() {
                    for s in interleave_i16(&left, &right) {
                        if let Err(e) = writer.write_sample(s) {
                            write_err = Some(format!("WAV 書き込み失敗: {e}"));
                            break;
                        }
                    }
                    if let Some(e) = &write_err {
                        emit_error(app, id, format!("録音の書き込みでエラー: {e}"));
                    }
                }
                since_flush += left.len();
                if since_flush >= OUT_RATE as usize * 5 {
                    let _ = writer.flush();
                    since_flush = 0;
                }
                // 文字起こしへは揃えた後のサンプル（先頭の無音を含む。WAV と時刻軸が一致する）
                if let Some(tx) = &live {
                    for (t, data) in [(SYSTEM, left), (MIC, right)] {
                        if got[t] {
                            let _ = tx.send(LiveChunk {
                                track: TRACK_NAMES[t],
                                file_id: live_id.clone(),
                                samples: data,
                            });
                        }
                    }
                }
            }
            if closed[SYSTEM] && closed[MIC] {
                break;
            }
        }
        let _ = writer.finalize();
        if !got[SYSTEM] && !got[MIC] {
            // 一度もデータが来なかったときは空 WAV を残さない（meta も書かない）
            remove_wav(&file_id);
            return MixOutcome { file_id: None };
        }
        let tracks = [opened[SYSTEM] && got[SYSTEM], opened[MIC] && got[MIC]];
        if let Err(e) = write_meta(&file_id, name, started_wall, start_offset_ms, tracks) {
            emit_error(app, id, format!("メタデータを保存できません: {e}"));
        }
        MixOutcome { file_id: Some(file_id) }
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

    pub fn start(
        app: tauri::AppHandle,
        state: &MeetingRecState,
        options: Option<crate::meeting_transcribe::RecOptions>,
    ) -> Result<StartResult, String> {
        let mut guard = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        if guard.is_some() {
            return Err("already recording".to_string());
        }
        // WAV を先に作る（失敗したら live ワーカーを起動しない）
        let label = timestamp_label();
        let (file_id, name, writer) = open_file(&label)?;
        // 逐次文字起こし。モデルが無ければ None（録音だけ続ける）
        let capture_system = options.as_ref().map_or(true, |o| o.capture_system);
        let (live, transcribe_job_id) = match options.filter(|o| o.live_transcribe) {
            Some(o) => match crate::meeting_transcribe::start_live(&app, &o) {
                Ok(Some((job_id, tx))) => (Some(tx), Some(job_id)),
                Ok(None) => (None, None),
                Err(e) => {
                    drop(writer);
                    remove_wav(&file_id);
                    return Err(e);
                }
            },
            None => (None, None),
        };
        let id = uuid::Uuid::new_v4().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let sys_level = Arc::new(AtomicU32::new(0));
        let mic_level = Arc::new(AtomicU32::new(0));
        let started = Instant::now();
        let started_wall = SystemTime::now();
        let started_at = humantime::format_rfc3339_seconds(started_wall).to_string();

        let (mix_tx, mix_rx) = mpsc::channel::<MixMsg>();
        let mixer = spawn_mixer(
            app.clone(),
            id.clone(),
            file_id.clone(),
            name,
            writer,
            mix_rx,
            stop.clone(),
            started_wall,
            live,
        );
        // 相手側を録らないときはスレッドを起動せず、ミキサーには「開けなかったトラック」として知らせる
        let system = if capture_system {
            Some(spawn_system(app.clone(), id.clone(), stop.clone(), sys_level.clone(), started, mix_tx.clone()))
        } else {
            let _ = mix_tx.send(MixMsg::Closed { track: SYSTEM, opened: false });
            None
        };
        let mic = spawn_mic(app.clone(), id.clone(), stop.clone(), mic_level.clone(), started, mix_tx);
        let ticker = spawn_ticker(app, id.clone(), started, stop.clone(), sys_level, mic_level);
        *guard = Some(Running {
            id: id.clone(),
            file_id: file_id.clone(),
            started,
            stop,
            system,
            mic: Some(mic),
            mixer: Some(mixer),
            ticker: Some(ticker),
            transcribe_job_id: transcribe_job_id.clone(),
        });
        Ok(StartResult { id, file_id, started_at, transcribe_job_id })
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
        // ミキサーは両トラックが閉じたら残りを揃えて finalize する（固まったトラックは自分で打ち切る）
        // 待ち切れなくてもミキサーは裏で finalize と meta を書き切るので、fileId は落とさない。
        // ミキサーが「何も録れなかった」と返したときだけ None
        let mix = running.mixer.take().map(|h| join_until(h, Instant::now() + Duration::from_secs(8)));
        let nothing = matches!(&mix, Some(Some(m)) if m.file_id.is_none());
        let file_id = if nothing { None } else { Some(running.file_id.clone()) };
        // tracks はトラックスレッドの結果から決める（ミキサー待ちに依存させない）
        let tracks = if nothing {
            [false; 2]
        } else {
            [
                sys.as_ref().map(|o| o.opened).unwrap_or(false),
                mic.as_ref().map(|o| o.opened).unwrap_or(false),
            ]
        };
        Ok(StopResult {
            id: running.id,
            file_id,
            duration_ms,
            dropped_packets: sys.as_ref().map(|o| o.dropped).unwrap_or(0)
                + mic.as_ref().map(|o| o.dropped).unwrap_or(0),
            tracks: TracksFlags { system: tracks[SYSTEM], mic: tracks[MIC] },
            transcribe_job_id: running.transcribe_job_id,
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
    options: Option<crate::meeting_transcribe::RecOptions>,
) -> Result<StartResult, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        imp::start(app, &state, options)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, state, options);
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

    // ---- ミキサーの揃え処理 ----
    use super::{interleave_i16, ms_to_samples, Aligner, MIC, SYSTEM};

    #[test]
    fn aligner_prepends_lead_silence_per_track() {
        let mut al = Aligner::new();
        // system は 10 ms 遅れ（160 サンプル）、mic は 20 ms 遅れ（320 サンプル）で最初のチャンクが届いた
        al.push(SYSTEM, ms_to_samples(10), &[1.0; 100]);
        al.push(MIC, ms_to_samples(20), &[0.5; 100]);
        assert_eq!(ms_to_samples(10), 160);
        let (l, r) = al.drain();
        // 短い方（system: 160 + 100 = 260）まで
        assert_eq!(l.len(), 260);
        assert_eq!(r.len(), 260);
        assert!(l[..160].iter().all(|&v| v == 0.0) && l[160..].iter().all(|&v| v == 1.0));
        // mic は先頭 320 サンプルが無音なので、260 サンプル目まではすべて無音
        assert!(r.iter().all(|&v| v == 0.0));
        // 残りの mic（無音 60 + 音 100）は次回へ。system が来るまで書かない
        al.push(SYSTEM, 0, &[1.0; 200]);
        let (l2, r2) = al.drain();
        assert_eq!(l2.len(), 160);
        assert!(r2[..60].iter().all(|&v| v == 0.0) && r2[60..].iter().all(|&v| v == 0.5));
    }

    #[test]
    fn aligner_waits_for_shorter_then_pads_on_close() {
        let mut al = Aligner::new();
        al.push(SYSTEM, 0, &[1.0; 50]);
        // mic の最初のチャンクがまだ → 書けない
        let (l, r) = al.drain();
        assert!(l.is_empty() && r.is_empty());
        al.push(MIC, 0, &[0.5; 30]);
        let (l, r) = al.drain();
        assert_eq!((l.len(), r.len()), (30, 30));
        // 両方閉じると短い方を無音で埋めて長い方に揃える（system の残り 20 + mic 0）
        al.close(SYSTEM);
        al.close(MIC);
        let (l, r) = al.drain();
        assert_eq!((l.len(), r.len()), (20, 20));
        assert!(l.iter().all(|&v| v == 1.0) && r.iter().all(|&v| v == 0.0));
        assert!(al.drain().0.is_empty());
    }

    #[test]
    fn aligner_closed_track_is_silent_while_other_continues() {
        let mut al = Aligner::new();
        // mic が開けなかった（データなしで閉じた）。system は書き続ける
        al.close(MIC);
        al.push(SYSTEM, 0, &[1.0; 40]);
        let (l, r) = al.drain();
        assert_eq!(l.len(), 40);
        assert!(r.iter().all(|&v| v == 0.0) && r.len() == 40);
        al.push(SYSTEM, 0, &[1.0; 10]);
        assert_eq!(al.drain().0.len(), 10);
    }

    #[test]
    fn interleave_alternates_left_right() {
        let v = interleave_i16(&[1.0, -1.0], &[0.0, 0.5]);
        assert_eq!(v.len(), 4);
        assert_eq!(v[0], i16::MAX);
        assert_eq!(v[1], 0);
        assert_eq!(v[2], -i16::MAX);
        assert!(v[3] > 16000 && v[3] < 16500);
    }

    #[test]
    fn aligner_fills_gap_over_200ms_with_silence() {
        let mut al = Aligner::new();
        al.push(SYSTEM, 0, &[1.0; 160]); // 10 ms ぶん
        al.push(MIC, 0, &[0.5; 160]);
        let _ = al.drain();
        // 次のチャンク（160 サンプル）が 3 秒後に届いた → 先頭位置は 3 秒 − 10 ms。隙間が無音で埋まる
        al.push(SYSTEM, ms_to_samples(3000), &[1.0; 160]);
        al.push(MIC, ms_to_samples(3000), &[0.5; 160]);
        let (l, r) = al.drain();
        assert_eq!(l.len(), ms_to_samples(3000) - 160); // 書き込み済み 160 の続きから 3000 ms まで
        assert!(l[..l.len() - 160].iter().all(|&v| v == 0.0));
        assert!(l[l.len() - 160..].iter().all(|&v| v == 1.0));
        assert!(r[r.len() - 160..].iter().all(|&v| v == 0.5));
    }

    #[test]
    fn aligner_ignores_gap_under_200ms_and_early_arrival() {
        let mut al = Aligner::new();
        al.push(SYSTEM, 0, &[1.0; 160]);
        al.push(MIC, 0, &[0.5; 160]);
        let _ = al.drain();
        // 150 ms 遅れ（200 ms 未満）→ 埋めない。早く来た分も何もしない
        al.push(SYSTEM, ms_to_samples(10) + ms_to_samples(150) + 160, &[1.0; 160]);
        al.push(MIC, 10, &[0.5; 160]);
        let (l, r) = al.drain();
        assert_eq!((l.len(), r.len()), (160, 160));
        assert!(l.iter().all(|&v| v == 1.0));
    }

    #[test]
    fn aligner_starts_silent_when_other_track_never_arrives() {
        let mut al = Aligner::new();
        al.push(SYSTEM, 0, &[1.0; 100]);
        assert!(al.drain().0.is_empty()); // mic の最初のチャンクを待っている
        al.start_silent(MIC);
        let (l, r) = al.drain();
        assert_eq!((l.len(), r.len()), (100, 100));
        assert!(r.iter().all(|&v| v == 0.0));
        // 遅れて届いた mic は通常扱いに戻る（補填済みの長さの続きに置く）
        al.push(MIC, 100, &[0.5; 50]);
        al.push(SYSTEM, 100, &[1.0; 50]);
        let (l, r) = al.drain();
        assert_eq!((l.len(), r.len()), (50, 50));
        assert!(r.iter().all(|&v| v == 0.5));
    }
}
