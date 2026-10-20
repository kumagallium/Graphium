//! 会議の文字起こし（whisper.cpp / whisper-rs）とモデル管理。
//!
//! - モデル: `appdata/models/whisper/ggml-<size>.bin`。Hugging Face から stream 取得し、SHA256 検証後に rename
//! - 録音中: `meeting_audio` のトラックスレッドから 16 kHz mono f32 のチャンクを mpsc で受け、
//!   20 秒たまるごとに会話の間で切って処理する（録音中の WAV は再読みしない）
//! - 既存録音: WAV を 20 秒ずつ読み、録音中と同じく会話の間で切って順に処理する
//! - 保存: `media/<fileId>.transcript.json`（構造化）と `<fileId>.txt`（`[mm:ss] text`）
//!
//! 設計: docs/internal/meeting-recorder-design-2026-10.md §2.2

use std::collections::HashMap;
use std::sync::Once;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::meeting_audio::{LiveChunk, LiveFeed};

// ---------------------------------------------------------------------------
// 定数（FAQ の数値表に載せる）
// ---------------------------------------------------------------------------
/// 窓の長さの目安（秒）。これだけ溜まったら、会話の間（WINDOW_MIN_CUT_SEC 以降で最後の、
/// 300ms 以上続く無音の真ん中）で切って処理する。
/// 間が無ければ WINDOW_FORCE_SEC まで待ち、それでも無ければいちばん静かな所で切る
pub const WINDOW_SEC: u64 = 20;
/// 窓を切る位置を探す範囲の始まり（秒）。これより手前では切らない
pub const WINDOW_MIN_CUT_SEC: u64 = 10;
/// 間が見つからないとき、ここまで溜まったら（秒）いちばん静かな所で切る
pub const WINDOW_FORCE_SEC: u64 = 40;
/// 処理が追いつかず溜まったときの窓の上限（秒）。溜まった分をまとめて 1 回で処理し、超えたら上限ずつ
pub const WINDOW_MAX_SEC: u64 = 180;
/// 窓を切る位置を探すときの音量の刻み（ミリ秒）
const CUT_FRAME_MS: usize = 100;
/// 「会話の間」とみなす、しきい値未満の刻みの連続数（3 刻み = 300ms）
const PAUSE_FRAMES: usize = 3;
/// 片の前後の無音を削るときに残す余白（秒）。1 秒の物音のために 20 秒の無音ごと渡すと、
/// whisper は無音の上に文を作る（「1分間焼き込みます」が 4 回続いた）
pub const PIECE_PAD_SEC: usize = 1;
/// 同じ言語の片を 1 つの区間にまとめるのは、片の間の無音がこれ以下（秒）のときだけ
pub const LANG_MERGE_GAP_SEC: usize = 2;
/// これより短い片（秒）は言語判定を信じきらず、トラックでほぼ使われている言語に寄せる
/// （「はい」が「Hello.」、「オッケー」が「Okay.」になった）
pub const SHORT_PIECE_SEC: usize = 6;
/// トラックの言語を決めるのに要る、判定済みの長い片の合計（秒）
pub const LANG_PRIOR_MIN_SEC: f32 = 15.0;
/// トラックの言語とみなす割合
pub const LANG_PRIOR_SHARE: f32 = 0.7;
/// 直前と同じ文（句読点・空白を除いてこの文字数以上）が同じトラックで続いたら、2 つ目以降を捨てる
pub const REPEAT_MIN_CHARS: usize = 4;
/// 言語 auto のときの判定単位（秒）。窓（無音ゲート通過後）をこの長さの片に分けて、片ごとに言語を判定する
pub const LANG_PIECE_SEC: u64 = 20;
/// 言語判定の片の最短（秒）。これより短い片は隣に併合する
/// 言語固定のとき、窓を切る片の最長（秒）。whisper.cpp は 30 秒チャンクごとに前の出力を prompt に足すので、
/// 用語のヒント（initial prompt）が確実に効くよう、30 秒未満の片ごとに full() を呼ぶ
pub const FIXED_PIECE_SEC: u64 = 28;
pub const LANG_PIECE_MIN_SEC: u64 = 2;
/// 言語判定なしの片がこの長さ（秒）未満で、隣に判定できた片があれば、その片に併合する（それ以外は捨てる）
pub const LANG_UNDETECTED_MERGE_SEC: u64 = 5;
/// 無音ゲート: 窓を 1 秒ごとに切った RMS の最大値がこれ未満なら whisper に渡さない
pub const SILENCE_RMS: f32 = 0.004;
/// 相対無音ゲート: トラックの底の音量（1 秒 RMS の 10 パーセンタイル。判定中の窓自身の 1 秒 RMS も含める）にこの倍率（+12 dB）を掛けた値も
/// しきい値にする。しきい値は max(SILENCE_RMS, min(底 × SILENCE_RATIO, SPEECH_RMS))。履歴が無い最初の窓は SILENCE_RMS だけ
pub const SILENCE_RATIO: f32 = 4.0;
/// 相対ゲートの上限（-34 dBFS）。最大がこれ以上の窓は底に関わらず必ず渡す
/// （ほとんど話しているトラックでは底が話し声の音量になり、×6 だと話し声まで skip してしまうため）。
/// 相対ゲートが効くのは -48〜-34 dBFS の静かな窓だけ
pub const SPEECH_RMS: f32 = 0.02;
/// 底の音量を求める履歴の長さ（1 秒スライスの個数 = 直近 10 分）
const FLOOR_HISTORY: usize = 600;
/// whisper に渡した結果でも、no-speech 確率がこれを超える segment は捨てる
pub const NO_SPEECH_MAX: f32 = 0.6;

const SAMPLE_RATE: usize = 16_000;
const WINDOW_SAMPLES: usize = WINDOW_SEC as usize * SAMPLE_RATE;
const WINDOW_MAX_SAMPLES: usize = WINDOW_MAX_SEC as usize * SAMPLE_RATE;
/// 取り消しを表す内部の目印（エラーではない）
const CANCELLED: &str = "cancelled";
/// whisper.cpp は 1 秒未満の入力を処理しないので、足りない分は無音で埋める
const MIN_SAMPLES: usize = SAMPLE_RATE + SAMPLE_RATE / 10;
const MODEL_ENGINE: &str = "whisper.cpp";

/// 設計書 §2.2 のモデル定義（size, SHA256, サイズ）
const MODELS: [(&str, &str, u64); 3] = [
    ("small", "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b", 487_601_967),
    // 高精度。ファイル名は ggml-large-v3-turbo-q5_0.bin（model_file_name で size から引く）
    ("large-v3-turbo", "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", 574_041_195),
    ("base", "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe", 147_951_465),
];

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub no_speech_prob: Option<f32>,
    /// "system"（相手）/ "mic"（自分）。トラックが分からない古い mono 録音は null
    pub track: Option<String>,
    /// 文字起こしに使った言語コード（"ja" / "en"）。判定できなかった区間は null
    pub language: Option<String>,
}

fn default_true() -> bool {
    true
}

