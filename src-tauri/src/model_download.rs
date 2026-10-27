//! モデルファイルの取得（whisper と端末内埋め込みで共通）。
//!
//! - Hugging Face から stream で受け、`<final>.part` に書きながら SHA256 を取る
//! - 一致したら rename。途中の取り消し・切断・不一致は `.part` を消して Err
//! - 進捗は 1 MB ごとに `on_progress(received, total)` を呼ぶ（イベント名は呼び出し側が決める）

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;
use std::time::Duration;

use sha2::{Digest, Sha256};

/// 取り消しを表す Err の文字列。呼び出し側は「エラーではない」として扱う
pub const CANCELLED: &str = "cancelled";

pub struct DownloadTarget {
    pub url: String,
    pub final_path: PathBuf,
    pub sha256: String,
    pub expected_bytes: u64,
}

/// `<path>.part`（取得途中のファイル）
pub fn part_path(final_path: &Path) -> PathBuf {
    let mut name = final_path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".part");
    final_path.with_file_name(name)
}

pub async fn download_file(
    target: &DownloadTarget,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    use futures_util::StreamExt;

    // reqwest（rustls-no-provider）は既定の暗号プロバイダが無いと Client 作成で panic する。
    // 1 回だけ ring を入れる（既に入っていれば Err なので無視）
    static TLS_INIT: Once = Once::new();
    TLS_INIT.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });

    if let Some(dir) = target.final_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("書き込み失敗: {e}"))?;
    }
    let part = part_path(&target.final_path);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("モデルの取得に失敗: {e}"))?;
    let resp = client
        .get(&target.url)
        .send()
        .await
        .map_err(|e| format!("モデルの取得に失敗: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("モデルの取得に失敗: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(target.expected_bytes);

    let result = async {
        let mut file = std::fs::File::create(&part).map_err(|e| format!("書き込み失敗: {e}"))?;
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
            file.write_all(&chunk)
                .map_err(|e| format!("書き込み失敗: {e}"))?;
            received += chunk.len() as u64;
            if received - last_emit >= 1_000_000 {
                last_emit = received;
                on_progress(received, total);
            }
        }
        // ストリームが終わった直後の取り消しも拾う（検証・rename に進まない）
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        file.flush().map_err(|e| format!("書き込み失敗: {e}"))?;
        drop(file);
        let digest: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if digest != target.sha256 {
            return Err("checksum mismatch".to_string());
        }
        Ok(())
    }
    .await;

    match result {
        Ok(()) => std::fs::rename(&part, &target.final_path)
            .map_err(|e| format!("モデルの保存に失敗: {e}")),
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn part_path_appends_suffix_to_full_name() {
        let p = part_path(Path::new("/x/models/ggml-small.bin"));
        assert_eq!(p, PathBuf::from("/x/models/ggml-small.bin.part"));
        let q = part_path(Path::new("/x/models/model_quantized.onnx"));
        assert_eq!(q, PathBuf::from("/x/models/model_quantized.onnx.part"));
    }
}
