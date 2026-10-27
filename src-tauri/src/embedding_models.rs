//! 端末内の埋め込み（fastembed = ONNX Runtime + tokenizers）とモデル管理。
//!
//! - モデル: `appdata/models/embedding/<name>/`（model_quantized.onnx・tokenizer.json・config.json・
//!   tokenizer_config.json・special_tokens_map.json）。Hugging Face の Xenova 版 ONNX（q8）を whisper と同じ downloader で
//!   1 ファイルずつ取得し、SHA256 を検証する。モデルは同梱しない
//! - 推論: モデルごとに 1 つの TextEmbedding を遅延ロードして保持する（bge-m3 で約 600 MB）。
//!   入力は 512 トークンで切る（弾かない）。出力は L2 正規化して返す
//! - 設計: docs/internal/local-embedding-design-2026-10.md。評価: Crucible experiments/2026-10-27-local-embedding-eval

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::model_download::{download_file, part_path, DownloadTarget, CANCELLED};

// ---------------------------------------------------------------------------
// モデル定義
// ---------------------------------------------------------------------------
/// 入力の上限（トークン）。超えた分は切る。API（Sakura の e5-large）は 512 超を弾くが端末内は弾かない
pub const MAX_LENGTH: usize = 512;
/// 1 回の推論に渡す文の数。長い配列はこれずつ回す
const BATCH_SIZE: usize = 32;

pub struct ModelFile {
    pub name: &'static str,
    pub remote_path: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

pub struct ModelSpec {
    /// 設定・コマンドで使う名前
    pub name: &'static str,
    /// embedding-store の modelVersion に入れる値（版が変わったら全件再埋め込みになる）
    pub version: &'static str,
    pub repo: &'static str,
    pub dims: usize,
    pub pooling: Pooling,
    pub query_prefix: &'static str,
    pub passage_prefix: &'static str,
    pub files: &'static [ModelFile],
}

const BGE_M3_FILES: [ModelFile; 5] = [
    ModelFile {
        name: "model_quantized.onnx",
        remote_path: "onnx/model_quantized.onnx",
        sha256: "0826f8c1ab9edf1801db86c61919d4d108e8bfc0b809ec823ad366882ff0b77d",
        bytes: 569_694_530,
    },
    ModelFile {
        name: "tokenizer.json",
        remote_path: "tokenizer.json",
        sha256: "6710678b12670bc442b99edc952c4d996ae309a7020c1fa0096dd245c2faf790",
        bytes: 17_082_821,
    },
    ModelFile {
        name: "config.json",
        remote_path: "config.json",
        sha256: "734a79bf12d388c1467a4e3ab625f45de7f6906cffcfb93a1eca1787504bed95",
        bytes: 770,
    },
    ModelFile {
        name: "tokenizer_config.json",
        remote_path: "tokenizer_config.json",
        sha256: "7e4c1cc848840aeccdd763458c18dd525eb0f795c992e00ebe9c28554e7db2d4",
        bytes: 1_173,
    },
    ModelFile {
        name: "special_tokens_map.json",
        remote_path: "special_tokens_map.json",
        sha256: "8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835",
        bytes: 964,
    },
];

const E5_SMALL_FILES: [ModelFile; 5] = [
    ModelFile {
        name: "model_quantized.onnx",
        remote_path: "onnx/model_quantized.onnx",
        sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
        bytes: 118_308_185,
    },
    ModelFile {
        name: "tokenizer.json",
        remote_path: "tokenizer.json",
        sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
        bytes: 17_082_730,
    },
    ModelFile {
        name: "config.json",
        remote_path: "config.json",
        sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
        bytes: 658,
    },
    ModelFile {
        name: "tokenizer_config.json",
        remote_path: "tokenizer_config.json",
        sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
        bytes: 443,
    },
    ModelFile {
        name: "special_tokens_map.json",
        remote_path: "special_tokens_map.json",
        sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
        bytes: 167,
    },
];

/// 選べるモデル。順番は設定画面の並び（既定 = 先頭）
pub const MODELS: [ModelSpec; 2] = [
    ModelSpec {
        name: "bge-m3",
        version: "local:bge-m3-q8",
        repo: "Xenova/bge-m3",
        dims: 1024,
        pooling: Pooling::Cls,
        query_prefix: "",
        passage_prefix: "",
        files: &BGE_M3_FILES,
    },
    ModelSpec {
        name: "multilingual-e5-small",
        version: "local:multilingual-e5-small-q8",
        repo: "Xenova/multilingual-e5-small",
        dims: 384,
        pooling: Pooling::Mean,
        query_prefix: "query: ",
        passage_prefix: "passage: ",
        files: &E5_SMALL_FILES,
    },
];

pub fn model_spec(name: &str) -> Result<&'static ModelSpec, String> {
    MODELS
        .iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("unknown embedding model: {name}"))
}

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub name: &'static str,
    pub version: &'static str,
    pub dims: usize,
    pub present: bool,
    pub bytes: u64,
    pub expected_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedResult {
    pub vectors: Vec<Vec<f32>>,
    pub model_version: &'static str,
}