/// `meeting_rec_start` の追加オプション
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecOptions {
    pub live_transcribe: bool,
    /// false なら相手側（再生音）を録らない。左チャンネルは無音、tracks.system は false
    #[serde(default = "default_true")]
    pub capture_system: bool,
    pub language: String,
    pub model_size: String,
    /// 用語のヒント（whisper の initial prompt）。ノートのタイトルや設定の用語をカンマ区切りで
    #[serde(default)]
    pub vocabulary: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartJobResult {
    pub job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub size: &'static str,
    pub present: bool,
    pub bytes: u64,
    pub expected_bytes: u64,
}

#[derive(Default)]
pub struct TranscribeState {
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 処理中の fileId → jobId（同じ素材の二重処理を防ぐ）
    files: Mutex<HashMap<String, String>>,
}

// ---------------------------------------------------------------------------
// 純関数（実モデル無しでテストできる部分）
// ---------------------------------------------------------------------------
/// 窓の区間 `[start, end)` を前から切る。最後の窓は端数のまま
fn split_windows(total: usize, window: usize) -> Vec<(usize, usize)> {
    let mut v = Vec::new();
    let mut s = 0;
    while s < total {
        let e = (s + window).min(total);
        v.push((s, e));
        s = e;
    }
    v
}

/// 窓を言語判定の片に分ける（単位は秒 = 1 秒スライスの添字）。
/// 1 秒 RMS が threshold 未満のスライスを無音とみなし、無音の連続区間の中央で切る
/// （窓の端に接する無音は切らない）。片は最長 LANG_PIECE_SEC（無音が無ければ 20 秒で切る）、
/// 最短 LANG_PIECE_MIN_SEC（短すぎる片は隣に併合）
#[cfg(test)]
fn split_pieces_at_silence(slice_rms: &[f32], threshold: f32) -> Vec<(usize, usize)> {
    split_pieces_at_silence_max(slice_rms, threshold, LANG_PIECE_SEC as usize)
}

/// `split_pieces_at_silence` の最長（秒）を指定する版
fn split_pieces_at_silence_max(slice_rms: &[f32], threshold: f32, max: usize) -> Vec<(usize, usize)> {
    let n = slice_rms.len();
    let min = LANG_PIECE_MIN_SEC as usize;
    // 無音の連続区間の中央を切り位置の候補にする
    let mut cuts = Vec::new();
    let mut i = 0;
    while i < n {
        if slice_rms[i] < threshold {
            let a = i;
            while i < n && slice_rms[i] < threshold {
                i += 1;
            }
            if a > 0 && i < n {
                cuts.push((a + i) / 2);
            }
        } else {
            i += 1;
        }
    }
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mut start = 0;
    for c in cuts {
        while c - start > max {
            out.push((start, start + max));
            start += max;
        }
        if c - start >= min {
            out.push((start, c));
            start = c;
        }
    }
    while n - start > max {
        out.push((start, start + max));
        start += max;
    }
    if start < n {
        match out.last_mut() {
            Some(last) if n - start < min => last.1 = n,
            _ => out.push((start, n)),
        }
    }
    out
}

/// 窓を無音の中央で最長 `max_sec` 秒の片に切り、サンプル位置にする（最後の片は窓の端まで）
fn piece_samples(window: &[f32], threshold: f32, max_sec: usize) -> Vec<(usize, usize)> {
    let slices = slice_rms(window);
    split_pieces_at_silence_max(&slices, threshold, max_sec)
        .into_iter()
        .map(|(s, e)| (s * SAMPLE_RATE, if e >= slices.len() { window.len() } else { e * SAMPLE_RATE }))
        .collect()
}

/// 窓を片に切り、片ごとに前後の無音を削って（PIECE_PAD_SEC の余白は残す）返す。音のない片は返さない。
/// 片の中の 1 秒 RMS が threshold 以上の範囲だけを whisper に渡す
fn active_pieces(window: &[f32], threshold: f32, max_sec: usize) -> Vec<(usize, usize)> {
    // 端数の 1 秒も測る（窓の最後の端数に話し声があっても削らない）
    let slices: Vec<f32> = window.chunks(SAMPLE_RATE).map(rms).collect();
    piece_samples(window, threshold, max_sec)
        .into_iter()
        .filter_map(|(s, e)| {
            let a = s / SAMPLE_RATE;
            let b = e.div_ceil(SAMPLE_RATE).min(slices.len());
            let first = (a..b).find(|&i| slices[i] >= threshold)?;
            let last = (a..b).rev().find(|&i| slices[i] >= threshold)?;
            let ts = s.max(first.saturating_sub(PIECE_PAD_SEC) * SAMPLE_RATE);
            let te = e.min((last + 1 + PIECE_PAD_SEC) * SAMPLE_RATE);
            (te > ts).then_some((ts, te))
        })
        .collect()
}

/// 短い片の判定を、トラックでほぼ使われている言語に寄せる。
/// `prior` はこれまでの長い片の言語ごとの合計秒数。合計が LANG_PRIOR_MIN_SEC 以上で、
/// 1 つの言語が LANG_PRIOR_SHARE 以上を占めるときだけ寄せる（判定なしの片はそのまま）
fn apply_language_prior(
    pieces: &[(usize, usize)],
    langs: &mut [Option<String>],
    prior: &HashMap<String, f32>,
) {
    let total: f32 = prior.values().sum();
    if total < LANG_PRIOR_MIN_SEC {
        return;
    }
    let Some((main, secs)) = prior.iter().max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
    else {
        return;
    };
    if secs / total < LANG_PRIOR_SHARE {
        return;
    }
    for (i, &(s, e)) in pieces.iter().enumerate() {
        if e - s < SHORT_PIECE_SEC * SAMPLE_RATE {
            if let Some(l) = langs[i].as_mut() {
                if l != main {
                    *l = main.clone();
                }
            }
        }
    }
}

/// 句読点・空白を除いて小文字化した形（定型句・繰り返しの比較用）
fn normalize_text(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric() || !(c.is_whitespace() || c.is_ascii_punctuation() || is_cjk_punct(*c)))
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// 直前と同じ文の繰り返しを捨てる（whisper は無音に近い区間で同じ文を何度も出す）。
/// `last` は同じトラックの直前の文（正規化済み）で、残した segment で更新する
fn drop_repeats(segs: &mut Vec<Segment>, last: &mut Option<String>) {
    segs.retain(|seg| {
        let norm = normalize_text(&seg.text);
        let repeat = norm.chars().count() >= REPEAT_MIN_CHARS && last.as_deref() == Some(norm.as_str());
        if repeat {
            // 実機で効きを追えるようにログへ
            eprintln!("[meeting_transcribe] 繰り返しを捨てた: start_ms={} text={}", seg.start_ms, seg.text);
        } else {
            *last = Some(norm);
        }
        !repeat
    });
}

/// 片ごとの判定結果から文字起こしの区間を作る。
/// 判定なし（None = ja/en 以外・失敗・無音）の片は雑音とみなして捨てる。ただし長さが
/// LANG_UNDETECTED_MERGE_SEC（5 秒）未満で、直前か直後に判定できた片があれば、その片（直前を優先）に併合する。
/// 連続して同じ言語の片は 1 つの区間にまとめる（捨てた片はまたがない。片の間の無音が LANG_MERGE_GAP_SEC を
/// 超えるときもまとめない）。pieces はサンプル単位
fn group_languages(pieces: &[(usize, usize)], langs: &[Option<String>]) -> Vec<(usize, usize, String)> {
    let merge_below = LANG_UNDETECTED_MERGE_SEC as usize * SAMPLE_RATE;
    let detected = |i: usize| langs.get(i).cloned().flatten();
    let resolved: Vec<Option<String>> = pieces
        .iter()
        .enumerate()
        .map(|(i, &(s, e))| {
            detected(i).or_else(|| {
                if e - s >= merge_below {
                    return None;
                }
                i.checked_sub(1).and_then(detected).or_else(|| detected(i + 1))
            })
        })
        .collect();
    let mut out: Vec<(usize, usize, String)> = Vec::new();
    let mut open = false;
    for (i, &(s, e)) in pieces.iter().enumerate() {
        match resolved[i].clone() {
            None => open = false,
            Some(lang) => match out.last_mut() {
                Some(last) if open && last.2 == lang && s <= last.1 + LANG_MERGE_GAP_SEC * SAMPLE_RATE => last.1 = e,
                _ => {
                    out.push((s, e, lang));
                    open = true;
                }
            },
        }
    }
    out
}

/// 溜まったバッファ（`frames` は CUT_FRAME_MS ごとの RMS、`len` はサンプル数）から 1 回で処理する長さ。
/// 0 はまだ処理しない。窓（20 秒）が溜まったら、10 秒以降・上限（180 秒）以内で最後の無音の刻みで切る
/// （発言の途中で窓が切れると、切れ目の前後の語が崩れる）。無音が無ければ 40 秒（上限を超えていれば上限）まで待ち、
/// それでも無ければ範囲内でいちばん静かな刻みで切る。`force` は停止後の残り（待たずに切る。上限以内なら全部）
fn take_at_pause(frames: &[f32], len: usize, threshold: f32, force: bool) -> usize {
    let frame = SAMPLE_RATE * CUT_FRAME_MS / 1000;
    if force && len <= WINDOW_MAX_SAMPLES {
        return len;
    }
    if !force && len < WINDOW_SAMPLES {
        return 0;
    }
    let limit = len.min(WINDOW_MAX_SAMPLES);
    // 刻み [lo, hi) の中で探す。hi の刻みは limit を超えない
    let lo = WINDOW_MIN_CUT_SEC as usize * 1000 / CUT_FRAME_MS;
    let hi = (limit / frame).min(frames.len());
    // 最後の「間」（しきい値未満の刻みが PAUSE_FRAMES 以上続く所）の真ん中で切る。
    // 1 刻み（100ms）だけ静かな語の切れ目では切らない
    let mut i = hi;
    while i > lo {
        i -= 1;
        if frames[i] < threshold {
            let end = i + 1;
            let mut start = i;
            while start > lo && frames[start - 1] < threshold {
                start -= 1;
            }
            if end - start >= PAUSE_FRAMES {
                return ((start + end) / 2 * frame).max(1);
            }
            i = start;
        }
    }
    if !force && len < WINDOW_FORCE_SEC as usize * SAMPLE_RATE && len < WINDOW_MAX_SAMPLES {
        return 0;
    }
    if lo < hi {
        // いちばん静かな刻み（同じなら後ろ）
        let i = (lo..hi)
            .rev()
            .min_by(|&a, &b| frames[a].partial_cmp(&frames[b]).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(hi - 1);
        return (i * frame).max(1);
    }
    limit
}

/// CUT_FRAME_MS ごとの RMS（端数の刻みは含めない）
fn frame_rms(samples: &[f32]) -> Vec<f32> {
    samples.chunks_exact(SAMPLE_RATE * CUT_FRAME_MS / 1000).map(rms).collect()
}

/// インターリーブされたサンプルから最大 `frames` フレームを読み、チャンネルごとの列に分ける。
/// 途中で終わったフレームの端数は捨てる（返す列の長さは必ず揃う）
fn read_frames<I: Iterator<Item = Result<i16, hound::Error>>>(
    it: &mut I,
    ch: usize,
    frames: usize,
) -> Result<Vec<Vec<f32>>, String> {
    let mut out: Vec<Vec<f32>> = (0..ch).map(|_| Vec::with_capacity(frames)).collect();
    'frames: for _ in 0..frames {
        let mut frame = Vec::with_capacity(ch);
        for _ in 0..ch {
            match it.next() {
                Some(Ok(v)) => frame.push(v as f32 / 32768.0),
                Some(Err(err)) => return Err(format!("WAV 読み込み失敗: {err}")),
                None => break 'frames,
            }
        }
        for (o, v) in out.iter_mut().zip(frame) {
            o.push(v);
        }
    }
    Ok(out)
}

/// 録音中のバッファから、処理できる窓を取り出す（溜まっていなければ空）
fn drain_live_windows(buf: &mut Vec<f32>, floor: &FloorTracker) -> Vec<Vec<f32>> {
    drain_windows(buf, gate_threshold(floor.floor()), false)
}

/// 停止後の残りを、会話の間で上限以内の窓に切って取り出す
fn drain_rest(buf: &mut Vec<f32>, floor: &FloorTracker) -> Vec<Vec<f32>> {
    drain_windows(buf, gate_threshold(floor.floor()), true)
}

fn drain_windows(buf: &mut Vec<f32>, threshold: f32, force: bool) -> Vec<Vec<f32>> {
    let mut out = Vec::new();
    while !buf.is_empty() {
        // 探す範囲（上限まで）だけ音量を測る
        let frames = frame_rms(&buf[..buf.len().min(WINDOW_MAX_SAMPLES)]);
        let n = take_at_pause(&frames, buf.len(), threshold, force);
        if n == 0 {
            break;
        }
        out.push(buf.drain(..n).collect());
    }
    out
}

/// 文字（英数字・かな・漢字など）を 1 つでも含むか。「ー」「—」「...」「♪」だけの残りかすを捨てる
fn has_speech_text(text: &str) -> bool {
    // 長音符「ー」（U+30FC）は Unicode 上は文字（Lm）だが、単独の残りかすなので文字に数えない
    text.trim().chars().any(|c| c.is_alphanumeric() && c != 'ー')
}

/// whisper が無音に近い区間で出しがちな定型句（句読点・空白を除いて小文字化した形）
const STOCK_HALLUCINATIONS: &[&str] = &[
    "thankyou",
    "thankyouforwatching",
    "thanksforwatching",
    "pleasesubscribe",
    "ご視聴ありがとうございました",
    "チャンネル登録をお願いします",
    "チャンネル登録お願いします",
    "高評価チャンネル登録をお願いします",
    "最後までご視聴いただきありがとうございました",
];

/// 句読点と空白を除いて小文字化した全文が、既知の定型句に完全一致するか（部分一致はしない）
fn is_stock_hallucination(text: &str) -> bool {
    STOCK_HALLUCINATIONS.contains(&normalize_text(text).as_str())
}

/// 全角の句読点・記号（。、！？「」…・ など）
fn is_cjk_punct(c: char) -> bool {
    matches!(c, '\u{3000}'..='\u{303F}' | '\u{FF01}'..='\u{FF0F}' | '\u{FF1A}'..='\u{FF20}' | '\u{2010}'..='\u{2027}' | '\u{30FB}')
}

/// 定型句の幻聴を捨てる条件: 定型句に完全一致し、かつ片の 1 秒 RMS の最大がゲートのしきい値の 2 倍未満。
/// はっきり話された「Thank you」は残す
fn should_drop_stock(text: &str, piece_max_rms: f32, threshold: f32) -> bool {
    piece_max_rms < threshold * 2.0 && is_stock_hallucination(text)
}

/// 1 秒 RMS の最大
fn max_slice_rms(samples: &[f32]) -> f32 {
    slice_rms(samples).iter().copied().fold(0.0f32, f32::max)
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

/// 1 秒ごとの RMS（最後の 1 秒に満たない端数は含めない。ただし全体が 1 秒未満ならその 1 つ）
fn slice_rms(samples: &[f32]) -> Vec<f32> {
    let mut v: Vec<f32> = samples.chunks_exact(SAMPLE_RATE).map(rms).collect();
    if v.is_empty() && !samples.is_empty() {
        v.push(rms(samples));
    }
    v
}

/// 無音ゲートのしきい値 max(SILENCE_RMS, min(底 × SILENCE_RATIO, SPEECH_RMS))
fn gate_threshold(floor: Option<f32>) -> f32 {
    floor.map_or(SILENCE_RMS, |f| SILENCE_RMS.max((f * SILENCE_RATIO).min(SPEECH_RMS)))
}

/// 窓を whisper に渡す条件: 窓内の 1 秒 RMS の最大が max(SILENCE_RMS, 底 × SILENCE_RATIO) 以上。
/// 底が None（履歴なし）なら絶対しきい値だけで判定する
fn passes_gate_rel(slices: &[f32], floor: Option<f32>) -> bool {
    slices.iter().copied().fold(0.0f32, f32::max) >= gate_threshold(floor)
}

/// 絶対しきい値だけの無音ゲート（履歴なしの窓と同じ判定）
#[cfg(test)]
fn passes_gate(samples: &[f32]) -> bool {
    passes_gate_rel(&slice_rms(samples), None)
}

/// トラックごとの底の音量。これまで処理した 1 秒 RMS の 10 パーセンタイル（直近 FLOOR_HISTORY 個）
#[derive(Default)]
struct FloorTracker {
    hist: std::collections::VecDeque<f32>,
}

impl FloorTracker {
    fn floor(&self) -> Option<f32> {
        if self.hist.is_empty() {
            return None;
        }
        let mut v: Vec<f32> = self.hist.iter().copied().collect();
        v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        Some(v[(v.len() - 1) / 10])
    }

    /// 判定のあとに、その窓の 1 秒 RMS を履歴へ足す（skip した窓も足す。底は静かな部分を知るためのもの）
    fn add(&mut self, slices: &[f32]) {
        for &r in slices {
            if self.hist.len() == FLOOR_HISTORY {
                self.hist.pop_front();
            }
            self.hist.push_back(r);
        }
    }
}

/// 窓のオフセット（ms）+ whisper のセンチ秒 → 録音開始からの絶対 ms
fn abs_ms(offset_ms: u64, centisec: i64) -> u64 {
    offset_ms + (centisec.max(0) as u64) * 10
}

/// サンプル位置 → ms
fn samples_to_ms(samples: usize) -> u64 {
    samples as u64 * 1000 / SAMPLE_RATE as u64
}

/// `[mm:ss] them: text` / `[mm:ss] me: text` を改行区切りで並べる（言語非依存の英語ラベル）。
/// track が null なら `[mm:ss] text`。mm は 60 を超えてもそのまま分で表す
fn render_plain(segments: &[Segment]) -> String {
    let mut out = String::new();
    for s in segments {
        let sec = s.start_ms / 1000;
        let who = match s.track.as_deref() {
            Some("system") => "them: ",
            Some("mic") => "me: ",
            _ => "",
        };
        out.push_str(&format!("[{:02}:{:02}] {}{}\n", sec / 60, sec % 60, who, s.text));
    }
    out
}

/// `<fileId>.meta.json` の name 末尾からトラック種別を判定する
fn track_from_name(name: &str) -> Option<&'static str> {
    if name.ends_with("-system.wav") {
        Some("system")
    } else if name.ends_with("-mic.wav") {
        Some("mic")
    } else {
        None
    }
}

/// ファイル名に使う ID の検証（区切り文字・NUL・先頭ドットを拒否）
fn valid_id(id: &str) -> bool {
    !(id.is_empty() || id.contains('/') || id.contains('\\') || id.contains('\0') || id.starts_with('.'))
}

fn model_spec(size: &str) -> Result<(&'static str, &'static str, u64), String> {
    MODELS.iter().copied().find(|m| m.0 == size).ok_or_else(|| format!("unknown model size: {size}"))
}

fn check_language(language: &str) -> Result<(), String> {
    match language {
        "auto" | "ja" | "en" => Ok(()),
        other => Err(format!("unknown language: {other}")),
    }
}

// ---------------------------------------------------------------------------
// モデル管理
// ---------------------------------------------------------------------------
fn models_dir() -> Result<PathBuf, String> {
    let dir = crate::appdata_dir()?.join("models").join("whisper");
    std::fs::create_dir_all(&dir).map_err(|e| format!("モデルフォルダを作れません: {e}"))?;
    Ok(dir)
}

/// モデルのファイル名。large-v3-turbo は量子化版（q5_0）を使う
fn model_file_name(size: &str) -> String {
    match size {
        "large-v3-turbo" => "ggml-large-v3-turbo-q5_0.bin".to_string(),
        other => format!("ggml-{other}.bin"),
    }
}

/// 用語のヒントの最大文字数（initial prompt は 224 トークンまで。日本語は 1 文字 1 トークン近いので余裕を見る）
const VOCABULARY_MAX_CHARS: usize = 160;

/// 制御文字を除き（改行・タブは空白に。NUL は set_initial_prompt が panic する）、前後の空白を除いて、
/// 末尾側の 160 文字を残す（whisper.cpp は prompt の末尾側を残すため。先頭はノートのタイトル、
/// 末尾が設定の用語なので、あふれたらタイトル側が落ちる）。空なら None
fn normalize_vocabulary(v: Option<&str>) -> Option<String> {
    let cleaned: String = v?
        .chars()
        .filter_map(|c| match c {
            '\n' | '\r' | '\t' => Some(' '),
            c if c.is_control() => None,
            c => Some(c),
        })
        .collect();
    let t = cleaned.trim();
    if t.is_empty() {
        return None;
    }
    let n = t.chars().count();
    let tail: String = t.chars().skip(n.saturating_sub(VOCABULARY_MAX_CHARS)).collect();
    let tail = tail.trim();
    (!tail.is_empty()).then(|| tail.to_string())
}

fn model_path(size: &str) -> Result<PathBuf, String> {
    Ok(models_dir()?.join(model_file_name(size)))
}

fn model_present(size: &str) -> bool {
    let Ok((_, _, expected)) = model_spec(size) else { return false };
    model_path(size)
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len() == expected)
        .unwrap_or(false)
}

