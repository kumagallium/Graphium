//! 検証 2: cpal 0.18 だけで「再生音（Core Audio tap）」と「マイク」を同時に録る。
//!
//! 狙い: 画面収録の権限なしで再生音が録れるか（macOS 14.6+ のループバック）、
//! マイクと 2 トラックで同時に取れるか。2 本の WAV を書き、RMS を出す。
//!
//! 使い方: cargo run --release --bin cpal_two_track -- <秒数> <出力ディレクトリ>

use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, SupportedStreamConfig};

struct Track {
    name: &'static str,
    rate: u32,
    channels: u16,
    pcm: Arc<Mutex<Vec<f32>>>,
    _stream: Stream,
}

fn open(device: &cpal::Device, cfg: SupportedStreamConfig, name: &'static str) -> Result<Track> {
    let pcm = Arc::new(Mutex::new(Vec::<f32>::new()));
    let sink = pcm.clone();
    let sink16 = pcm.clone();
    let err_fn = move |e| eprintln!("[{name}] stream error: {e}");
    let stream_cfg: cpal::StreamConfig = cfg.clone().into();
    let stream = match cfg.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            stream_cfg.clone(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| sink.lock().unwrap().extend_from_slice(data),
            err_fn,
            None,
        )?,
        SampleFormat::I16 => device.build_input_stream(
            stream_cfg.clone(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                sink16.lock().unwrap().extend(data.iter().map(|s| *s as f32 / 32768.0))
            },
            err_fn,
            None,
        )?,
        other => anyhow::bail!("[{name}] 未対応の sample format: {other:?}"),
    };
    stream.play()?;
    let rate: u32 = cfg.sample_rate().into();
    Ok(Track { name, rate, channels: cfg.channels(), pcm, _stream: stream })
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let secs: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(8);
    let out_dir = args.next().unwrap_or_else(|| ".".to_string());
    // --mic-only: ループバック（tap）を作らずマイクだけ試す
    let mic_only = args.any(|a| a == "--mic-only");
    std::fs::create_dir_all(&out_dir)?;

    let host = cpal::default_host();

    // 再生音: 既定の「出力」デバイスに入力ストリームを作る → cpal が Core Audio tap を張る
    let out_dev = host.default_output_device().context("既定の出力デバイスが無い")?;
    let out_cfg = out_dev.default_output_config()?;
    eprintln!("[system] device={:?} cfg={:?}", out_dev.description().map(|d| d.name().to_string()), out_cfg);
    let system = if mic_only { None } else { Some(open(&out_dev, out_cfg, "system").context("ループバック（tap）の作成")?) };

    // マイク: 既定の入力デバイス
    let in_dev = host.default_input_device().context("既定の入力デバイスが無い")?;
    let in_cfg = in_dev.default_input_config()?;
    eprintln!("[mic] device={:?} cfg={:?}", in_dev.description().map(|d| d.name().to_string()), in_cfg);
    let mic = open(&in_dev, in_cfg, "mic").context("マイク入力の作成")?;

    eprintln!("[rec] {secs} 秒録音 — 再生音とマイクの両方を鳴らしてください");
    std::thread::sleep(Duration::from_secs(secs));

    for t in system.iter().chain(std::iter::once(&mic)) {
        let pcm = t.pcm.lock().unwrap();
        let path = format!("{out_dir}/{}.wav", t.name);
        let spec = hound::WavSpec {
            channels: t.channels,
            sample_rate: t.rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut w = hound::WavWriter::create(&path, spec)?;
        for s in pcm.iter() {
            w.write_sample(*s)?;
        }
        w.finalize()?;
        let n = pcm.len().max(1);
        let rms = (pcm.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / n as f64).sqrt();
        let peak = pcm.iter().fold(0f32, |m, s| m.max(s.abs()));
        println!(
            "{}: rate={} ch={} seconds={:.2} rms={rms:.5} peak={peak:.3} verdict={}",
            t.name,
            t.rate,
            t.channels,
            pcm.len() as f64 / (t.rate as f64 * t.channels as f64),
            if rms > 1e-3 { "SOUND" } else { "SILENT" }
        );
    }
    Ok(())
}