#[derive(Default)]
pub struct EmbeddingState {
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// ロード済みのエンジン（モデル名 → TextEmbedding）。推論は Mutex を握って順に行う
    engines: Mutex<HashMap<String, Arc<Mutex<TextEmbedding>>>>,
}

// ---------------------------------------------------------------------------
// 純関数
// ---------------------------------------------------------------------------
/// kind（"query" / "passage"）に応じた接頭辞を付ける。e5 系だけが使い、bge-m3 は空
pub fn with_prefix(spec: &ModelSpec, kind: &str, text: &str) -> String {
    let prefix = match kind {
        "query" => spec.query_prefix,
        _ => spec.passage_prefix,
    };
    format!("{prefix}{text}")
}

/// L2 正規化（cosine を内積で取れるように）。ゼロベクトルはそのまま
pub fn l2_normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// 揃っているファイルのバイト数の合計と、全ファイルが期待どおりの大きさかどうか
pub fn status_of(spec: &ModelSpec, sizes: impl Fn(&str) -> u64) -> (u64, bool) {
    let mut bytes = 0;
    let mut present = true;
    for f in spec.files {
        let b = sizes(f.name);
        bytes += b;
        if b != f.bytes {
            present = false;
        }
    }
    (bytes, present)
}

// ---------------------------------------------------------------------------
// モデル管理
// ---------------------------------------------------------------------------
fn models_dir(name: &str) -> Result<PathBuf, String> {
    Ok(crate::appdata_dir()?
        .join("models")
        .join("embedding")
        .join(name))
}

fn model_present(spec: &ModelSpec) -> bool {
    let Ok(dir) = models_dir(spec.name) else {
        return false;
    };
    status_of(spec, |f| {
        std::fs::metadata(dir.join(f)).map(|m| m.len()).unwrap_or(0)
    })
    .1
}

#[tauri::command]
pub fn embedding_model_status() -> Result<Vec<ModelStatus>, String> {
    MODELS
        .iter()
        .map(|spec| {
            let dir = models_dir(spec.name)?;
            let (bytes, present) = status_of(spec, |f| {
                std::fs::metadata(dir.join(f)).map(|m| m.len()).unwrap_or(0)
            });
            Ok(ModelStatus {
                name: spec.name,
                version: spec.version,
                dims: spec.dims,
                present,
                bytes,
                expected_bytes: spec.files.iter().map(|f| f.bytes).sum(),
            })
        })
        .collect()
}

/// downloads への登録を Drop で外す（panic や早期 return でも残さない）
struct DownloadGuard<'a> {
    state: &'a EmbeddingState,
    name: &'static str,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut d) = self.state.downloads.lock() {
            d.remove(self.name);
        }
    }
}

async fn download_model(
    app: &tauri::AppHandle,
    spec: &ModelSpec,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let dir = models_dir(spec.name)?;
    let total: u64 = spec.files.iter().map(|f| f.bytes).sum();
    let mut done_bytes: u64 = 0;
    // 大きいファイル（onnx）から取る。途中で止めても小さいファイルだけ残る形にしない
    for f in spec.files {
        let final_path = dir.join(f.name);
        if std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0) == f.bytes {
            done_bytes += f.bytes;
            continue;
        }
        let target = DownloadTarget {
            url: format!(
                "https://huggingface.co/{}/resolve/main/{}",
                spec.repo, f.remote_path
            ),
            final_path,
            sha256: f.sha256.to_string(),
            expected_bytes: f.bytes,
        };
        download_file(&target, cancel, |received, _| {
            let _ = app.emit(
                "embedding-model-progress",
                serde_json::json!({ "name": spec.name, "received": done_bytes + received, "total": total }),
            );
        })
        .await?;
        done_bytes += f.bytes;
    }
    Ok(())
}

