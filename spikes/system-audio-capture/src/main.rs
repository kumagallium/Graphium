//! 検証: macOS の再生音（システムミックス）を Rust から録れるか。
//!
//! Zoom / Teams の相手の声は「スピーカーへ流れる音」なので、マイクではなく
//! OS の再生音を録る口が要る。pinray（ScreenCaptureKit）で N 秒録音し、
//! WAV に書き出したうえで無音かどうか・周波数の見当・planar/interleaved の
//! 判定材料を出力する。
//!
//! 使い方: cargo run --release -- <秒数> <出力.wav>

use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use pinray::{
    AudioCapture, AudioData, BackendPreference, CaptureEvent, CaptureSession, SampleFormat,
    SourceId, VideoCaptureTarget,
};

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let secs: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(8);
    let out = args.next().unwrap_or_else(|| "capture.wav".to_string());
    // SCK の LPCM は実測で planar（1 パケット内で前半が L・後半が R）。
    // 既定で並べ直す。--as-is で生の順序のまま書く。
    let reorder_planar = !args.any(|a| a == "--as-is");

    eprintln!("[1] セッション構築（SCK, video は 1fps で捨てる, audio=SystemMix）");
    let mut session = CaptureSession::builder()
        .backend_preference(BackendPreference::MacScreenCaptureKit)
        .video_target(VideoCaptureTarget::Display(SourceId::new("auto")))
        .audio(AudioCapture::SystemMix)
        .frame_rate(Some(1))
        .build()
        .context("CaptureSession::build（画面収録の権限が無いとここで落ちる）")?;
    let info = session.backend_info();
    eprintln!(
        "[2] backend={:?} supports_audio={}",
        info.kind, info.supports_audio
    );

    session.start().context("start")?;
    eprintln!("[3] 録音開始 {secs} 秒 — いま音を鳴らしてください");

    let start = Instant::now();
    let mut pcm: Vec<f32> = Vec::new(); // 受け取ったバイト列を F32 として解釈
    let mut audio_frames = 0u64;
    let mut video_frames = 0u64;
    let mut gaps = 0u64;
    let mut first_sequence: Option<u64> = None;
    let mut last_sequence: Option<u64> = None;
    let mut sample_rate = 0u32;
    let mut channels = 0u16;
    let mut planar_seen = false;
    let mut half_equal_frames = 0u64; // planar なら前半(L)と後半(R)が似る

    while start.elapsed() < Duration::from_secs(secs) {
        match session.next_event(Some(Duration::from_millis(500)))? {
            CaptureEvent::Audio(f) => {
                audio_frames += 1;
                sample_rate = f.sample_rate;
                channels = f.channels;
                first_sequence.get_or_insert(f.sequence);
                last_sequence = Some(f.sequence);
                if f.sample_format != SampleFormat::F32 {
                    eprintln!("想定外の sample_format: {:?}", f.sample_format);
                }
                match &f.data {
                    AudioData::Interleaved(bytes) => {
                        let floats: Vec<f32> = bytes
                            .chunks_exact(4)
                            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                            .collect();
                        let half = floats.len() / 2;
                        if half > 0 {
                            let (a, b) = floats.split_at(half);
                            let diff: f32 = a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum();
                            let energy: f32 = a.iter().map(|x| x.abs()).sum();
                            if energy > 1e-3 && diff / energy < 0.05 {
                                half_equal_frames += 1;
                            }
                        }
                        if reorder_planar && floats.len() % 2 == 0 {
                            let (l, r) = floats.split_at(floats.len() / 2);
                            for (a, b) in l.iter().zip(r) {
                                pcm.push(*a);
                                pcm.push(*b);
                            }
                        } else {
                            pcm.extend(floats);
                        }
                    }
                    AudioData::Planar(planes) => {
                        planar_seen = true;
                        // L R L R に並べ直す
                        let n = planes.first().map(|p| p.len() / 4).unwrap_or(0);
                        for i in 0..n {
                            for p in planes {
                                let c = &p[i * 4..i * 4 + 4];
                                pcm.push(f32::from_le_bytes([c[0], c[1], c[2], c[3]]));
                            }
                        }
                    }
                }
            }
            CaptureEvent::Video(_) => video_frames += 1,
            CaptureEvent::Gap(_) => gaps += 1,
            CaptureEvent::End => break,
        }
    }
    session.stop().ok();

    eprintln!("[4] 書き出し {out}");
    let spec = hound::WavSpec {
        channels: channels.max(1),
        sample_rate: if sample_rate == 0 { 48_000 } else { sample_rate },
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut w = hound::WavWriter::create(&out, spec)?;
    for s in &pcm {
        w.write_sample(*s)?;
    }
    w.finalize()?;

    // ---- 解析 ----
    let ch = channels.max(1) as usize;
    let frames = pcm.len() / ch;
    let mut sum_sq = vec![0f64; ch];
    let mut peak = vec![0f32; ch];
    for (i, s) in pcm.iter().enumerate() {
        let c = i % ch;
        sum_sq[c] += (*s as f64) * (*s as f64);
        peak[c] = peak[c].max(s.abs());
    }
    let rms: Vec<f64> = sum_sq.iter().map(|x| (x / frames.max(1) as f64).sqrt()).collect();

    // 最も音の大きい 1 秒（ch0）でゼロ交差から周波数の見当を取る（純音確認用）
    let sr = spec.sample_rate as usize;
    let win = frames.min(sr).max(1);
    let mut best_start = 0usize;
    let mut best_e = -1f64;
    let mut i = 0;
    while i + win <= frames {
        let e: f64 = (i..i + win).map(|k| (pcm[k * ch] as f64).powi(2)).sum();
        if e > best_e {
            best_e = e;
            best_start = i;
        }
        i += (win / 4).max(1);
    }
    let mut zc = 0usize;
    let mut prev = 0f32;
    for k in best_start..(best_start + win).min(frames) {
        let s = pcm[k * ch];
        if (prev < 0.0 && s >= 0.0) || (prev >= 0.0 && s < 0.0) {
            zc += 1;
        }
        prev = s;
    }
    let est_hz = zc as f64 / 2.0 / (win as f64 / sr as f64);
    let loud_at_s = best_start as f64 / sr as f64;

    let dropped = match (first_sequence, last_sequence) {
        (Some(a), Some(b)) => (b - a + 1).saturating_sub(audio_frames),
        _ => 0,
    };

    println!("audio_frames={audio_frames} video_frames={video_frames} gaps={gaps} dropped_packets={dropped}");
    println!(
        "sample_rate={} channels={} seconds_captured={:.2}",
        spec.sample_rate,
        ch,
        frames as f64 / spec.sample_rate as f64
    );
    println!("rms={rms:?} peak={peak:?}");
    println!("planar_seen={planar_seen} half_equal_frames={half_equal_frames} (audio_frames に近ければ実体は planar の疑い)");
    println!("est_hz_loudest1s={est_hz:.0} loudest_window_starts_at_s={loud_at_s:.1} reorder_planar={reorder_planar}");
    println!("verdict={}", if rms.iter().any(|r| *r > 1e-3) { "SOUND_CAPTURED" } else { "SILENT" });
    Ok(())
}