#[tauri::command]
pub fn meeting_model_status() -> Result<Vec<ModelStatus>, String> {
    let dir = models_dir()?;
    Ok(MODELS
        .iter()
        .map(|&(size, _, expected)| {
            let bytes = std::fs::metadata(dir.join(model_file_name(size))).map(|m| m.len()).unwrap_or(0);
            ModelStatus { size, present: bytes == expected, bytes, expected_bytes: expected }
        })
        .collect())
}

async fn download_model(
    app: &tauri::AppHandle,
    size: &str,
    sha: &str,
    expected: u64,
    cancel: &AtomicBool,
) -> Result<(), String> {
    use futures_util::StreamExt;

    // reqwest（rustls-no-provider）は既定の暗号プロバイダが無いと Client 作成で panic する。
    // 1 回だけ ring を入れる（既に入っていれば Err なので無視）
    static TLS_INIT: Once = Once::new();
    TLS_INIT.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });

    let final_path = model_path(size)?;
    let part_path = final_path.with_extension("bin.part");
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", model_file_name(size));
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("モデルの取得に失敗: {e}"))?;
    let resp = client.get(&url).send().await.map_err(|e| format!("モデルの取得に失敗: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("モデルの取得に失敗: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(expected);

    let result = async {
        let mut file = std::fs::File::create(&part_path).map_err(|e| format!("書き込み失敗: {e}"))?;
        let mut hasher = Sha256::new();
        let mut received: u64 = 0;
        let mut last_emit: u64 = 0;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                return Err(CANCELLED.to_string());
            }
            let chunk = chunk.map_err(|e| format!("モデルの取得中に切断: {e}"))?;
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| format!("書き込み失敗: {e}"))?;
            received += chunk.len() as u64;
            if received - last_emit >= 1_000_000 {
                last_emit = received;
                let _ = app.emit(
                    "meeting-model-progress",
                    serde_json::json!({ "size": size, "received": received, "total": total }),
                );
            }
        }
        // ストリームが終わった直後の取り消しも拾う（検証・rename に進まない）
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        file.flush().map_err(|e| format!("書き込み失敗: {e}"))?;
        drop(file);
        let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if digest != sha {
            return Err("checksum mismatch".to_string());
        }
        Ok(())
    }
    .await;

    match result {
        Ok(()) => std::fs::rename(&part_path, &final_path).map_err(|e| format!("モデルの保存に失敗: {e}")),
        Err(e) => {
            let _ = std::fs::remove_file(&part_path);
            Err(e)
        }
    }
}

/// downloads への登録を Drop で外す（panic や早期 return でも残さない）
struct DownloadGuard<'a> {
    state: &'a TranscribeState,
    size: &'static str,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut d) = self.state.downloads.lock() {
            d.remove(self.size);
        }
    }
}