#[tauri::command]
pub async fn embedding_model_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, EmbeddingState>,
    name: String,
) -> Result<(), String> {
    let spec = model_spec(&name)?;
    if model_present(spec) {
        let _ = app.emit(
            "embedding-model-done",
            serde_json::json!({ "name": spec.name }),
        );
        return Ok(());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut d = state
            .downloads
            .lock()
            .map_err(|_| "state poisoned".to_string())?;
        if d.contains_key(spec.name) {
            return Err("already downloading".to_string());
        }
        d.insert(spec.name.to_string(), cancel.clone());
    }
    let _guard = DownloadGuard {
        state: &state,
        name: spec.name,
    };
    match download_model(&app, spec, &cancel).await {
        Ok(()) => {
            let _ = app.emit(
                "embedding-model-done",
                serde_json::json!({ "name": spec.name }),
            );
            Ok(())
        }
        Err(e) if e == CANCELLED => {
            let _ = app.emit(
                "embedding-model-cancelled",
                serde_json::json!({ "name": spec.name }),
            );
            Ok(())
        }
        Err(message) => {
            let _ = app.emit(
                "embedding-model-error",
                serde_json::json!({ "name": spec.name, "message": message }),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn embedding_model_cancel(
    state: tauri::State<'_, EmbeddingState>,
    name: String,
) -> Result<(), String> {
    let spec = model_spec(&name)?;
    if let Some(flag) = state
        .downloads
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .get(spec.name)
    {
        flag.store(true, Ordering::Relaxed);
    }
    let dir = models_dir(spec.name)?;
    for f in spec.files {
        let _ = std::fs::remove_file(part_path(&dir.join(f.name)));
    }
    Ok(())
}

/// 取得中なら取り消してから消す。ロード済みのエンジンも手放す
#[tauri::command]
pub fn embedding_model_delete(
    state: tauri::State<'_, EmbeddingState>,
    name: String,
) -> Result<(), String> {
    let spec = model_spec(&name)?;
    if let Some(flag) = state
        .downloads
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .get(spec.name)
    {
        flag.store(true, Ordering::Relaxed);
    }
    if let Ok(mut e) = state.engines.lock() {
        e.remove(spec.name);
    }
    let dir = models_dir(spec.name)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("モデルを削除できません: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 推論
// ---------------------------------------------------------------------------
fn load_engine(spec: &ModelSpec) -> Result<TextEmbedding, String> {
    let dir = models_dir(spec.name)?;
    let read = |name: &str| {
        std::fs::read(dir.join(name))
            .map_err(|e| format!("モデルファイルを読めません（{name}）: {e}"))
    };
    let files = TokenizerFiles {
        tokenizer_file: read("tokenizer.json")?,
        config_file: read("config.json")?,
        special_tokens_map_file: read("special_tokens_map.json")?,
        tokenizer_config_file: read("tokenizer_config.json")?,
    };
    let model = UserDefinedEmbeddingModel::new(read("model_quantized.onnx")?, files)
        .with_pooling(spec.pooling.clone());
    TextEmbedding::try_new_from_user_defined(
        model,
        InitOptionsUserDefined::new().with_max_length(MAX_LENGTH),
    )
    .map_err(|e| format!("埋め込みモデルを読み込めません: {e}"))
}

fn engine_for(
    state: &EmbeddingState,
    spec: &ModelSpec,
) -> Result<Arc<Mutex<TextEmbedding>>, String> {
    let mut engines = state
        .engines
        .lock()
        .map_err(|_| "state poisoned".to_string())?;
    if let Some(e) = engines.get(spec.name) {
        return Ok(e.clone());
    }
    if !model_present(spec) {
        return Err(format!("EMBEDDING_MODEL_NOT_DOWNLOADED:{}", spec.name));
    }
    let engine = Arc::new(Mutex::new(load_engine(spec)?));
    engines.insert(spec.name.to_string(), engine.clone());
    Ok(engine)
}

/// `kind` は "query"（質問）か "passage"（節・候補）。接頭辞の要るモデルだけが使う
#[tauri::command]
pub async fn embedding_embed(
    app: tauri::AppHandle,
    name: String,
    texts: Vec<String>,
    kind: String,
) -> Result<EmbedResult, String> {
    let spec = model_spec(&name)?;
    if texts.is_empty() {
        return Ok(EmbedResult {
            vectors: vec![],
            model_version: spec.version,
        });
    }
    let state = app.state::<EmbeddingState>();
    let engine = engine_for(&state, spec)?;
    let inputs: Vec<String> = texts.iter().map(|t| with_prefix(spec, &kind, t)).collect();
    // CPU を長く使うので async runtime のスレッドを塞がない
    let vectors = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Vec<f32>>, String> {
        let mut eng = engine.lock().map_err(|_| "engine poisoned".to_string())?;
        let started = std::time::Instant::now();
        let mut out = Vec::with_capacity(inputs.len());
        for chunk in inputs.chunks(BATCH_SIZE) {
            let vs = eng
                .embed(chunk, Some(BATCH_SIZE))
                .map_err(|e| format!("埋め込みに失敗: {e}"))?;
            for mut v in vs {
                l2_normalize(&mut v);
                out.push(v);
            }
        }
        eprintln!(
            "[embedding] {} texts in {} ms ({name})",
            inputs.len(),
            started.elapsed().as_millis()
        );
        Ok(out)
    })
    .await
    .map_err(|e| format!("embedding task failed: {e}"))??;
    Ok(EmbedResult {
        vectors,
        model_version: spec.version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_only_for_e5() {
        let e5 = model_spec("multilingual-e5-small").unwrap();
        assert_eq!(with_prefix(e5, "query", "焼結"), "query: 焼結");
        assert_eq!(with_prefix(e5, "passage", "焼結"), "passage: 焼結");
        let bge = model_spec("bge-m3").unwrap();
        assert_eq!(with_prefix(bge, "query", "焼結"), "焼結");
    }

    #[test]
    fn normalize_to_unit_length() {
        let mut v = vec![3.0, 4.0];
        l2_normalize(&mut v);
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
        let mut z = vec![0.0, 0.0];
        l2_normalize(&mut z);
        assert_eq!(z, vec![0.0, 0.0]);
    }

    #[test]
    fn status_requires_every_file_at_expected_size() {
        let spec = model_spec("multilingual-e5-small").unwrap();
        let (bytes, present) = status_of(spec, |f| {
            spec.files.iter().find(|x| x.name == f).unwrap().bytes
        });
        assert!(present);
        assert_eq!(bytes, spec.files.iter().map(|f| f.bytes).sum::<u64>());
        // onnx だけ途中（0 バイト）なら present にならない
        let (bytes2, present2) = status_of(spec, |f| {
            if f == "model_quantized.onnx" {
                0
            } else {
                spec.files.iter().find(|x| x.name == f).unwrap().bytes
            }
        });
        assert!(!present2);
        assert!(bytes2 < bytes);
    }

    /// 実モデルで推論し、評価（transformers.js・同じ ONNX）で作ったベクトルと一致するか見る。
    /// GRAPHIUM_EMBED_TEST_DIR=<モデルの親ディレクトリ。fixtures.json も置く> cargo test real_model -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_model_embeds_and_matches_transformers_js() {
        let root = std::path::PathBuf::from(
            std::env::var("GRAPHIUM_EMBED_TEST_DIR").expect("GRAPHIUM_EMBED_TEST_DIR"),
        );
        let fixtures: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("fixtures.json")).unwrap()).unwrap();
        for spec in &MODELS {
            let dir = root.join(spec.name);
            let read = |n: &str| std::fs::read(dir.join(n)).unwrap();
            let files = TokenizerFiles {
                tokenizer_file: read("tokenizer.json"),
                config_file: read("config.json"),
                special_tokens_map_file: read("special_tokens_map.json"),
                tokenizer_config_file: read("tokenizer_config.json"),
            };
            let model = UserDefinedEmbeddingModel::new(read("model_quantized.onnx"), files)
                .with_pooling(spec.pooling.clone());
            let mut eng = TextEmbedding::try_new_from_user_defined(
                model,
                InitOptionsUserDefined::new().with_max_length(MAX_LENGTH),
            )
            .unwrap();
            let cases = fixtures[spec.name].as_array().unwrap();
            let texts: Vec<String> = cases
                .iter()
                .map(|c| with_prefix(spec, "passage", c["text"].as_str().unwrap()))
                .collect();
            let started = std::time::Instant::now();
            let mut vs = eng.embed(&texts, None).unwrap();
            let ms = started.elapsed().as_millis();
            for (v, c) in vs.iter_mut().zip(cases) {
                l2_normalize(v);
                assert_eq!(v.len(), spec.dims);
                let want: Vec<f32> = c["vector"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|x| x.as_f64().unwrap() as f32)
                    .collect();
                let cos: f32 = v.iter().zip(&want).map(|(a, b)| a * b).sum();
                eprintln!(
                    "{}: cos(rust, transformers.js) = {cos:.4} for {} chars ({ms} ms for {} texts)",
                    spec.name,
                    c["text"].as_str().unwrap().len(),
                    texts.len()
                );
                // 同じ ONNX・同じ pooling なら 0.97 以上（q8 の演算は padding の長さで僅かに変わる）。
                // tokenizer や pooling がずれていれば 0.9 を大きく割る
                assert!(cos > 0.97, "{}: cos {cos}", spec.name);
            }
        }
    }

    #[test]
    fn model_versions_are_distinct_and_prefixed_local() {
        let mut seen = std::collections::HashSet::new();
        for m in &MODELS {
            assert!(m.version.starts_with("local:"));
            assert!(seen.insert(m.version));
        }
    }
}