#[tauri::command]
pub async fn meeting_model_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, TranscribeState>,
    size: String,
) -> Result<(), String> {
    let (size_s, sha, expected) = model_spec(&size)?;
    if model_present(size_s) {
        let _ = app.emit("meeting-model-done", serde_json::json!({ "size": size_s }));
        return Ok(());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut d = state.downloads.lock().map_err(|_| "state poisoned".to_string())?;
        if d.contains_key(size_s) {
            return Err("already downloading".to_string());
        }
        d.insert(size_s.to_string(), cancel.clone());
    }
    let _guard = DownloadGuard { state: &state, size: size_s };
    match download_model(&app, size_s, sha, expected, &cancel).await {
        Ok(()) => {
            let _ = app.emit("meeting-model-done", serde_json::json!({ "size": size_s }));
            Ok(())
        }
        // 取り消しはエラーではない
        Err(e) if e == CANCELLED => {
            let _ = app.emit("meeting-model-cancelled", serde_json::json!({ "size": size_s }));
            Ok(())
        }
        Err(message) => {
            let _ = app.emit(
                "meeting-model-error",
                serde_json::json!({ "size": size_s, "message": message }),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn meeting_model_cancel(state: tauri::State<'_, TranscribeState>, size: String) -> Result<(), String> {
    model_spec(&size)?;
    if let Some(flag) = state.downloads.lock().map_err(|_| "state poisoned".to_string())?.get(&size) {
        flag.store(true, Ordering::Relaxed);
    }
    // 中断された .part は download_model 側が消す。残っていた場合に備えてここでも消す
    if let Ok(p) = model_path(&size) {
        let _ = std::fs::remove_file(p.with_extension("bin.part"));
    }
    Ok(())
}

/// 取得中なら取り消して（meeting-model-cancelled）から消す
#[tauri::command]
pub fn meeting_model_delete(state: tauri::State<'_, TranscribeState>, size: String) -> Result<(), String> {
    model_spec(&size)?;
    if let Some(flag) = state.downloads.lock().map_err(|_| "state poisoned".to_string())?.get(&size) {
        flag.store(true, Ordering::Relaxed);
    }
    let p = model_path(&size)?;
    for path in [p.clone(), p.with_extension("bin.part")] {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("モデルを削除できません: {e}"))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// whisper 呼び出し（macOS / Windows のみ）
// ---------------------------------------------------------------------------
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod engine {
    use super::*;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

    /// 1 ジョブで共有する WhisperContext
    pub struct Engine {
        ctx: WhisperContext,
    }

    /// トラックごとの WhisperState
    pub struct TrackState(WhisperState);

    impl Engine {
        pub fn load(path: &std::path::Path) -> Result<Self, String> {
            // whisper.cpp / ggml のログを標準出力に垂れ流さない
            whisper_rs::install_logging_hooks();
            let p = path.to_str().ok_or_else(|| "model path is not utf-8".to_string())?;
            // GPU は既定（macOS は Metal）。失敗時に CPU へ落とさずエラーにする
            let ctx = WhisperContext::new_with_params(p, WhisperContextParameters::default())
                .map_err(|e| format!("モデルを読み込めません: {e}"))?;
            Ok(Self { ctx })
        }

        pub fn new_track(&self) -> Result<TrackState, String> {
            self.ctx.create_state().map(TrackState).map_err(|e| format!("whisper state の作成に失敗: {e}"))
        }

        /// 言語判定だけを走らせる。判定できない・ja/en 以外なら None
        /// （set_detect_language(true) は判定だけして文字起こしを返さない）
        pub fn detect_language(&self, st: &mut TrackState, samples: &[f32]) -> Option<String> {
            let mut padded;
            let input: &[f32] = if samples.len() < MIN_SAMPLES {
                padded = samples.to_vec();
                padded.resize(MIN_SAMPLES, 0.0);
                &padded
            } else {
                samples
            };
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(None);
            params.set_detect_language(true);
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4));
            st.0.full(params, input).ok()?;
            let code = whisper_rs::get_lang_str(st.0.full_lang_id_from_state())?;
            matches!(code, "ja" | "en").then(|| code.to_string())
        }

        /// 1 窓を文字起こしする。`offset_ms` は窓の録音開始からの位置
        pub fn transcribe(
            &self,
            st: &mut TrackState,
            samples: &[f32],
            offset_ms: u64,
            language: &str,
            vocabulary: Option<&str>,
        ) -> Result<Vec<Segment>, String> {
            let mut padded;
            let input: &[f32] = if samples.len() < MIN_SAMPLES {
                padded = samples.to_vec();
                padded.resize(MIN_SAMPLES, 0.0);
                &padded
            } else {
                samples
            };
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            // "auto" は言語を指定しない（= 自動判定して文字起こしする。窓内の言語切り替えは呼び出し側が
            // 片ごとの判定で区間に分けて、区間ごとに言語を指定する）。
            // 文字起こしでは set_detect_language(true) は使わない（判定だけして結果を返さないため）
            params.set_language(if language == "auto" { None } else { Some(language) });
            params.set_translate(false);
            // 前の窓の出力を次の窓のプロンプトにしない（「2. …」「3. …」と番号が続く幻聴の連鎖を断つ）
            params.set_no_context(true);
            // 用語のヒント。文脈（前の窓の出力）ではなく、窓ごとに同じ用語を渡す
            if let Some(v) = vocabulary {
                params.set_initial_prompt(v);
            }
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_no_speech_thold(NO_SPEECH_MAX);
            params.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4));
            st.0.full(params, input).map_err(|e| format!("文字起こしに失敗: {e}"))?;

            let mut out = Vec::new();
            for seg in st.0.as_iter() {
                // 注意: no_speech_probability() は whisper.cpp のデコード単位（最大 30 秒）ごとの値で、
                // segment ごとの値ではない。同じデコード単位の segment は同じ値になる
                let p = seg.no_speech_probability();
                if p > NO_SPEECH_MAX {
                    continue;
                }
                let text = seg.to_str_lossy().map_err(|e| e.to_string())?.trim().to_string();
                if !has_speech_text(&text) {
                    continue;
                }
                out.push(Segment {
                    start_ms: abs_ms(offset_ms, seg.start_timestamp()),
                    end_ms: abs_ms(offset_ms, seg.end_timestamp()),
                    text,
                    no_speech_prob: Some(p),
                    track: None,
                    language: None,
                });
            }
            Ok(out)
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod engine {
    use super::*;

    pub struct Engine;
    pub struct TrackState;

    impl Engine {
        pub fn load(_path: &std::path::Path) -> Result<Self, String> {
            Err("unsupported platform".to_string())
        }
        pub fn new_track(&self) -> Result<TrackState, String> {
            Err("unsupported platform".to_string())
        }
        pub fn detect_language(&self, _st: &mut TrackState, _samples: &[f32]) -> Option<String> {
            None
        }
        pub fn transcribe(
            &self,
            _st: &mut TrackState,
            _samples: &[f32],
            _offset_ms: u64,
            _language: &str,
            _vocabulary: Option<&str>,
        ) -> Result<Vec<Segment>, String> {
            Err("unsupported platform".to_string())
        }
    }
}

use engine::{Engine, TrackState};

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------
/// `<path>.tmp` に書いてから rename する（途中で落ちても壊れたファイルを残さない）
fn write_atomic(path: &std::path::Path, contents: &[u8]) -> Result<(), String> {
    // ドット始まりにして、`<id>.` 接頭辞で本体を探す処理に拾われないようにする
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    std::fs::write(&tmp, contents).map_err(|e| format!("書き込み失敗: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("書き込み失敗: {e}")
    })
}

fn transcript_json(language: &str, size: &str, segments: &[Segment]) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "language": language,
        "engine": MODEL_ENGINE,
        "model": format!("ggml-{size}"),
        "windowSec": WINDOW_SEC,
        "channels": { "left": "system", "right": "mic" },
        "segments": segments,
    })
}

/// 構造化 JSON と平文を上書き保存する（窓ごとに呼ぶので途中で落ちても残る）
fn persist(file_id: &str, language: &str, size: &str, segments: &[Segment]) -> Result<(), String> {
    let json = serde_json::to_string(&transcript_json(language, size, segments)).map_err(|e| e.to_string())?;
    save_media_transcript(file_id.to_string(), json)?;
    // OCR などと同じ media/<fileId>.txt。save_media_text は直接書くので使わず、tmp + rename で書く
    let txt = crate::media_dir()?.join(format!("{file_id}.txt"));
    write_atomic(&txt, render_plain(segments).as_bytes())
}

#[tauri::command]
pub fn save_media_transcript(file_id: String, json: String) -> Result<(), String> {
    if !valid_id(&file_id) {
        return Err("不正なファイル ID".to_string());
    }
    let path = crate::media_dir()?.join(format!("{file_id}.transcript.json"));
    write_atomic(&path, json.as_bytes()).map_err(|e| format!("文字起こしの{e}"))
}

#[tauri::command]
pub fn read_media_transcript(file_id: String) -> Result<Option<String>, String> {
    if !valid_id(&file_id) {
        return Err("不正なファイル ID".to_string());
    }
    let path = crate::media_dir()?.join(format!("{file_id}.transcript.json"));
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| format!("文字起こしの読み取り失敗: {e}"))
}

/// 付属ファイル（清書・要約）のファイル名。kind は "cleanup" / "summary" だけ
fn sidecar_path_name(file_id: &str, kind: &str) -> Result<String, String> {
    if !valid_id(file_id) {
        return Err("不正なファイル ID".to_string());
    }
    match kind {
        "cleanup" | "summary" => Ok(format!("{file_id}.{kind}.json")),
        _ => Err(format!("不正な種類: {kind}")),
    }
}

/// 清書・要約の JSON を `media/<fileId>.cleanup.json` / `.summary.json` に保存する
#[tauri::command]
pub fn save_media_sidecar(file_id: String, kind: String, json: String) -> Result<(), String> {
    let name = sidecar_path_name(&file_id, &kind)?;
    let path = crate::media_dir()?.join(name);
    write_atomic(&path, json.as_bytes()).map_err(|e| format!("付属ファイルの{e}"))
}

/// 清書・要約の JSON を読む。無ければ None
#[tauri::command]
pub fn read_media_sidecar(file_id: String, kind: String) -> Result<Option<String>, String> {
    let name = sidecar_path_name(&file_id, &kind)?;
    let path = crate::media_dir()?.join(name);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| format!("付属ファイルの読み取り失敗: {e}"))
}

// ---------------------------------------------------------------------------
// ジョブ
// ---------------------------------------------------------------------------
/// ジョブの結末。終端イベントは done / error / cancelled のどれか 1 つだけ出す
enum Outcome {
    Done(Vec<String>),
    Error(String),
    Cancelled,
}

/// ジョブの文脈（イベントと保存に必要なもの）
struct JobCtx {
    app: tauri::AppHandle,
    job_id: String,
    language: String,
    size: String,
    /// 用語のヒント（正規化済み）
    vocabulary: Option<String>,
    cancel: Arc<AtomicBool>,
}

impl JobCtx {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.app.emit(event, payload);
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// 処理する fileId を登録する。他のジョブが処理中なら Err
    fn claim_file(&self, file_id: &str) -> Result<(), String> {
        let state = self.app.state::<TranscribeState>();
        let mut files = state.files.lock().map_err(|_| "state poisoned".to_string())?;
        if files.get(file_id).is_some_and(|j| *j != self.job_id) {
            return Err(format!("already transcribing: {file_id}"));
        }
        files.insert(file_id.to_string(), self.job_id.clone());
        Ok(())
    }
}

/// 1 トラックぶんの途中経過（whisper の state と、処理済みの位置）
struct TrackAcc {
    file_id: String,
    track: Option<&'static str>,
    state: TrackState,
    /// 処理済みのサンプル数（次の窓のオフセット）
    done_samples: usize,
    /// 相対無音ゲート用の底の音量
    floor: FloorTracker,
    /// 言語 auto のとき、長い片（SHORT_PIECE_SEC 以上）で判定できた言語ごとの合計秒数（このトラックだけ）
    lang_own: HashMap<String, f32>,
    /// 同じ集計の、1 つの録音のトラックで共有する版。このトラックの集計が足りないときに使う
    /// （自分はほとんど話さないことが多く、相手側で分かった会議の言語を使う。
    /// 自分の集計が溜まれば自分のを使うので、相手が英語・自分が日本語の会議でも互いに引きずられない）
    lang_secs: LangPrior,
    /// 直前に残した文（正規化済み）。繰り返しの除去に使う
    last_text: Option<String>,
}

/// 1 つの録音のトラックで共有する、言語ごとの合計秒数（同じスレッドの中だけで使う）
type LangPrior = std::rc::Rc<std::cell::RefCell<HashMap<String, f32>>>;

impl TrackAcc {
    fn new(engine: &Engine, file_id: String, track: Option<&'static str>, lang_secs: LangPrior) -> Result<Self, String> {
        Ok(Self {
            file_id,
            track,
            state: engine.new_track()?,
            done_samples: 0,
            floor: FloorTracker::default(),
            lang_own: HashMap::new(),
            lang_secs,
            last_text: None,
        })
    }

    /// 言語固定: 窓を会話の間で 28 秒以下の片に切り、片ごとに文字起こしする（毎回用語のヒントを渡すため）。
    /// 音のない片は whisper に渡さない
    fn transcribe_fixed(
        &mut self,
        engine: &Engine,
        window: &[f32],
        offset_ms: u64,
        floor: Option<f32>,
        language: &str,
        vocabulary: Option<&str>,
    ) -> Result<Vec<Segment>, String> {
        let thr = gate_threshold(floor);
        let mut out = Vec::new();
        for (s, e) in active_pieces(window, thr, FIXED_PIECE_SEC as usize) {
            let mut segs =
                engine.transcribe(&mut self.state, &window[s..e], offset_ms + samples_to_ms(s), language, vocabulary)?;
            let piece_max = max_slice_rms(&window[s..e]);
            segs.retain(|seg| !should_drop_stock(&seg.text, piece_max, thr));
            for seg in segs.iter_mut() {
                seg.language = Some(language.to_string());
            }
            out.extend(segs);
        }
        Ok(out)
    }

    /// 言語 auto: 窓を 20 秒の片に分けて片ごとに言語を判定し、同じ言語が続く区間ごとに文字起こしする
    fn transcribe_auto(
        &mut self,
        engine: &Engine,
        window: &[f32],
        offset_ms: u64,
        floor: Option<f32>,
        vocabulary: Option<&str>,
    ) -> Result<Vec<Segment>, String> {
        let thr = gate_threshold(floor);
        // 前後の無音を削った片（音のない片は含まない）
        let pieces = active_pieces(window, thr, LANG_PIECE_SEC as usize);
        let mut langs: Vec<Option<String>> =
            pieces.iter().map(|&(s, e)| engine.detect_language(&mut self.state, &window[s..e])).collect();
        // 長い片の判定でトラックの言語を覚え、短い片はそれに寄せる
        for (i, &(s, e)) in pieces.iter().enumerate() {
            if let Some(l) = &langs[i] {
                if e - s >= SHORT_PIECE_SEC * SAMPLE_RATE {
                    let secs = (e - s) as f32 / SAMPLE_RATE as f32;
                    *self.lang_own.entry(l.clone()).or_insert(0.0) += secs;
                    *self.lang_secs.borrow_mut().entry(l.clone()).or_insert(0.0) += secs;
                }
            }
        }
        if self.lang_own.values().sum::<f32>() >= LANG_PRIOR_MIN_SEC {
            apply_language_prior(&pieces, &mut langs, &self.lang_own);
        } else {
            apply_language_prior(&pieces, &mut langs, &self.lang_secs.borrow());
        }
        let mut out = Vec::new();
        for (s, e, lang) in group_languages(&pieces, &langs) {
            let mut segs = engine.transcribe(
                &mut self.state,
                &window[s..e],
                offset_ms + samples_to_ms(s),
                &lang,
                vocabulary,
            )?;
            let piece_max = max_slice_rms(&window[s..e]);
            segs.retain(|seg| !should_drop_stock(&seg.text, piece_max, thr));
            for seg in segs.iter_mut() {
                seg.language = Some(lang.clone());
            }
            out.extend(segs);
        }
        Ok(out)
    }

    /// 1 窓を処理して segment イベントを出し、新しい segment（track 付き）を返す
    fn process(&mut self, engine: &Engine, cx: &JobCtx, window: &[f32]) -> Result<Vec<Segment>, String> {
        let new_segs = self.process_window(engine, window, &cx.language, cx.vocabulary.as_deref())?;
        cx.emit(
            "meeting-transcribe-segment",
            serde_json::json!({
                "jobId": cx.job_id,
                "fileId": self.file_id,
                "track": self.track,
                "segments": new_segs,
            }),
        );
        Ok(new_segs)
    }

    /// 1 窓を文字起こしして、新しい segment（track 付き）を返す（イベントは出さない）
    fn process_window(
        &mut self,
        engine: &Engine,
        window: &[f32],
        language: &str,
        vocabulary: Option<&str>,
    ) -> Result<Vec<Segment>, String> {
        let offset_ms = samples_to_ms(self.done_samples);
        let slices = slice_rms(window);
        // 判定中の窓自身も底の計算に含める（最初の窓から相対ゲートが効く）
        self.floor.add(&slices);
        let floor = self.floor.floor();
        let mut new_segs = if passes_gate_rel(&slices, floor) {
            if language == "auto" {
                self.transcribe_auto(engine, window, offset_ms, floor, vocabulary)?
            } else {
                self.transcribe_fixed(engine, window, offset_ms, floor, language, vocabulary)?
            }
        } else {
            // 実機で効きを追えるようにログへ（max = 窓内の 1 秒 RMS の最大）
            eprintln!(
                "[meeting_transcribe] 窓 skip: track={} offset_ms={} max={:.4} floor={}",
                self.track.unwrap_or("-"),
                offset_ms,
                slices.iter().copied().fold(0.0f32, f32::max),
                floor.map_or("-".to_string(), |f| format!("{f:.4}")),
            );
            Vec::new()
        };
        drop_repeats(&mut new_segs, &mut self.last_text);
        for s in new_segs.iter_mut() {
            s.track = self.track.map(str::to_string);
        }
        self.done_samples += window.len();
        Ok(new_segs)
    }
}

/// 1 ファイルぶんの文字起こし（両チャンネルの segment を startMs 順に持つ）
struct Transcript {
    file_id: String,
    segments: Vec<Segment>,
}

impl Transcript {
    fn new(file_id: String) -> Self {
        Self { file_id, segments: Vec::new() }
    }

    /// segment を足して startMs 順に並べ、JSON と平文を上書き保存する（窓ごとに呼ぶ）
    fn add_and_persist(&mut self, cx: &JobCtx, new_segs: Vec<Segment>) -> Result<(), String> {
        self.segments.extend(new_segs);
        self.segments.sort_by_key(|s| s.start_ms);
        persist(&self.file_id, &cx.language, &cx.size, &self.segments)
    }
}

fn register_job(state: &TranscribeState) -> Result<(String, Arc<AtomicBool>), String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .jobs
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .insert(job_id.clone(), cancel.clone());
    Ok((job_id, cancel))
}

/// ワーカー本体を panic から守って走らせ、結末に応じた終端イベントを 1 つだけ出す
fn run_guarded(cx: JobCtx, work: impl FnOnce(&JobCtx) -> Outcome) {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&cx)))
        .unwrap_or_else(|_| Outcome::Error("transcribe worker panicked".to_string()));
    let state = cx.app.state::<TranscribeState>();
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.remove(&cx.job_id);
    }
    if let Ok(mut files) = state.files.lock() {
        files.retain(|_, j| *j != cx.job_id);
    }
    match outcome {
        Outcome::Done(ids) => {
            cx.emit("meeting-transcribe-done", serde_json::json!({ "jobId": cx.job_id, "fileIds": ids }))
        }
        Outcome::Error(message) => {
            cx.emit("meeting-transcribe-error", serde_json::json!({ "jobId": cx.job_id, "message": message }))
        }
        Outcome::Cancelled => cx.emit("meeting-transcribe-cancelled", serde_json::json!({ "jobId": cx.job_id })),
    }
}

// ---- 録音中の逐次処理 ----
/// 録音開始時に呼ぶ。モデルが無い・language / modelSize が不正なときは None（録音は続ける）。
/// あれば (jobId, 送り口)
pub fn start_live(app: &tauri::AppHandle, opts: &RecOptions) -> Result<Option<(String, LiveFeed)>, String> {
    if check_language(&opts.language).is_err() {
        return Ok(None);
    }
    let Ok((size, _, _)) = model_spec(&opts.model_size) else { return Ok(None) };
    if !model_present(size) {
        return Ok(None);
    }
    let path = model_path(size)?;
    let (job_id, cancel) = register_job(&app.state::<TranscribeState>())?;
    let (tx, rx) = mpsc::channel::<LiveChunk>();
    let cx = JobCtx {
        app: app.clone(),
        job_id: job_id.clone(),
        language: opts.language.clone(),
        size: size.to_string(),
        vocabulary: normalize_vocabulary(opts.vocabulary.as_deref()),
        cancel,
    };
    std::thread::spawn(move || run_guarded(cx, |cx| run_live(cx, &path, rx)));
    Ok(Some((job_id, tx)))
}

/// 受信ループ。sender が全部 drop されたら残りを処理する
fn run_live(cx: &JobCtx, model: &std::path::Path, rx: mpsc::Receiver<LiveChunk>) -> Outcome {
    let engine = match Engine::load(model) {
        Ok(e) => e,
        Err(m) => return Outcome::Error(m),
    };
    // 録音は stereo 1 本なので fileId は 1 つ。最初のチャンクで確定して 1 回だけ claim する
    let mut transcript: Option<Transcript> = None;
    // 先頭に来たトラックから順に持つ（蓄積, 未処理バッファ）
    let mut tracks: Vec<(TrackAcc, Vec<f32>)> = Vec::new();

    // チャンクを該当トラックのバッファへ入れる。失敗したら Err(メッセージ)
    fn ingest(
        engine: &Engine,
        cx: &JobCtx,
        transcript: &mut Option<Transcript>,
        tracks: &mut Vec<(TrackAcc, Vec<f32>)>,
        chunk: LiveChunk,
    ) -> Result<(), String> {
        if transcript.is_none() {
            cx.claim_file(&chunk.file_id)?;
            *transcript = Some(Transcript::new(chunk.file_id.to_string()));
        }
        let idx = match tracks.iter().position(|(a, _)| a.track == Some(chunk.track)) {
            Some(i) => i,
            None => {
                // 言語の集計は先に来たトラックと共有する
                let prior = tracks.first().map(|(a, _)| a.lang_secs.clone()).unwrap_or_default();
                tracks.push((TrackAcc::new(engine, chunk.file_id.to_string(), Some(chunk.track), prior)?, Vec::new()));
                tracks.len() - 1
            }
        };
        tracks[idx].1.extend_from_slice(&chunk.samples);
        Ok(())
    }

    loop {
        if cx.cancelled() {
            return Outcome::Cancelled;
        }
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(chunk) => {
                if let Err(m) = ingest(&engine, cx, &mut transcript, &mut tracks, chunk) {
                    return Outcome::Error(m);
                }
                // 届いている分を全部取り込んでから窓を見る（溜まっていれば最大 180 秒でまとめて処理される）
                while let Ok(c) = rx.try_recv() {
                    if let Err(m) = ingest(&engine, cx, &mut transcript, &mut tracks, c) {
                        return Outcome::Error(m);
                    }
                }
                let Some(tr) = transcript.as_mut() else { continue };
                for (acc, buf) in tracks.iter_mut() {
                    // 会話の間で切った窓ごとに処理する（追いつけず溜まっているときはまとめて。上限 WINDOW_MAX_SEC）
                    for window in drain_live_windows(buf, &acc.floor) {
                        if let Err(m) = acc.process(&engine, cx, &window).and_then(|s| tr.add_and_persist(cx, s)) {
                            return Outcome::Error(m);
                        }
                        if cx.cancelled() {
                            return Outcome::Cancelled;
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    // 停止後の残り（上限を超える分は上限ずつ）
    let Some(tr) = transcript.as_mut() else { return Outcome::Done(Vec::new()) };
    for (acc, buf) in tracks.iter_mut() {
        for window in drain_rest(buf, &acc.floor) {
            if cx.cancelled() {
                return Outcome::Cancelled;
            }
            if let Err(m) = acc.process(&engine, cx, &window).and_then(|s| tr.add_and_persist(cx, s)) {
                return Outcome::Error(m);
            }
        }
    }
    Outcome::Done(vec![tr.file_id.clone()])
}

// ---- 既存の録音 ----
fn read_track_kind(file_id: &str) -> Option<&'static str> {
    let path = crate::media_dir().ok()?.join(format!("{file_id}.meta.json"));
    let meta: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    track_from_name(meta["name"].as_str()?)
}

/// WAV を窓ごとに読んで処理する。Ok(false) は取り消し。
/// stereo は左 = system、右 = mic として別々に処理し、1 つの transcript.json にまとめる。
/// mono（古い録音）は meta の name からトラックを判定する（不明なら null）
fn transcribe_file(engine: &Engine, cx: &JobCtx, file_id: &str) -> Result<bool, String> {
    let path = crate::media_dir()?.join(format!("{file_id}.wav"));
    let mut reader = hound::WavReader::open(&path).map_err(|e| format!("WAV を開けません: {e}"))?;
    let spec = reader.spec();
    if !(spec.channels == 1 || spec.channels == 2)
        || spec.sample_rate as usize != SAMPLE_RATE
        || spec.sample_format != hound::SampleFormat::Int
        || spec.bits_per_sample != 16
    {
        return Err("unsupported WAV format (16 kHz 16-bit mono/stereo expected)".to_string());
    }
    let ch = spec.channels as usize;
    let total = reader.duration() as usize;
    let prior = LangPrior::default();
    let mut accs: Vec<TrackAcc> = if ch == 2 {
        vec![
            TrackAcc::new(engine, file_id.to_string(), Some("system"), prior.clone())?,
            TrackAcc::new(engine, file_id.to_string(), Some("mic"), prior)?,
        ]
    } else {
        vec![TrackAcc::new(engine, file_id.to_string(), read_track_kind(file_id), prior)?]
    };
    let mut transcript = Transcript::new(file_id.to_string());
    let mut samples = reader.samples::<i16>();
    let mut done_frames = 0usize;
    // 録音中と同じく、読んだ分をトラックごとのバッファに足し、会話の間で切った窓ごとに処理する
    let mut bufs: Vec<Vec<f32>> = (0..ch).map(|_| Vec::new()).collect();
    for (s, e) in split_windows(total, WINDOW_SAMPLES) {
        if cx.cancelled() {
            return Ok(false);
        }
        // チャンネルごとのバッファは切り位置が違うので長さが揃わない。読んだ分だけを足す
        let chunk = read_frames(&mut samples, ch, e - s)?;
        let n = chunk[0].len();
        if n == 0 {
            break;
        }
        for (b, c) in bufs.iter_mut().zip(chunk) {
            b.extend(c);
        }
        done_frames += n;
        for (acc, b) in accs.iter_mut().zip(bufs.iter_mut()) {
            for w in drain_live_windows(b, &acc.floor) {
                if cx.cancelled() {
                    return Ok(false);
                }
                let segs = acc.process(engine, cx, &w)?;
                transcript.add_and_persist(cx, segs)?;
            }
        }
        cx.emit(
            "meeting-transcribe-progress",
            serde_json::json!({
                "jobId": cx.job_id,
                "fileId": file_id,
                "ratio": (done_frames as f64 / total.max(1) as f64).min(1.0),
            }),
        );
    }
    // 読み終えたら残りを処理する
    for (acc, b) in accs.iter_mut().zip(bufs.iter_mut()) {
        for w in drain_rest(b, &acc.floor) {
            if cx.cancelled() {
                return Ok(false);
            }
            let segs = acc.process(engine, cx, &w)?;
            transcript.add_and_persist(cx, segs)?;
        }
    }
    if total == 0 {
        transcript.add_and_persist(cx, Vec::new())?;
    }
    Ok(true)
}

#[tauri::command]
pub fn meeting_transcribe_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, TranscribeState>,
    file_ids: Vec<String>,
    language: String,
    model_size: String,
    vocabulary: Option<String>,
) -> Result<StartJobResult, String> {
    check_language(&language)?;
    let (size, _, _) = model_spec(&model_size)?;
    if file_ids.is_empty() || !file_ids.iter().all(|id| valid_id(id)) {
        return Err("不正なファイル ID".to_string());
    }
    if !model_present(size) {
        return Err("model missing".to_string());
    }
    let path = model_path(size)?;
    let (job_id, cancel) = register_job(&state)?;
    // 実行中のジョブ（live 含む）と同じ fileId を持つなら断る。確認と登録は同じロックの中で行う
    {
        let mut files = state.files.lock().map_err(|_| "state poisoned".to_string())?;
        if let Some(busy) = file_ids.iter().find(|id| files.contains_key(*id)) {
            let busy = busy.clone();
            drop(files);
            if let Ok(mut jobs) = state.jobs.lock() {
                jobs.remove(&job_id);
            }
            return Err(format!("already transcribing: {busy}"));
        }
        for id in &file_ids {
            files.insert(id.clone(), job_id.clone());
        }
    }
    let cx = JobCtx {
        app,
        job_id: job_id.clone(),
        language,
        size: size.to_string(),
        vocabulary: normalize_vocabulary(vocabulary.as_deref()),
        cancel,
    };
    std::thread::spawn(move || {
        run_guarded(cx, |cx| {
            let engine = match Engine::load(&path) {
                Ok(e) => e,
                Err(m) => return Outcome::Error(m),
            };
            let mut done = Vec::new();
            for id in &file_ids {
                if cx.cancelled() {
                    return Outcome::Cancelled;
                }
                match transcribe_file(&engine, cx, id) {
                    Ok(true) => done.push(id.clone()),
                    Ok(false) => return Outcome::Cancelled,
                    Err(m) => return Outcome::Error(m),
                }
            }
            Outcome::Done(done)
        })
    });
    Ok(StartJobResult { job_id })
}

#[tauri::command]
pub fn meeting_transcribe_cancel(state: tauri::State<'_, TranscribeState>, job_id: String) -> Result<(), String> {
    if let Some(flag) = state.jobs.lock().map_err(|_| "state poisoned".to_string())?.get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    #[test]
    fn meeting_sidecar_path_name() {
        assert_eq!(super::sidecar_path_name("abc", "cleanup").unwrap(), "abc.cleanup.json");
        assert_eq!(super::sidecar_path_name("abc", "summary").unwrap(), "abc.summary.json");
        assert!(super::sidecar_path_name("abc", "transcript").is_err());
        assert!(super::sidecar_path_name("abc", "").is_err());
        assert!(super::sidecar_path_name("../x", "cleanup").is_err());
        assert!(super::sidecar_path_name("", "summary").is_err());
        assert!(super::sidecar_path_name(".hidden", "summary").is_err());
    }

    #[test]
    fn stock_hallucination_exact_match() {
        for t in ["Thank you.", " THANK YOU! ", "Thank\u{3000}you", "ご視聴ありがとうございました。", "チャンネル登録をお願いします！", "Thanks for watching."] {
            assert!(super::is_stock_hallucination(t), "{t}");
        }
        assert!(!super::is_stock_hallucination("thank you all for coming"));
        assert!(!super::is_stock_hallucination("ご視聴ありがとうございました、次回は資料を共有します"));
        assert!(!super::is_stock_hallucination(""));
    }

    #[test]
    fn stock_hallucination_kept_when_loud() {
        let thr = 0.004;
        assert!(super::should_drop_stock("Thank you.", 0.005, thr));
        assert!(!super::should_drop_stock("Thank you.", 0.008, thr));
        assert!(!super::should_drop_stock("thank you all for coming", 0.001, thr));
    }

    use super::*;

    fn sine(amp: f32, secs: usize) -> Vec<f32> {
        (0..SAMPLE_RATE * secs)
            .map(|i| amp * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / SAMPLE_RATE as f32).sin())
            .collect()
    }

    /// 秒ごとの音量（0 = 無音、それ以外は話し声）から CUT_FRAME_MS 刻みの音量列を作る
    fn frames_from_secs(secs: &[f32]) -> Vec<f32> {
        let per = 1000 / CUT_FRAME_MS;
        secs.iter().flat_map(|&v| std::iter::repeat(v).take(per)).collect()
    }

    fn frame_at(sec: f32) -> usize {
        (sec * SAMPLE_RATE as f32) as usize
    }

    #[test]
    fn meeting_window_waits_until_20s() {
        let f = frames_from_secs(&[0.1; 19]);
        assert_eq!(take_at_pause(&f, 19 * SAMPLE_RATE, 0.01, false), 0);
        assert_eq!(take_at_pause(&[], 0, 0.01, false), 0);
    }

    #[test]
    fn meeting_window_cuts_at_last_pause() {
        // 0〜24 秒のうち 12 秒目と 17 秒目が無音 → 後ろ（17 秒目の無音の真ん中）で切る
        let mut s = vec![0.1f32; 24];
        s[12] = 0.0;
        s[17] = 0.0;
        let n = take_at_pause(&frames_from_secs(&s), 24 * SAMPLE_RATE, 0.01, false);
        assert_eq!(n, frame_at(17.5));
        // 静かな刻みが 1 つ・2 つだけ（語の切れ目）では切らない。3 つ続けば切る
        let mut f = frames_from_secs(&vec![0.1f32; 24]);
        f[150] = 0.0;
        f[180] = 0.0;
        f[181] = 0.0;
        assert_eq!(take_at_pause(&f, 24 * SAMPLE_RATE, 0.01, false), 0);
        f[182] = 0.0;
        assert_eq!(take_at_pause(&f, 24 * SAMPLE_RATE, 0.01, false), frame_at(18.1));
        // 10 秒より手前の無音では切らない（待つ）
        let mut s = vec![0.1f32; 24];
        s[5] = 0.0;
        assert_eq!(take_at_pause(&frames_from_secs(&s), 24 * SAMPLE_RATE, 0.01, false), 0);
    }

    #[test]
    fn meeting_window_forces_quietest_after_40s() {
        // 間の無い 40 秒 → いちばん静かな刻み（30 秒目）で切る
        let mut s = vec![0.1f32; 40];
        s[30] = 0.05;
        let n = take_at_pause(&frames_from_secs(&s), 40 * SAMPLE_RATE, 0.01, false);
        assert_eq!(n, frame_at(30.9));
    }

    #[test]
    fn meeting_window_backlog_up_to_180s() {
        // 溜まった 150 秒（最後に無音）→ 1 回でまとめて
        let mut s = vec![0.1f32; 150];
        s[149] = 0.0;
        assert_eq!(take_at_pause(&frames_from_secs(&s), 150 * SAMPLE_RATE, 0.01, false), frame_at(149.5));
        // 400 秒溜まっても 1 回は 180 秒以内
        let mut buf = vec![0.1f32; 400 * SAMPLE_RATE];
        let ws = drain_windows(&mut buf, 0.01, false);
        assert!(ws.iter().all(|w| w.len() <= WINDOW_MAX_SAMPLES));
        assert_eq!(ws.iter().map(Vec::len).sum::<usize>() + buf.len(), 400 * SAMPLE_RATE);
    }

    #[test]
    fn meeting_read_frames_splits_channels_and_drops_partial_frame() {
        // stereo の 7 サンプル = 3 フレーム + 端数 1。左右に分け、端数は捨てる
        let raw: Vec<Result<i16, hound::Error>> = (1..=7).map(|v| Ok(v * 1000)).collect();
        let mut it = raw.into_iter();
        let out = read_frames(&mut it, 2, 2).unwrap();
        assert_eq!(out[0].len(), 2);
        assert_eq!(out[1].len(), 2);
        assert!((out[0][1] - 3000.0 / 32768.0).abs() < 1e-6);
        assert!((out[1][1] - 4000.0 / 32768.0).abs() < 1e-6);
        let out = read_frames(&mut it, 2, 10).unwrap();
        assert_eq!((out[0].len(), out[1].len()), (1, 1));
        let out = read_frames(&mut it, 2, 10).unwrap();
        assert_eq!((out[0].len(), out[1].len()), (0, 0));
    }

    #[test]
    fn meeting_window_rest_takes_everything() {
        let mut buf = vec![0.1f32; 5 * SAMPLE_RATE];
        let ws = drain_windows(&mut buf, 0.01, true);
        assert_eq!(ws.len(), 1);
        assert!(buf.is_empty());
        let mut buf = vec![0.1f32; 250 * SAMPLE_RATE];
        let ws = drain_windows(&mut buf, 0.01, true);
        assert!(buf.is_empty());
        assert!(ws.iter().all(|w| w.len() <= WINDOW_MAX_SAMPLES));
    }

    #[test]
    fn meeting_pieces_trim_silence() {
        // 20 秒の片のうち 9 秒目だけ音がある → 8〜10 秒（前後 1 秒の余白）だけ渡す
        let mut w = vec![0.0f32; 20 * SAMPLE_RATE];
        for x in &mut w[9 * SAMPLE_RATE..10 * SAMPLE_RATE] {
            *x = 0.1;
        }
        assert_eq!(active_pieces(&w, 0.01, 20), vec![(8 * SAMPLE_RATE, 11 * SAMPLE_RATE)]);
        // 音がまったく無ければ渡さない
        assert!(active_pieces(&vec![0.0f32; 20 * SAMPLE_RATE], 0.01, 20).is_empty());
        // 窓の最後の端数（0.5 秒）にある音も残す
        let mut w = vec![0.0f32; 10 * SAMPLE_RATE + SAMPLE_RATE / 2];
        for x in &mut w[10 * SAMPLE_RATE..] {
            *x = 0.1;
        }
        let p = active_pieces(&w, 0.01, 20);
        assert_eq!(p.last().map(|x| x.1), Some(w.len()));
    }

    #[test]
    fn meeting_language_prior_for_short_pieces() {
        let sec = SAMPLE_RATE;
        let pieces = vec![(0, 3 * sec), (3 * sec, 13 * sec)];
        let l = |s: &str| Some(s.to_string());
        // 日本語が 9 割のトラック: 3 秒の en は ja に寄せ、10 秒の en はそのまま
        let mut prior = HashMap::new();
        prior.insert("ja".to_string(), 90.0);
        prior.insert("en".to_string(), 10.0);
        let mut langs = vec![l("en"), l("en")];
        apply_language_prior(&pieces, &mut langs, &prior);
        assert_eq!(langs, vec![l("ja"), l("en")]);
        // 判定の合計が 15 秒に満たない・割合が 7 割未満なら寄せない
        let mut few = HashMap::new();
        few.insert("ja".to_string(), 10.0);
        let mut langs = vec![l("en"), None];
        apply_language_prior(&pieces, &mut langs, &few);
        assert_eq!(langs, vec![l("en"), None]);
        let mut mixed = HashMap::new();
        mixed.insert("ja".to_string(), 60.0);
        mixed.insert("en".to_string(), 40.0);
        let mut langs = vec![l("en")];
        apply_language_prior(&pieces[..1], &mut langs, &mixed);
        assert_eq!(langs, vec![l("en")]);
    }

    #[test]
    fn meeting_repeats_dropped() {
        let seg = |t: &str| Segment {
            start_ms: 0,
            end_ms: 0,
            text: t.to_string(),
            no_speech_prob: None,
            track: None,
            language: None,
        };
        let mut last = None;
        let mut v = vec![seg("1分間焼き込みます。"), seg("1分間焼き込みます"), seg("焼き込みます。"), seg("はい"), seg("はい")];
        drop_repeats(&mut v, &mut last);
        let texts: Vec<&str> = v.iter().map(|s| s.text.as_str()).collect();
        // 4 文字未満の「はい」は繰り返しても残す
        assert_eq!(texts, vec!["1分間焼き込みます。", "焼き込みます。", "はい", "はい"]);
        // 前の窓の最後と同じ文も捨てる
        let mut last = Some(normalize_text("焼き込みます。"));
        let mut v = vec![seg("焼き込みます")];
        drop_repeats(&mut v, &mut last);
        assert!(v.is_empty());
    }

    #[test]
    fn meeting_gate_skips_silence_and_passes_tone() {
        assert!(!passes_gate(&vec![0.0; SAMPLE_RATE * 60]));
        // しきい値未満の微小ノイズも通さない
        assert!(!passes_gate(&sine(0.002, 10)));
        assert!(passes_gate(&sine(0.1, 5)));
        // 59 秒無音 + 1 秒だけ音があれば通す（最大を見る）
        let mut v = vec![0.0; SAMPLE_RATE * 59];
        v.extend(sine(0.1, 1));
        assert!(passes_gate(&v));
    }

    #[test]
    fn meeting_relative_gate_skips_near_floor() {
        // 底 0.011 → しきい値 max(0.004, min(0.066, 0.02)) = 0.02。最大 0.015 の窓は skip
        let mut t = FloorTracker::default();
        t.add(&[0.011; 30]);
        let f = t.floor();
        assert!((f.unwrap() - 0.011).abs() < 1e-6);
        assert!(!passes_gate_rel(&[0.005, 0.015, 0.01], f));
        // 履歴が無ければ絶対しきい値だけ
        assert!(passes_gate_rel(&[0.02], None));
        assert!(!passes_gate_rel(&[0.003], None));
    }

    #[test]
    fn meeting_relative_gate_passes_speech_over_floor() {
        let mut t = FloorTracker::default();
        t.add(&[0.011; 30]);
        // しきい値は max(0.004, min(0.011 × 6, 0.02)) = 0.02
        assert!(!passes_gate_rel(&[0.011, 0.019, 0.012], t.floor()));
        assert!(passes_gate_rel(&[0.011, 0.06, 0.012], t.floor()));
        // 底は 10 パーセンタイル: 大半が発話でも静かな部分が底になる
        let mut t = FloorTracker::default();
        t.add(&[0.01, 0.01, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
        assert!((t.floor().unwrap() - 0.01).abs() < 1e-6);
    }

    #[test]
    fn meeting_gate_always_passes_loud_speech_even_with_high_floor() {
        // ほとんど話しているトラック: 底 0.04（×4 = 0.16）でも最大 0.2 は上限 0.02 により pass
        let mut t = FloorTracker::default();
        t.add(&[0.04; 30]);
        assert!(passes_gate_rel(&[0.04, 0.2, 0.05], t.floor()));
    }

    #[test]
    fn meeting_gate_skips_mic_noise_over_low_floor() {
        // 底 0.0028 → しきい値 0.0112。マイク雑音の最大 0.0085 は skip
        let mut t = FloorTracker::default();
        t.add(&[0.0028; 30]);
        assert!(!passes_gate_rel(&[0.0028, 0.0085, 0.003], t.floor()));
        // 底 0.002 → しきい値 0.008。小声の最大 0.010（-40 dBFS）は pass
        let mut t = FloorTracker::default();
        t.add(&[0.002; 30]);
        assert!(passes_gate_rel(&[0.002, 0.010, 0.003], t.floor()));
    }

    #[test]
    fn meeting_has_speech_text() {
        assert!(!has_speech_text("ー ー"));
        assert!(!has_speech_text(" ♪ ... — "));
        assert!(!has_speech_text(""));
        assert!(has_speech_text("はい"));
        assert!(has_speech_text("ok"));
    }

    #[test]
    fn meeting_lang_pieces_cut_at_silence() {
        let (snd, sil) = (0.1f32, 0.0f32);
        let mut v = vec![snd; 11];
        v.push(sil); // 11 秒目が無音
        v.extend([snd; 6]);
        v.push(sil); // 18 秒目が無音
        v.extend([snd; 10]);
        // 無音の位置で切れる（無音スライスは境界の次の片の先頭に入る）
        assert_eq!(split_pieces_at_silence(&v, 0.02), vec![(0, 11), (11, 18), (18, 29)]);
        // 窓の端に接する無音は切り位置にしない
        let mut e = vec![sil; 3];
        e.extend([snd; 10]);
        assert_eq!(split_pieces_at_silence(&e, 0.02), vec![(0, 13)]);
        // 短すぎる片（2 秒未満）は隣に併合（先頭 1 秒の後ろの無音では切らない）
        let mut s = vec![snd; 1];
        s.push(sil);
        s.extend([snd; 10]);
        assert_eq!(split_pieces_at_silence(&s, 0.02), vec![(0, 12)]);
    }

    #[test]
    fn meeting_lang_pieces_force_cut_without_silence() {
        // 無音が無い 50 秒は 20/20/10
        assert_eq!(split_pieces_at_silence(&vec![0.1; 50], 0.02), vec![(0, 20), (20, 40), (40, 50)]);
        // 41 秒: 端数 1 秒は最短未満なので前の片に併合
        assert_eq!(split_pieces_at_silence(&vec![0.1; 41], 0.02), vec![(0, 20), (20, 41)]);
        assert!(split_pieces_at_silence(&[], 0.02).is_empty());
    }

    #[test]
    fn meeting_fixed_language_cuts_into_28s_pieces() {
        // 無音の無い 60 秒の窓: 28 秒以下の片に切られる
        let pieces = piece_samples(&vec![0.1; 60 * SAMPLE_RATE], 0.02, FIXED_PIECE_SEC as usize);
        assert_eq!(pieces.len(), 3);
        assert!(pieces.iter().all(|&(s, e)| e - s <= 28 * SAMPLE_RATE));
        assert_eq!(pieces.first().unwrap().0, 0);
        assert_eq!(pieces.last().unwrap().1, 60 * SAMPLE_RATE);
        assert!(pieces.windows(2).all(|w| w[0].1 == w[1].0));
    }

    #[test]
    fn meeting_lang_groups() {
        let sec = SAMPLE_RATE;
        // 秒の長さ列から連続した片を作る
        let mk = |lens: &[usize]| {
            let mut v = Vec::new();
            let mut at = 0;
            for l in lens {
                v.push((at * sec, (at + l) * sec));
                at += l;
            }
            v
        };
        let l = |s: &str| Some(s.to_string());
        let g = |a: usize, b: usize, s: &str| (a * sec, b * sec, s.to_string());
        // [ja, ja, en] → 2 区間
        assert_eq!(
            group_languages(&mk(&[20, 20, 20]), &[l("ja"), l("ja"), l("en")]),
            vec![g(0, 40, "ja"), g(40, 60, "en")]
        );
        // 5 秒以上の判定なしの片は捨てる（前後の ja も併合しない）
        assert_eq!(
            group_languages(&mk(&[20, 20, 20]), &[l("ja"), None, l("ja")]),
            vec![g(0, 20, "ja"), g(40, 60, "ja")]
        );
        assert_eq!(group_languages(&mk(&[20, 20, 20]), &[None, l("en"), None]), vec![g(20, 40, "en")]);
        // 短い（5 秒未満）判定なしの片は隣の判定済みの片に併合: [ja(10s), None(3s), ja(8s)] → 1 区間 21 秒
        assert_eq!(group_languages(&mk(&[10, 3, 8]), &[l("ja"), None, l("ja")]), vec![g(0, 21, "ja")]);
        // [ja(10s), None(8s), en(8s)] → None は捨てて 2 区間
        assert_eq!(
            group_languages(&mk(&[10, 8, 8]), &[l("ja"), None, l("en")]),
            vec![g(0, 10, "ja"), g(18, 26, "en")]
        );
        // 直前を優先: [ja, None(3s), en] → None は ja 側へ
        assert_eq!(
            group_languages(&mk(&[10, 3, 8]), &[l("ja"), None, l("en")]),
            vec![g(0, 13, "ja"), g(13, 21, "en")]
        );
        // 先頭の短い None は直後へ。隣に判定済みが無ければ捨てる
        assert_eq!(group_languages(&mk(&[3, 10]), &[None, l("en")]), vec![g(0, 13, "en")]);
        assert!(group_languages(&mk(&[3, 3]), &[None, None]).is_empty());
    }

    #[test]
    fn meeting_windows_split_150s() {
        // 既存録音の読み込み単位（20 秒ずつ・最後は端数）
        let w = split_windows(SAMPLE_RATE * 150, WINDOW_SAMPLES);
        assert_eq!(w.len(), 8);
        assert_eq!(w[0], (0, SAMPLE_RATE * 20));
        assert_eq!(w[1], (SAMPLE_RATE * 20, SAMPLE_RATE * 40));
        assert_eq!(w[7], (SAMPLE_RATE * 140, SAMPLE_RATE * 150));
        assert_eq!(samples_to_ms(w[1].0), 20_000);
        assert_eq!(samples_to_ms(w[7].0), 140_000);
        assert!(split_windows(0, WINDOW_SAMPLES).is_empty());
    }

    #[test]
    fn meeting_segment_time_adds_window_offset() {
        // 2 窓目（60 秒）の 1.5 秒 = 150 センチ秒
        assert_eq!(abs_ms(60_000, 150), 61_500);
        assert_eq!(abs_ms(0, 0), 0);
        // 負の値は 0 に丸める
        assert_eq!(abs_ms(1_000, -5), 1_000);
    }

    #[test]
    fn meeting_plain_rendering() {
        let seg = |ms: u64, t: &str, tr: Option<&str>| Segment {
            start_ms: ms,
            end_ms: ms + 1000,
            text: t.into(),
            no_speech_prob: None,
            track: tr.map(str::to_string),
            language: None,
        };
        let out = render_plain(&[seg(0, "こんにちは", None), seg(75_400, "next", None), seg(3_725_000, "late", None)]);
        assert_eq!(out, "[00:00] こんにちは\n[01:15] next\n[62:05] late\n");
        let out = render_plain(&[seg(0, "hi", Some("system")), seg(2_000, "yo", Some("mic"))]);
        assert_eq!(out, "[00:00] them: hi\n[00:02] me: yo\n");
        assert_eq!(render_plain(&[]), "");
    }

    #[test]
    fn meeting_track_detection() {
        assert_eq!(track_from_name("meeting-20261019-1030-system.wav"), Some("system"));
        assert_eq!(track_from_name("meeting-20261019-1030-mic.wav"), Some("mic"));
        assert_eq!(track_from_name("voice.wav"), None);
        assert_eq!(track_from_name(""), None);
    }

    #[test]
    fn meeting_vocabulary_normalized() {
        assert_eq!(normalize_vocabulary(None), None);
        assert_eq!(normalize_vocabulary(Some("  ")), None);
        assert_eq!(normalize_vocabulary(Some(" 熱電, ZT ")).as_deref(), Some("熱電, ZT"));
        // 末尾側を残す（先頭のタイトルが落ち、設定の用語が残る）
        let long = format!("{}{}", "タ".repeat(300), "用語末尾");
        let v = normalize_vocabulary(Some(&long)).unwrap();
        assert_eq!(v.chars().count(), VOCABULARY_MAX_CHARS);
        assert!(v.ends_with("用語末尾"));
        // NUL・制御文字は除き、改行は空白にする
        assert_eq!(normalize_vocabulary(Some("a\0b\nc\u{7}d")).as_deref(), Some("ab cd"));
        assert_eq!(normalize_vocabulary(Some("\0\n")), None);
    }

    #[test]
    fn meeting_ids_and_models_validated() {
        assert!(valid_id("a1b2-c3"));
        assert!(!valid_id("../x"));
        assert!(!valid_id(".hidden"));
        assert!(!valid_id(""));
        assert!(model_spec("small").is_ok());
        assert!(model_spec("large-v3-turbo").is_ok());
        assert_eq!(model_file_name("large-v3-turbo"), "ggml-large-v3-turbo-q5_0.bin");
        assert_eq!(model_file_name("small"), "ggml-small.bin");
        assert!(model_spec("large").is_err());
        assert!(check_language("auto").is_ok());
        assert!(check_language("fr").is_err());
    }

    #[test]
    fn meeting_transcript_json_shape() {
        let segs = vec![Segment {
            start_ms: 1,
            end_ms: 2,
            text: "a".into(),
            no_speech_prob: Some(0.1),
            track: Some("mic".into()),
            language: Some("ja".into()),
        }];
        let v = transcript_json("auto", "small", &segs);
        assert_eq!(v["channels"]["left"], "system");
        assert_eq!(v["channels"]["right"], "mic");
        assert_eq!(v["segments"][0]["track"], "mic");
        assert_eq!(v["version"], 1);
        assert_eq!(v["model"], "ggml-small");
        assert_eq!(v["windowSec"], 20);
        assert_eq!(v["segments"][0]["startMs"], 1);
        assert!(v["segments"][0]["noSpeechProb"].is_number());
    }

    /// 実録音の再処理（手動・実モデルが要る）。録音中と同じく 1 秒ずつ届いたものとして窓を切る。
    /// REPLAY_WAV=<16 kHz stereo WAV> REPLAY_MODEL=<ggml の .bin> [REPLAY_LANG=auto] [REPLAY_VOCAB=…]
    /// cargo test --release --lib meeting_replay_wav -- --ignored --nocapture
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    #[ignore]
    fn meeting_replay_wav() {
        use super::*;
        let wav = std::env::var("REPLAY_WAV").expect("REPLAY_WAV");
        let model = std::env::var("REPLAY_MODEL").expect("REPLAY_MODEL");
        let lang = std::env::var("REPLAY_LANG").unwrap_or_else(|_| "auto".to_string());
        let vocab = normalize_vocabulary(std::env::var("REPLAY_VOCAB").ok().as_deref());
        let engine = Engine::load(std::path::Path::new(&model)).unwrap();
        let mut r = hound::WavReader::open(&wav).unwrap();
        let ch = r.spec().channels as usize;
        let names = ["system", "mic"];
        let prior = LangPrior::default();
        let mut out: Vec<Segment> = Vec::new();
        let mut accs: Vec<TrackAcc> = (0..ch)
            .map(|c| TrackAcc::new(&engine, "replay".to_string(), Some(names[c]), prior.clone()).unwrap())
            .collect();
        let mut bufs: Vec<Vec<f32>> = (0..ch).map(|_| Vec::new()).collect();
        // transcribe_file と同じく、読んだ分（REPLAY_CHUNK_SEC 秒ずつ。既定 1 秒 = 録音中の届き方に近い）を
        // 両トラックに足しながら処理する
        let chunk_sec: usize = std::env::var("REPLAY_CHUNK_SEC").ok().and_then(|v| v.parse().ok()).unwrap_or(1);
        let mut it = r.samples::<i16>();
        loop {
            let chunk = read_frames(&mut it, ch, chunk_sec * SAMPLE_RATE).unwrap();
            if chunk[0].is_empty() {
                break;
            }
            for ((acc, b), c) in accs.iter_mut().zip(bufs.iter_mut()).zip(chunk) {
                b.extend(c);
                for w in drain_live_windows(b, &acc.floor) {
                    out.extend(acc.process_window(&engine, &w, &lang, vocab.as_deref()).unwrap());
                }
            }
        }
        for (acc, b) in accs.iter_mut().zip(bufs.iter_mut()) {
            for w in drain_rest(b, &acc.floor) {
                out.extend(acc.process_window(&engine, &w, &lang, vocab.as_deref()).unwrap());
            }
        }
        out.sort_by_key(|s| s.start_ms);
        for s in &out {
            let t = s.start_ms / 1000;
            println!(
                "[{:02}:{:02}] {:<6} {:<2} {}",
                t / 60,
                t % 60,
                s.track.as_deref().unwrap_or("-"),
                s.language.as_deref().unwrap_or("-"),
                s.text
            );
        }
    }
}
