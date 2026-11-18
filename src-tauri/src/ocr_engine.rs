//! PP-OCRv6（検出 DB + 認識 CTC）を ONNX Runtime で動かす OCR エンジン。
//!
//! アプリ（Tauri / src-tauri）へそのまま移せるよう、推論と前後処理をこの 1 ファイルに閉じている。
//! 前後処理は rapidocr 3.10.0 の Python 実装（ch_ppocr_det / ch_ppocr_rec / utils）に合わせてある。
//! OpenCV にも imageproc にも依存しない。輪郭（2 値マスクの連結成分の境界画素）・最小外接矩形・
//! 透視変換・リサイズはすべて自前。
//!
//! 依存: ort（=2.0.0-rc.11・fastembed と同じ版）、image、ndarray（0.17）、anyhow。
//!
//! 使い方:
//! ```ignore
//! let engine = OcrEngine::load(det_onnx, rec_onnx, dict)?;
//! let lines = engine.recognize(&img, &OcrOptions::default())?;
//! let text = layout_text(&lines);
//! ```

use std::borrow::Cow;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use anyhow::{anyhow, Result};
use image::{DynamicImage, RgbImage};
use ndarray::Array4;
use ort::session::Session;
use ort::value::Tensor;

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

/// 認識した 1 行。quad は元画像の座標で、左上・右上・右下・左下の順。
#[derive(Clone, Debug)]
pub struct OcrLine {
    pub text: String,
    pub score: f32,
    pub quad: [[f32; 2]; 4],
}

/// 検出の設定。既定は PaddleOCR 公式の inference.yml の値（`official()`）。
/// 試作ではここに rapidocr（Python）の既定値も並べて比べた（実験: experiments/2026-11-18-ocr-engine-compare）
#[derive(Clone, Debug)]
pub struct DetParams {
    pub thresh: f32,
    pub box_thresh: f32,
    pub unclip_ratio: f64,
    pub max_candidates: usize,
    /// 短辺がこの値より小さいときだけ拡大する（rapidocr: limit_type=min, 736）
    pub limit_side_len: u32,
    /// 正規化（BGR 順のチャンネルに順に適用）
    pub mean: [f32; 3],
    pub std: [f32; 3],
    pub use_dilation: bool,
}

impl DetParams {
    /// PP-OCRv6_small_det の inference.yml（DBPostProcess）の値
    pub fn official() -> Self {
        Self {
            thresh: 0.2,
            box_thresh: 0.45,
            unclip_ratio: 1.4,
            max_candidates: 3000,
            limit_side_len: 736,
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225],
            use_dilation: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct OcrOptions {
    /// 検出の前に長辺をこの値へ縮める（0 = 縮めない）。検出のメモリの上限になる。
    /// 認識の切り出しは縮める前の元画像から行う。
    pub max_side: u32,
    pub det: DetParams,
    /// 認識の信頼度がこの値未満の行は捨てる（rapidocr の text_score）
    pub text_score: f32,
    /// true なら切り出しを検出用の画像から行う（rapidocr と同じ。比較・診断用）
    pub crop_from_det_image: bool,
    /// これを過ぎたら `OCR_TIMEOUT` で打ち切る。検出のあと・認識の各バッチの前（と切り出しの 1 枚ごと）に見る。
    /// 1 回のモデル実行（検出 1 回・認識 1 バッチ）の途中では止められない
    pub deadline: Option<Instant>,
}

/// 時間切れで打ち切ったときのエラー文字列（呼び出し側が文字列で見分ける）
pub const OCR_TIMEOUT: &str = "OCR_TIMEOUT";

/// 検出の前に縮める長辺の既定（検出のメモリ・時間の上限）
pub const DEFAULT_MAX_SIDE: u32 = 1600;
/// 検出入力（32 の倍数に丸めた後）の長辺の上限。細長い画像でも超えない。
/// 縮小後の長辺（DEFAULT_MAX_SIDE = 1600）の 2 倍: 短辺の拡大（736 まで）で通常の横長の画像
/// （例 395 x 154 → 1888 x 736）が従来と同じ結果になる余裕。メモリの上限は総画素数のほうで決まる
pub const DET_MAX_SIDE: u32 = 3200;
/// 検出入力の総画素数の上限（1600 x 1600）。短辺の拡大でここを超えないよう倍率を抑える
pub const DET_MAX_PIXELS: u64 = 1600 * 1600;
/// 元画像の短辺がこれ未満なら検出せず空を返す（文字が読める大きさではなく、拡大の倍率だけが膨らむため）
pub const MIN_DETECT_SIDE: u32 = 8;
/// 切り出し 1 枚の総画素数の上限。超える切り出しは比率を保ったまま小さく取る（認識は高さ 48 に縮めるので読みは落ちない）
const CROP_MAX_PIXELS: u64 = 8 * 1024 * 1024;
/// 認識入力の幅の上限（高さは 48）。極端に横長の切り出しは幅方向に縮めて入れる
const REC_MAX_WIDTH: usize = 8192;
/// ONNX Runtime の intra_op スレッド数の既定
pub const DEFAULT_INTRA_THREADS: usize = 4;
/// デコードする画像の幅・高さの上限（ピクセル）
const DECODE_MAX_DIM: u32 = 20_000;
/// デコード中に確保してよいメモリの上限（バイト）
const DECODE_MAX_ALLOC: u64 = 512 * 1024 * 1024;

/// 画像のバイト列をデコードする。巨大な画像・展開爆弾でメモリを使い切らないよう上限を付ける
pub fn decode_image(bytes: &[u8]) -> Result<DynamicImage> {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(DECODE_MAX_DIM);
    limits.max_image_height = Some(DECODE_MAX_DIM);
    limits.max_alloc = Some(DECODE_MAX_ALLOC);
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()?;
    reader.limits(limits);
    Ok(reader.decode()?)
}

impl Default for OcrOptions {
    fn default() -> Self {
        Self { max_side: DEFAULT_MAX_SIDE, det: DetParams::official(), text_score: 0.5, crop_from_det_image: false, deadline: None }
    }
}

// ---------------------------------------------------------------------------
// エンジン
// ---------------------------------------------------------------------------

pub struct OcrEngine {
    det: Mutex<Session>,
    rec: Mutex<Session>,
    /// CTC の文字表。index 0 = blank、末尾 = 半角空白（rapidocr と同じ）
    charset: Vec<String>,
}

/// poison されていても中身を取り出して続ける（1 回の panic で再起動まで OCR が使えなくなるのを防ぐ）。
/// poison は外しておく
pub fn lock_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| {
        m.clear_poison();
        e.into_inner()
    })
}

/// 検出の前に長辺を max_side へ縮めた寸法（rapidocr の reduce_max_side: int で切り捨て）。0 = 縮めない
fn shrunk_dims(ow: u32, oh: u32, max_side: u32) -> (u32, u32) {
    if max_side > 0 && ow.max(oh) > max_side {
        let ratio = max_side as f64 / ow.max(oh) as f64;
        (((ow as f64 * ratio) as u32).max(1), ((oh as f64 * ratio) as u32).max(1))
    } else {
        (ow, oh)
    }
}

/// 横に極端に長い・低い画像の上下に足す黒の高さ（rapidocr の use_vertical_padding）。足さないなら 0
fn vertical_padding(bw: u32, bh: u32) -> u32 {
    if bh <= 30 || bw as f64 / bh as f64 > 8.0 {
        let new_h = ((bw / 8).max(30)) * 2;
        (new_h as i64 - bh as i64).unsigned_abs() as u32 / 2
    } else {
        0
    }
}

fn check_deadline(deadline: Option<Instant>) -> Result<()> {
    match deadline {
        Some(d) if Instant::now() >= d => Err(anyhow!(OCR_TIMEOUT)),
        _ => Ok(()),
    }
}

/// RGB 化。アルファ付きは白い背景に合成する（透明部の RGB は黒のことが多く、
/// そのまま捨てると黒文字の透過 PNG が黒地に黒文字になる）
fn to_rgb_on_white(img: &DynamicImage) -> Cow<'_, RgbImage> {
    match img {
        DynamicImage::ImageRgb8(i) => Cow::Borrowed(i),
        other if other.color().has_alpha() => {
            let rgba = other.to_rgba8();
            let (w, h) = rgba.dimensions();
            let mut out = RgbImage::new(w, h);
            for (o, p) in out.pixels_mut().zip(rgba.pixels()) {
                let a = p.0[3] as u32;
                for c in 0..3 {
                    // 前景 * a + 白 * (255 - a)、四捨五入
                    o.0[c] = ((p.0[c] as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
                }
            }
            Cow::Owned(out)
        }
        other => Cow::Owned(other.to_rgb8()),
    }
}

/// 文字辞書（1 行 1 文字）を読む。改行（\n）だけで区切り、空白文字は落とさない
pub fn parse_dict(text: &str) -> Vec<String> {
    let mut v: Vec<String> = text.split('\n').map(|s| s.trim_end_matches('\r').to_string()).collect();
    if v.last().map(|s| s.is_empty()).unwrap_or(false) {
        v.pop();
    }
    v
}

impl OcrEngine {
    pub fn load(det_onnx: &Path, rec_onnx: &Path, dict: Vec<String>) -> Result<Self> {
        Self::load_with_threads(det_onnx, rec_onnx, dict, Some(DEFAULT_INTRA_THREADS))
    }

    /// intra_op のスレッド数を指定して読み込む（None = ONNX Runtime の既定）
    pub fn load_with_threads(
        det_onnx: &Path,
        rec_onnx: &Path,
        dict: Vec<String>,
        intra_threads: Option<usize>,
    ) -> Result<Self> {
        let build = |p: &Path| -> Result<Session> {
            let mut b = Session::builder()?;
            if let Some(n) = intra_threads {
                b = b.with_intra_threads(n)?;
            }
            Ok(b.commit_from_file(p)?)
        };
        let mut charset = Vec::with_capacity(dict.len() + 2);
        charset.push("blank".to_string());
        charset.extend(dict);
        charset.push(" ".to_string());
        Ok(Self { det: Mutex::new(build(det_onnx)?), rec: Mutex::new(build(rec_onnx)?), charset })
    }

    pub fn recognize(&self, img: &DynamicImage, opt: &OcrOptions) -> Result<Vec<OcrLine>> {
        // 先に寸法だけで弾く（RGB 化の確保の前）。0 も含む
        if img.width().min(img.height()) < MIN_DETECT_SIDE {
            return Ok(vec![]);
        }
        let orig = to_rgb_on_white(img);
        let (ow, oh) = orig.dimensions();

        // 1. 検出用に長辺を縮める（rapidocr の reduce_max_side: int で切り捨て）
        let mut shrunk: Option<RgbImage> = None;
        let (nw, nh) = shrunk_dims(ow, oh, opt.max_side);
        if (nw, nh) != (ow, oh) {
            shrunk = Some(resize_bilinear(&orig, nw, nh));
        }
        let base: &RgbImage = shrunk.as_ref().unwrap_or(orig.as_ref());
        let (bw, bh) = base.dimensions();

        // 2. 横に極端に長い・低い画像は上下に黒を足す（rapidocr の use_vertical_padding）
        let pad_top = vertical_padding(bw, bh);
        let mut padded: Option<RgbImage> = None;
        if pad_top > 0 {
            let mut p = RgbImage::new(bw, bh + pad_top * 2);
            image::imageops::replace(&mut p, base, 0, pad_top as i64);
            padded = Some(p);
        }
        let det_img: &RgbImage = padded.as_ref().unwrap_or(base);

        // 3. 検出
        let boxes = self.detect(det_img, &opt.det)?;
        if boxes.is_empty() {
            return Ok(vec![]);
        }

        // 4. 検出画像の座標 → 元画像の座標
        let boxes_det: Vec<[[f32; 2]; 4]> = boxes.iter().map(|(q, _)| *q).collect();
        let sx = ow as f32 / bw as f32;
        let sy = oh as f32 / bh as f32;
        let quads: Vec<([[f32; 2]; 4], f32)> = boxes
            .into_iter()
            .map(|(q, s)| {
                let mut o = [[0f32; 2]; 4];
                for i in 0..4 {
                    o[i] = [q[i][0] * sx, (q[i][1] - pad_top as f32) * sy];
                }
                (o, s)
            })
            .collect();
        // 5・6. 切り出して認識する。既定は縮める前の元画像から（細部が残る）。crop_from_det_image は
        //    rapidocr と同じく検出に使った画像（縮小・パディング後）から切る比較用。
        //    切り出しはバッチごとに作る（全部を同時に持たない）
        check_deadline(opt.deadline)?;
        let recs = if opt.crop_from_det_image {
            self.recognize_crops(det_img, &boxes_det, opt.deadline)?
        } else {
            let orig_quads: Vec<[[f32; 2]; 4]> = quads.iter().map(|(q, _)| *q).collect();
            self.recognize_crops(&orig, &orig_quads, opt.deadline)?
        };

        let mut out = Vec::new();
        for ((quad, _), (text, score)) in quads.into_iter().zip(recs) {
            if text.trim().is_empty() || score < opt.text_score {
                continue;
            }
            out.push(OcrLine { text, score, quad });
        }
        Ok(out)
    }

    // ---- 検出 ----

    /// 検出画像の座標（整数）で 4 点と検出スコアを返す。並べ替え済み
    fn detect(&self, img: &RgbImage, p: &DetParams) -> Result<Vec<([[f32; 2]; 4], f32)>> {
        let (w, h) = img.dimensions();
        let (rw, rh) = det_resize_dims(w, h, p.limit_side_len);
        let resized = if (rw, rh) == (w, h) { Cow::Borrowed(img) } else { Cow::Owned(resize_bilinear(img, rw, rh)) };

        // BGR 順の CHW に正規化
        let (rwu, rhu) = (rw as usize, rh as usize);
        let mut data = vec![0f32; 3 * rwu * rhu];
        let plane = rwu * rhu;
        for (i, px) in resized.pixels().enumerate() {
            for c in 0..3 {
                // c = 0:B 1:G 2:R
                let v = px.0[2 - c] as f32 / 255.0;
                data[c * plane + i] = (v - p.mean[c]) / p.std[c];
            }
        }
        drop(resized);
        let input = Array4::from_shape_vec((1, 3, rhu, rwu), data)?;
        let pred: Vec<f32> = {
            let mut s = lock_recover(&self.det);
            let outs = s.run(ort::inputs!["x" => Tensor::from_array(input)?])?;
            let (shape, d) = outs[0].try_extract_tensor::<f32>()?;
            if shape.len() != 4 || shape[2] as usize != rhu || shape[3] as usize != rwu {
                return Err(anyhow!("検出の出力形状が想定外: {:?}", shape));
            }
            d.to_vec()
        };

        let (boxes, scores) = db_postprocess(&pred, rhu, rwu, p, w as usize, h as usize);
        let order = sort_boxes(&boxes);
        Ok(order.into_iter().map(|i| (boxes[i], scores[i])).collect())
    }

    // ---- 認識 ----

    fn recognize_crops(
        &self,
        src: &RgbImage,
        quads: &[[[f32; 2]; 4]],
        deadline: Option<Instant>,
    ) -> Result<Vec<(String, f32)>> {
        const IMG_H: u32 = 48;
        const BATCH: usize = 6;
        let n = quads.len();
        let mut res = vec![(String::new(), 0f32); n];
        // 幅の比が小さい順に並べてバッチにする（rapidocr と同じ）。比は切り出しを作らず寸法だけから求める
        let ratios: Vec<f64> = quads
            .iter()
            .map(|q| {
                let (w, h) = crop_output_dims(q);
                w as f64 / h as f64
            })
            .collect();
        let mut idx: Vec<usize> = (0..n).collect();
        idx.sort_by(|&a, &b| ratios[a].partial_cmp(&ratios[b]).unwrap());

        for chunk in idx.chunks(BATCH) {
            check_deadline(deadline)?;
            let mut max_wh = 320.0f64 / 48.0;
            for &i in chunk {
                max_wh = max_wh.max(ratios[i]);
            }
            let img_w = ((IMG_H as f64 * max_wh) as usize).min(REC_MAX_WIDTH);
            let mut data = vec![0f32; chunk.len() * 3 * IMG_H as usize * img_w];
            for (b, &i) in chunk.iter().enumerate() {
                check_deadline(deadline)?;
                let c = rotate_crop(src, &quads[i]);
                let r = c.width() as f64 / c.height() as f64;
                let rw = ((IMG_H as f64 * r).ceil() as usize).min(img_w).max(1);
                let rs = resize_bilinear(&c, rw as u32, IMG_H);
                drop(c);
                let base = b * 3 * IMG_H as usize * img_w;
                for (y, row) in rs.rows().enumerate() {
                    for (x, px) in row.enumerate() {
                        for ch in 0..3 {
                            // BGR 順・(v/255 - 0.5)/0.5
                            let v = px.0[2 - ch] as f32 / 255.0;
                            data[base + ch * IMG_H as usize * img_w + y * img_w + x] = (v - 0.5) / 0.5;
                        }
                    }
                }
            }
            let input = Array4::from_shape_vec((chunk.len(), 3, IMG_H as usize, img_w), data)?;
            let mut s = lock_recover(&self.rec);
            let outs = s.run(ort::inputs!["x" => Tensor::from_array(input)?])?;
            let (shape, d) = outs[0].try_extract_tensor::<f32>()?;
            if shape.len() != 3 || shape[2] as usize != self.charset.len() {
                return Err(anyhow!(
                    "認識の出力のクラス数 {:?} と辞書（{}）が合わない",
                    shape,
                    self.charset.len()
                ));
            }
            let (t, c) = (shape[1] as usize, shape[2] as usize);
            for (b, &i) in chunk.iter().enumerate() {
                res[i] = ctc_decode(&d[b * t * c..(b + 1) * t * c], t, c, &self.charset);
            }
        }
        Ok(res)
    }
}

/// CTC のデコード。argmax → 連続の重複を消す → blank（0）を消す。
/// スコアは残した文字の確率の平均（5 桁に丸める）。何も残らなければ 0
pub fn ctc_decode(probs: &[f32], steps: usize, classes: usize, charset: &[String]) -> (String, f32) {
    let mut text = String::new();
    let mut sum = 0f64;
    let mut cnt = 0usize;
    let mut prev = usize::MAX;
    for t in 0..steps {
        let row = &probs[t * classes..(t + 1) * classes];
        let (mut bi, mut bv) = (0usize, f32::MIN);
        for (i, &v) in row.iter().enumerate() {
            if v > bv {
                bv = v;
                bi = i;
            }
        }
        if bi != prev && bi != 0 {
            text.push_str(&charset[bi]);
            sum += bv as f64;
            cnt += 1;
        }
        prev = bi;
    }
    let score = if cnt == 0 { 0.0 } else { ((sum / cnt as f64) * 1e5).round() / 1e5 };
    (text, score as f32)
}

// ---------------------------------------------------------------------------
// 検出の前処理・後処理（DBPostProcess）
// ---------------------------------------------------------------------------

/// 検出入力のサイズ: 短辺が limit 未満なら拡大し、32 の倍数に丸める（rapidocr の DetPreProcess.resize）。
/// ただし拡大は、長辺が DET_MAX_SIDE・総画素が DET_MAX_PIXELS を超えない範囲に抑える
/// （細長い画像で短辺を limit まで伸ばすと、確保が数百 MB〜数 GB になるため）。
/// 通常の画像は上限に掛からず、従来と同じ寸法になる
pub fn det_resize_dims(w: u32, h: u32, limit: u32) -> (u32, u32) {
    let ratio = if h.min(w) < limit {
        if h < w { limit as f64 / h as f64 } else { limit as f64 / w as f64 }
    } else {
        1.0
    };
    let within = |rw: u32, rh: u32| rw <= DET_MAX_SIDE && rh <= DET_MAX_SIDE && rw as u64 * rh as u64 <= DET_MAX_PIXELS;
    // Python の round は偶数丸め
    let r32 = |v: i64| ((v as f64 / 32.0).round_ties_even() as i64 * 32).max(32) as u32;
    let (rw, rh) = (r32((w as f64 * ratio) as i64), r32((h as f64 * ratio) as i64));
    if within(rw, rh) {
        return (rw, rh);
    }
    // 上限を超える: 倍率を上限内へ抑え、切り捨てで 32 の倍数にする（切り捨てなら上限を超えない）
    let (wf, hf) = (w.max(1) as f64, h.max(1) as f64);
    let cap = (DET_MAX_SIDE as f64 / wf.max(hf)).min((DET_MAX_PIXELS as f64 / (wf * hf)).sqrt());
    let ratio = ratio.min(cap);
    let floor32 = |v: f64| (((v / 32.0).floor() as i64) * 32).clamp(32, DET_MAX_SIDE as i64) as u32;
    (floor32(w as f64 * ratio), floor32(h as f64 * ratio))
}

type P2 = [f64; 2];

fn db_postprocess(
    pred: &[f32],
    h: usize,
    w: usize,
    p: &DetParams,
    dest_w: usize,
    dest_h: usize,
) -> (Vec<[[f32; 2]; 4]>, Vec<f32>) {
    // 2 値化（+ 2x2 の膨張。cv2.dilate のアンカーは (1,1) なので src(x-1..x, y-1..y) の最大）
    let seg = |x: usize, y: usize| pred[y * w + x] > p.thresh;
    let mut mask = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let on = if p.use_dilation {
                seg(x, y) || (x > 0 && seg(x - 1, y)) || (y > 0 && seg(x, y - 1)) || (x > 0 && y > 0 && seg(x - 1, y - 1))
            } else {
                seg(x, y)
            };
            mask[y * w + x] = on;
        }
    }
    let contours = component_boundaries(&mask, w, h, p.max_candidates);
    drop(mask);

    let mut boxes = Vec::new();
    let mut scores = Vec::new();
    for pts in &contours {
        let (points, sside) = get_mini_boxes(pts);
        if sside < 3.0 {
            continue;
        }
        let score = box_score_fast(pred, h, w, &points);
        if (p.box_thresh as f64) > score {
            continue;
        }
        let expanded = unclip(&points, p.unclip_ratio);
        let (bx, sside) = get_mini_boxes(&expanded);
        if sside < 3.0 + 2.0 {
            continue;
        }
        let mut b = [[0f32; 2]; 4];
        for i in 0..4 {
            let x = (bx[i][0] / w as f64 * dest_w as f64).round_ties_even().clamp(0.0, dest_w as f64);
            let y = (bx[i][1] / h as f64 * dest_h as f64).round_ties_even().clamp(0.0, dest_h as f64);
            b[i] = [x as f32, y as f32];
        }
        boxes.push(b);
        scores.push(score as f32);
    }

    // filter_det_res
    let mut ob = Vec::new();
    let mut os = Vec::new();
    for (b, s) in boxes.into_iter().zip(scores) {
        let mut b = order_points_clockwise(&b);
        for q in b.iter_mut() {
            q[0] = q[0].max(0.0).min(dest_w as f32 - 1.0).trunc();
            q[1] = q[1].max(0.0).min(dest_h as f32 - 1.0).trunc();
        }
        let rect_w = dist(b[0], b[1]) as i32;
        let rect_h = dist(b[0], b[3]) as i32;
        if rect_w <= 3 || rect_h <= 3 {
            continue;
        }
        ob.push(b);
        os.push(s);
    }
    (ob, os)
}

/// 2 値マスクの連結成分（8 近傍）ごとに、外周の画素（4 近傍に背景または画像の外がある画素）を返す。
/// 成分は走査順（上→下・左→右）で最初に見つかった順。最小外接矩形は凸包だけで決まり、
/// 凸包は外周の画素で決まるので、輪郭追跡（find_contours）の外側の輪郭を使った結果と同じになる。
/// 穴の輪郭は返さない（穴は外側の輪郭の凸包の内側にあり、検出の確率も低いので候補にならない）
fn component_boundaries(mask: &[bool], w: usize, h: usize, max_components: usize) -> Vec<Vec<P2>> {
    let mut visited = vec![false; mask.len()];
    let mut out: Vec<Vec<P2>> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for start in 0..mask.len() {
        if !mask[start] || visited[start] {
            continue;
        }
        if out.len() >= max_components {
            break;
        }
        let mut pts: Vec<P2> = Vec::new();
        visited[start] = true;
        stack.push(start);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            let fg = |dx: isize, dy: isize| -> bool {
                let (nx, ny) = (x as isize + dx, y as isize + dy);
                nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h && mask[ny as usize * w + nx as usize]
            };
            if !(fg(-1, 0) && fg(1, 0) && fg(0, -1) && fg(0, 1)) {
                pts.push([x as f64, y as f64]);
            }
            for dy in -1isize..=1 {
                for dx in -1isize..=1 {
                    if (dx != 0 || dy != 0) && fg(dx, dy) {
                        let j = (y as isize + dy) as usize * w + (x as isize + dx) as usize;
                        if !visited[j] {
                            visited[j] = true;
                            stack.push(j);
                        }
                    }
                }
            }
        }
        out.push(pts);
    }
    out
}

fn dist(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// 凸包（Andrew's monotone chain）
fn convex_hull(pts: &[P2]) -> Vec<P2> {
    let mut p: Vec<P2> = pts.to_vec();
    p.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap().then(a[1].partial_cmp(&b[1]).unwrap()));
    p.dedup();
    if p.len() <= 2 {
        return p;
    }
    let cross = |o: P2, a: P2, b: P2| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut lower: Vec<P2> = Vec::new();
    for &q in &p {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], q) <= 0.0 {
            lower.pop();
        }
        lower.push(q);
    }
    let mut upper: Vec<P2> = Vec::new();
    for &q in p.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], q) <= 0.0 {
            upper.pop();
        }
        upper.push(q);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// 最小外接矩形（回転した矩形）の 4 隅と、短辺・長辺の長さ（cv2.minAreaRect + boxPoints 相当）
fn min_area_rect(pts: &[P2]) -> ([P2; 4], f64, f64) {
    let hull = convex_hull(pts);
    if hull.is_empty() {
        return ([[0.0; 2]; 4], 0.0, 0.0);
    }
    if hull.len() == 1 {
        return ([hull[0]; 4], 0.0, 0.0);
    }
    if hull.len() == 2 {
        let l = ((hull[0][0] - hull[1][0]).powi(2) + (hull[0][1] - hull[1][1]).powi(2)).sqrt();
        return ([hull[0], hull[1], hull[1], hull[0]], l, 0.0);
    }
    let mut best: Option<(f64, [P2; 4], f64, f64)> = None;
    for i in 0..hull.len() {
        let a = hull[i];
        let b = hull[(i + 1) % hull.len()];
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let l = (dx * dx + dy * dy).sqrt();
        if l == 0.0 {
            continue;
        }
        let u = [dx / l, dy / l];
        let v = [-u[1], u[0]];
        let (mut u0, mut u1, mut v0, mut v1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for q in &hull {
            let pu = q[0] * u[0] + q[1] * u[1];
            let pv = q[0] * v[0] + q[1] * v[1];
            u0 = u0.min(pu);
            u1 = u1.max(pu);
            v0 = v0.min(pv);
            v1 = v1.max(pv);
        }
        let (w, h) = (u1 - u0, v1 - v0);
        let area = w * h;
        if best.as_ref().map(|b| area < b.0).unwrap_or(true) {
            let c = |pu: f64, pv: f64| [pu * u[0] + pv * v[0], pu * u[1] + pv * v[1]];
            best = Some((area, [c(u0, v0), c(u1, v0), c(u1, v1), c(u0, v1)], w, h));
        }
    }
    let (_, corners, w, h) = best.unwrap();
    (corners, w, h)
}

/// rapidocr の get_mini_boxes: 最小外接矩形の 4 点を「x でソート → 左 2 点を y で、右 2 点を y で」
/// 並べ替え、[左上, 右上, 右下, 左下] にする。戻り値の 2 つ目は矩形の短辺
fn get_mini_boxes(contour: &[P2]) -> ([P2; 4], f64) {
    let (corners, w, h) = min_area_rect(contour);
    let mut points = corners.to_vec();
    points.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());
    let (i1, i4) = if points[1][1] > points[0][1] { (0, 1) } else { (1, 0) };
    let (i2, i3) = if points[3][1] > points[2][1] { (2, 3) } else { (3, 2) };
    ([points[i1], points[i2], points[i3], points[i4]], w.min(h))
}

/// 矩形を外側へ広げる。DB の unclip（pyclipper の丸め結合でのオフセット）と同じ結果になる:
/// 距離 = 面積 × unclip_ratio / 周長 を 4 辺それぞれに足す
/// （矩形 ⊕ 円の最小外接矩形は、各辺を距離だけ外へ動かした矩形になる）。
/// 入力は get_mini_boxes が返す矩形の 4 点。戻り値はその 4 隅（順序は get_mini_boxes で整える）
fn unclip(b: &[P2; 4], ratio: f64) -> Vec<P2> {
    let (e1, e2) = (
        ((b[1][0] - b[0][0]).powi(2) + (b[1][1] - b[0][1]).powi(2)).sqrt(),
        ((b[3][0] - b[0][0]).powi(2) + (b[3][1] - b[0][1]).powi(2)).sqrt(),
    );
    if e1 == 0.0 || e2 == 0.0 {
        return b.to_vec();
    }
    // Polygon(box) の面積・周長（シューレース）
    let mut a2 = 0.0;
    let mut len = 0.0;
    for i in 0..4 {
        let (p, q) = (b[i], b[(i + 1) % 4]);
        a2 += p[0] * q[1] - q[0] * p[1];
        len += ((q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2)).sqrt();
    }
    let d = (a2.abs() / 2.0) * ratio / len;
    let u = [(b[1][0] - b[0][0]) / e1, (b[1][1] - b[0][1]) / e1];
    let v = [(b[3][0] - b[0][0]) / e2, (b[3][1] - b[0][1]) / e2];
    let c = [(b[0][0] + b[2][0]) / 2.0, (b[0][1] + b[2][1]) / 2.0];
    let (hw, hh) = (e1 / 2.0 + d, e2 / 2.0 + d);
    let k = |su: f64, sv: f64| [c[0] + su * hw * u[0] + sv * hh * v[0], c[1] + su * hw * u[1] + sv * hh * v[1]];
    vec![k(-1.0, -1.0), k(1.0, -1.0), k(1.0, 1.0), k(-1.0, 1.0)]
}

/// 箱の内側の検出確率の平均（box_score_fast）。多角形の内側と辺上を塗る
fn box_score_fast(pred: &[f32], h: usize, w: usize, b: &[P2; 4]) -> f64 {
    let xs = b.iter().map(|p| p[0]);
    let ys = b.iter().map(|p| p[1]);
    let xmin = (xs.clone().fold(f64::MAX, f64::min).floor() as i64).clamp(0, w as i64 - 1);
    let xmax = (xs.fold(f64::MIN, f64::max).ceil() as i64).clamp(0, w as i64 - 1);
    let ymin = (ys.clone().fold(f64::MAX, f64::min).floor() as i64).clamp(0, h as i64 - 1);
    let ymax = (ys.fold(f64::MIN, f64::max).ceil() as i64).clamp(0, h as i64 - 1);
    // cv2.fillPoly には int32 に切り捨てた頂点を渡している
    let poly: Vec<(i64, i64)> = b.iter().map(|p| ((p[0] - xmin as f64) as i64, (p[1] - ymin as f64) as i64)).collect();
    let mut sum = 0f64;
    let mut cnt = 0usize;
    for y in ymin..=ymax {
        for x in xmin..=xmax {
            if in_poly_inclusive(&poly, x - xmin, y - ymin) {
                sum += pred[y as usize * w + x as usize] as f64;
                cnt += 1;
            }
        }
    }
    if cnt == 0 { 0.0 } else { sum / cnt as f64 }
}

/// 点が多角形の内側または辺上にあるか（整数座標）
fn in_poly_inclusive(poly: &[(i64, i64)], px: i64, py: i64) -> bool {
    let n = poly.len();
    let mut inside = false;
    for i in 0..n {
        let (x1, y1) = poly[i];
        let (x2, y2) = poly[(i + 1) % n];
        // 辺上
        let cr = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
        if cr == 0 && px >= x1.min(x2) && px <= x1.max(x2) && py >= y1.min(y2) && py <= y1.max(y2) {
            return true;
        }
        if (y1 > py) != (y2 > py) {
            // 交点の x より左か
            let lhs = (px - x1) * (y2 - y1);
            let rhs = (x2 - x1) * (py - y1);
            if (y2 > y1 && lhs < rhs) || (y2 < y1 && lhs > rhs) {
                inside = !inside;
            }
        }
    }
    inside
}

/// 4 点を [左上, 右上, 右下, 左下] に並べる（rapidocr の order_points_clockwise）
pub fn order_points_clockwise(pts: &[[f32; 2]; 4]) -> [[f32; 2]; 4] {
    let mut p = pts.to_vec();
    p.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());
    let mut left = [p[0], p[1]];
    left.sort_by(|a, b| a[1].partial_cmp(&b[1]).unwrap());
    let mut right = [p[2], p[3]];
    right.sort_by(|a, b| a[1].partial_cmp(&b[1]).unwrap());
    [left[0], right[0], right[1], left[1]]
}

/// 箱の並べ替え（rapidocr の sorted_boxes）。左上の y で安定ソート → 隣との y の差が 10 以上で
/// 行を分ける → 行の中は左上の x で並べる。並べた後の元の添字を返す
pub fn sort_boxes(boxes: &[[[f32; 2]; 4]]) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..boxes.len()).collect();
    idx.sort_by(|&a, &b| boxes[a][0][1].partial_cmp(&boxes[b][0][1]).unwrap());
    let mut line_ids = vec![0usize; idx.len()];
    for k in 1..idx.len() {
        let dy = boxes[idx[k]][0][1] - boxes[idx[k - 1]][0][1];
        line_ids[k] = line_ids[k - 1] + usize::from(dy >= 10.0);
    }
    let mut pos: Vec<usize> = (0..idx.len()).collect();
    pos.sort_by(|&a, &b| {
        line_ids[a].cmp(&line_ids[b]).then(boxes[idx[a]][0][0].partial_cmp(&boxes[idx[b]][0][0]).unwrap())
    });
    pos.into_iter().map(|k| idx[k]).collect()
}

// ---------------------------------------------------------------------------
// 画像処理（切り出し・リサイズ）
// ---------------------------------------------------------------------------

/// cv2.resize の既定（INTER_LINEAR・ピクセル中心合わせ・縮小でも平滑化しない）と同じ双線形補間
pub fn resize_bilinear(src: &RgbImage, nw: u32, nh: u32) -> RgbImage {
    let (w, h) = src.dimensions();
    let raw = src.as_raw();
    let (sx, sy) = (w as f32 / nw as f32, h as f32 / nh as f32);
    let xs: Vec<(usize, usize, f32)> = (0..nw)
        .map(|x| {
            let f = ((x as f32 + 0.5) * sx - 0.5).max(0.0);
            let x0 = (f.floor() as usize).min(w as usize - 1);
            let x1 = (x0 + 1).min(w as usize - 1);
            (x0, x1, f - x0 as f32)
        })
        .collect();
    let mut out = RgbImage::new(nw, nh);
    let ob = out.as_mut();
    for y in 0..nh as usize {
        let f = ((y as f32 + 0.5) * sy - 0.5).max(0.0);
        let y0 = (f.floor() as usize).min(h as usize - 1);
        let y1 = (y0 + 1).min(h as usize - 1);
        let ty = f - y0 as f32;
        for (x, &(x0, x1, tx)) in xs.iter().enumerate() {
            for c in 0..3 {
                let at = |yy: usize, xx: usize| raw[(yy * w as usize + xx) * 3 + c] as f32;
                let top = at(y0, x0) * (1.0 - tx) + at(y0, x1) * tx;
                let bot = at(y1, x0) * (1.0 - tx) + at(y1, x1) * tx;
                ob[(y * nw as usize + x) * 3 + c] = (top * (1.0 - ty) + bot * ty).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// 4 点対応から射影行列（dst → src）を解く。cv2.getPerspectiveTransform 相当
fn homography(dst: &[P2; 4], src: &[P2; 4]) -> Option<[f64; 9]> {
    let mut a = [[0f64; 9]; 8];
    for i in 0..4 {
        let (x, y) = (dst[i][0], dst[i][1]);
        let (u, v) = (src[i][0], src[i][1]);
        a[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -x * u, -y * u, u];
        a[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -x * v, -y * v, v];
    }
    for col in 0..8 {
        let mut piv = col;
        for r in col + 1..8 {
            if a[r][col].abs() > a[piv][col].abs() {
                piv = r;
            }
        }
        if a[piv][col].abs() < 1e-12 {
            return None;
        }
        a.swap(col, piv);
        for r in 0..8 {
            if r != col {
                let pivot_row = a[col];
                let f = a[r][col] / pivot_row[col];
                for (dst, src) in a[r][col..].iter_mut().zip(&pivot_row[col..]) {
                    *dst -= f * src;
                }
            }
        }
    }
    let mut h = [0f64; 9];
    for i in 0..8 {
        h[i] = a[i][8] / a[i][i];
    }
    h[8] = 1.0;
    Some(h)
}

fn cubic_w(t: f64) -> [f64; 4] {
    // cv2 の INTER_CUBIC（A = -0.75）
    const A: f64 = -0.75;
    let f = |x: f64| -> f64 {
        let x = x.abs();
        if x <= 1.0 {
            ((A + 2.0) * x - (A + 3.0)) * x * x + 1.0
        } else if x < 2.0 {
            ((A * x - 5.0 * A) * x + 8.0 * A) * x - 4.0 * A
        } else {
            0.0
        }
    };
    [f(1.0 + t), f(t), f(1.0 - t), f(2.0 - t)]
}

/// 切り出しの出力寸法（回転前の幅・高さ）。総画素が CROP_MAX_PIXELS を超えるときは比率を保って小さくする
fn crop_dims(quad: &[[f32; 2]; 4]) -> (u32, u32) {
    let q: [P2; 4] = std::array::from_fn(|i| [quad[i][0] as f64, quad[i][1] as f64]);
    let d = |a: P2, b: P2| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
    let (cw, ch) = (d(q[0], q[1]).max(d(q[2], q[3])), d(q[0], q[3]).max(d(q[1], q[2])));
    let area = cw * ch;
    let k = if area > CROP_MAX_PIXELS as f64 { (CROP_MAX_PIXELS as f64 / area).sqrt() } else { 1.0 };
    (((cw * k) as u32).max(1), ((ch * k) as u32).max(1))
}

/// 切り出し後（縦長なら回したあと）の寸法
fn crop_output_dims(quad: &[[f32; 2]; 4]) -> (u32, u32) {
    let (cw, ch) = crop_dims(quad);
    if ch as f64 / cw as f64 >= 1.5 { (ch, cw) } else { (cw, ch) }
}

/// 4 点（左上・右上・右下・左下）の四角形を透視変換で矩形に切り出す（rapidocr の
/// get_rotate_crop_image）。縦長（高さ/幅 >= 1.5）なら反時計回りに 90° 回して横長にする
pub fn rotate_crop(img: &RgbImage, quad: &[[f32; 2]; 4]) -> RgbImage {
    let q: [P2; 4] = std::array::from_fn(|i| [quad[i][0] as f64, quad[i][1] as f64]);
    let (cw, ch) = crop_dims(quad);
    let std_pts: [P2; 4] = [[0.0, 0.0], [cw as f64, 0.0], [cw as f64, ch as f64], [0.0, ch as f64]];
    let (w, h) = img.dimensions();
    let raw = img.as_raw();
    let mut out = RgbImage::new(cw, ch);
    if let Some(m) = homography(&std_pts, &q) {
        let ob = out.as_mut();
        let clampi = |v: i64, hi: usize| v.clamp(0, hi as i64 - 1) as usize;
        for y in 0..ch as usize {
            for x in 0..cw as usize {
                let (xf, yf) = (x as f64, y as f64);
                let den = m[6] * xf + m[7] * yf + m[8];
                let sx = (m[0] * xf + m[1] * yf + m[2]) / den;
                let sy = (m[3] * xf + m[4] * yf + m[5]) / den;
                let (x0, y0) = (sx.floor(), sy.floor());
                let (wx, wy) = (cubic_w(sx - x0), cubic_w(sy - y0));
                for c in 0..3 {
                    let mut acc = 0f64;
                    for (j, wyj) in wy.iter().enumerate() {
                        let yy = clampi(y0 as i64 - 1 + j as i64, h as usize);
                        for (i, wxi) in wx.iter().enumerate() {
                            let xx = clampi(x0 as i64 - 1 + i as i64, w as usize);
                            acc += raw[(yy * w as usize + xx) * 3 + c] as f64 * wxi * wyj;
                        }
                    }
                    ob[(y * cw as usize + x) * 3 + c] = acc.round().clamp(0.0, 255.0) as u8;
                }
            }
        }
    }
    if ch as f64 / cw as f64 >= 1.5 {
        rot90_ccw(&out)
    } else {
        out
    }
}

/// np.rot90 と同じ（反時計回りに 90°）
pub fn rot90_ccw(src: &RgbImage) -> RgbImage {
    let (w, h) = src.dimensions();
    let mut out = RgbImage::new(h, w);
    for y in 0..h {
        for x in 0..w {
            out.put_pixel(y, w - 1 - x, *src.get_pixel(x, y));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 読み順（layout_text）
// ---------------------------------------------------------------------------

struct Item<'a> {
    text: &'a str,
    /// 傾きを戻したあとの中心
    cx: f32,
    cy: f32,
    /// 箱の幅（上辺の長さ）・高さ（左辺の長さ）
    w: f32,
    h: f32,
}

fn is_tall(w: f32, h: f32) -> bool {
    h > w * 1.5
}

/// 箱の傾き（ラジアン）。横長なら上辺、縦長なら左辺の向きから求める
fn quad_tilt(q: &[[f32; 2]; 4]) -> f32 {
    let (w, h) = (dist(q[0], q[1]), dist(q[0], q[3]));
    let mut a = if w >= h {
        (q[1][1] - q[0][1]).atan2(q[1][0] - q[0][0])
    } else {
        (q[3][1] - q[0][1]).atan2(q[3][0] - q[0][0]) - std::f32::consts::FRAC_PI_2
    };
    // (-π/2, π/2] に畳む
    while a > std::f32::consts::FRAC_PI_2 {
        a -= std::f32::consts::PI;
    }
    while a <= -std::f32::consts::FRAC_PI_2 {
        a += std::f32::consts::PI;
    }
    a
}

/// 行を読み順に並べて改行でつなぐ。
/// - 箱の傾きの中央値で中心座標を回してから行・列に束ねる（傾いた画像でも行を取り違えない）
/// - 縦長の箱が過半（かつ 2 つ以上）なら縦書き: 列を右→左、列の中は上→下
/// - 横書き: 行を上→下、行の中は左→右
pub fn layout_text(lines: &[OcrLine]) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let mut tilts: Vec<f32> = lines.iter().map(|l| quad_tilt(&l.quad)).collect();
    tilts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = if tilts.len() % 2 == 1 {
        tilts[tilts.len() / 2]
    } else {
        (tilts[tilts.len() / 2 - 1] + tilts[tilts.len() / 2]) / 2.0
    };
    let (sin, cos) = med.sin_cos();
    let mut items: Vec<Item> = lines
        .iter()
        .map(|l| {
            let q = &l.quad;
            let cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4.0;
            let cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4.0;
            Item {
                text: &l.text,
                cx: cx * cos + cy * sin,
                cy: -cx * sin + cy * cos,
                w: dist(q[0], q[1]),
                h: dist(q[0], q[3]),
            }
        })
        .collect();

    let tall = items.iter().filter(|i| is_tall(i.w, i.h)).count();
    let vertical = tall >= 2 && tall * 2 > items.len();

    // 同じ並びに束ねる共通処理: key 昇順（または降順）に並べ、並びの軸の位置が近いものを同じ並びにする
    let mut out: Vec<String> = Vec::new();
    if !vertical {
        items.sort_by(|a, b| a.cy.partial_cmp(&b.cy).unwrap());
        let mut rows: Vec<Vec<&Item>> = Vec::new();
        for it in &items {
            let fit = rows.last().map(|r| {
                let mean = r.iter().map(|i| i.cy).sum::<f32>() / r.len() as f32;
                (it.cy - mean).abs() <= it.h.min(r[0].h) * 0.5
            });
            if fit == Some(true) {
                rows.last_mut().unwrap().push(it);
            } else {
                rows.push(vec![it]);
            }
        }
        for mut r in rows {
            r.sort_by(|a, b| a.cx.partial_cmp(&b.cx).unwrap());
            let mut s = String::new();
            for it in r {
                // ASCII の英数字どうしが隣り合うときだけ半角空白を挟む
                if let (Some(l), Some(f)) = (s.chars().last(), it.text.chars().next()) {
                    if l.is_ascii_alphanumeric() && f.is_ascii_alphanumeric() {
                        s.push(' ');
                    }
                }
                s.push_str(it.text);
            }
            out.push(s);
        }
    } else {
        items.sort_by(|a, b| b.cx.partial_cmp(&a.cx).unwrap());
        let mut cols: Vec<Vec<&Item>> = Vec::new();
        for it in &items {
            let fit = cols.last().map(|c| {
                let mean = c.iter().map(|i| i.cx).sum::<f32>() / c.len() as f32;
                (it.cx - mean).abs() <= it.w.min(c[0].w) * 0.5
            });
            if fit == Some(true) {
                cols.last_mut().unwrap().push(it);
            } else {
                cols.push(vec![it]);
            }
        }
        for mut c in cols {
            c.sort_by(|a, b| a.cy.partial_cmp(&b.cy).unwrap());
            out.push(c.iter().map(|i| i.text).collect::<String>());
        }
    }
    out.join("\n")
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f32, y: f32, w: f32, h: f32) -> [[f32; 2]; 4] {
        [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    }

    fn line(t: &str, q: [[f32; 2]; 4]) -> OcrLine {
        OcrLine { text: t.to_string(), score: 0.9, quad: q }
    }

    #[test]
    fn unclip_は各辺を距離だけ広げる() {
        // 100 x 20、ratio 1.4: d = 2000 * 1.4 / 240
        let b = [[10.0, 10.0], [110.0, 10.0], [110.0, 30.0], [10.0, 30.0]];
        let e = unclip(&b, 1.4);
        let d = 2000.0 * 1.4 / 240.0;
        let (bx, side) = get_mini_boxes(&e);
        assert!((bx[0][0] - (10.0 - d)).abs() < 1e-6 && (bx[0][1] - (10.0 - d)).abs() < 1e-6);
        assert!((bx[2][0] - (110.0 + d)).abs() < 1e-6 && (bx[2][1] - (30.0 + d)).abs() < 1e-6);
        assert!((side - (20.0 + 2.0 * d)).abs() < 1e-6);
    }

    #[test]
    fn 最小外接矩形は傾いた矩形を復元する() {
        // 30° 傾けた 60 x 10 の矩形の 4 隅
        let (s, c) = (30f64.to_radians().sin(), 30f64.to_radians().cos());
        let pts: Vec<P2> = [[0.0, 0.0], [60.0, 0.0], [60.0, 10.0], [0.0, 10.0]]
            .iter()
            .map(|p| [p[0] * c - p[1] * s + 100.0, p[0] * s + p[1] * c + 50.0])
            .collect();
        let (_, w, h) = min_area_rect(&pts);
        assert!((w.max(h) - 60.0).abs() < 1e-6 && (w.min(h) - 10.0).abs() < 1e-6);
    }

    #[test]
    fn 箱は左上から行ごとに並ぶ() {
        // y の差が 10 未満なら同じ行（x 順）、10 以上なら次の行
        let boxes = vec![
            rect(200.0, 52.0, 50.0, 20.0), // 行 2・右
            rect(10.0, 50.0, 50.0, 20.0),  // 行 2・左
            rect(120.0, 8.0, 50.0, 20.0),  // 行 1・右
            rect(10.0, 10.0, 50.0, 20.0),  // 行 1・左
        ];
        assert_eq!(sort_boxes(&boxes), vec![3, 2, 1, 0]);
    }

    #[test]
    fn 四点は時計回りに並ぶ() {
        let shuffled = [[100.0, 40.0], [10.0, 10.0], [10.0, 40.0], [100.0, 10.0]];
        assert_eq!(order_points_clockwise(&shuffled), [[10.0, 10.0], [100.0, 10.0], [100.0, 40.0], [10.0, 40.0]]);
    }

    #[test]
    fn ctc_は重複と_blank_を落とす() {
        let charset: Vec<String> = ["blank", "あ", "い", " "].iter().map(|s| s.to_string()).collect();
        // 系列: あ あ blank あ い い → 「ああい」（blank を挟んだ同じ文字は 2 つ残る）
        let seq = [1usize, 1, 0, 1, 2, 2];
        let mut probs = vec![];
        for &k in &seq {
            let mut r = vec![0.05f32; 4];
            r[k] = 0.9;
            probs.extend(r);
        }
        let (t, s) = ctc_decode(&probs, seq.len(), 4, &charset);
        assert_eq!(t, "ああい");
        assert!((s - 0.9).abs() < 1e-5);
        // 全部 blank → 空文字・0 点
        let blank: Vec<f32> = vec![0.9, 0.03, 0.03, 0.04, 0.9, 0.03, 0.03, 0.04];
        assert_eq!(ctc_decode(&blank, 2, 4, &charset), (String::new(), 0.0));
    }

    #[test]
    fn 辞書は空白文字を落とさない() {
        let d = parse_dict("a\n\u{3000}\n \nb\n");
        assert_eq!(d, vec!["a", "\u{3000}", " ", "b"]);
    }

    #[test]
    fn 検出入力は_32_の倍数になり短辺が足りなければ拡大する() {
        assert_eq!(det_resize_dims(1000, 500, 736), (1472, 736));
        assert_eq!(det_resize_dims(1000, 800, 736), (992, 800));
    }

    /// recognize と同じ順（縮小 → 上下パディング → 検出入力）で検出入力の寸法を求める
    fn det_input_dims(ow: u32, oh: u32) -> (u32, u32) {
        let (bw, bh) = shrunk_dims(ow, oh, DEFAULT_MAX_SIDE);
        let pad = vertical_padding(bw, bh);
        det_resize_dims(bw, bh + pad * 2, DetParams::official().limit_side_len)
    }

    #[test]
    fn 検出入力は細長い画像でも上限内に収まる() {
        let cases = [(1, 20_000), (10, 1600), (1, 1), (20_000, 1), (1600, 10), (4032, 3024), (300, 200), (8, 20_000), (20_000, 20_000), (736, 100_000)];
        for (w, h) in cases {
            let (rw, rh) = det_input_dims(w, h);
            assert!(rw <= DET_MAX_SIDE && rh <= DET_MAX_SIDE, "{w}x{h} -> {rw}x{rh} が長辺の上限超え");
            assert!(rw as u64 * rh as u64 <= DET_MAX_PIXELS, "{w}x{h} -> {rw}x{rh} が総画素の上限超え");
            assert!(rw % 32 == 0 && rh % 32 == 0 && rw >= 32 && rh >= 32);
        }
        // 通常の画像は従来どおり（上限に掛からない）
        assert_eq!(det_resize_dims(1000, 500, 736), (1472, 736));
        assert_eq!(det_resize_dims(1600, 1200, 736), (1600, 1216));
    }

    #[test]
    fn 切り出しは上限の画素数に収まる() {
        // 20000 x 1000 の箱（2000 万画素）
        let q = rect(0.0, 0.0, 20_000.0, 1000.0);
        let (w, h) = crop_dims(&q);
        assert!(w as u64 * h as u64 <= CROP_MAX_PIXELS);
        assert!((w as f64 / h as f64 - 20.0).abs() < 0.1, "比率を保つ");
        // 通常の箱はそのまま
        assert_eq!(crop_dims(&rect(0.0, 0.0, 300.0, 40.0)), (300, 40));
        // 縦長は回したあとの寸法
        assert_eq!(crop_output_dims(&rect(0.0, 0.0, 40.0, 300.0)), (300, 40));
    }

    #[test]
    fn 透明な背景は白に合成してから_rgb_にする() {
        let mut img = image::RgbaImage::new(3, 1);
        img.put_pixel(0, 0, image::Rgba([0, 0, 0, 0])); // 透明（RGB は黒）
        img.put_pixel(1, 0, image::Rgba([0, 0, 0, 255])); // 不透明の黒
        img.put_pixel(2, 0, image::Rgba([0, 0, 0, 128])); // 半透明の黒
        let dynimg = DynamicImage::ImageRgba8(img);
        let rgb = to_rgb_on_white(&dynimg);
        assert_eq!(rgb.get_pixel(0, 0).0, [255, 255, 255]);
        assert_eq!(rgb.get_pixel(1, 0).0, [0, 0, 0]);
        assert_eq!(rgb.get_pixel(2, 0).0, [127, 127, 127]);
        // グレー＋アルファも同じ
        let mut la = image::GrayAlphaImage::new(1, 1);
        la.put_pixel(0, 0, image::LumaA([0, 0]));
        assert_eq!(to_rgb_on_white(&DynamicImage::ImageLumaA8(la)).get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    fn 期限を過ぎていれば打ち切る() {
        assert!(check_deadline(None).is_ok());
        assert!(check_deadline(Some(Instant::now() + std::time::Duration::from_secs(60))).is_ok());
        let e = check_deadline(Some(Instant::now() - std::time::Duration::from_secs(1))).unwrap_err();
        assert_eq!(e.to_string(), OCR_TIMEOUT);
    }

    #[test]
    fn poison_されたロックも取り出して続ける() {
        let m = std::sync::Arc::new(Mutex::new(5));
        let m2 = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("poison にする");
        })
        .join();
        assert!(m.lock().is_err());
        assert_eq!(*lock_recover(&m), 5);
        // poison は外れている
        assert!(m.lock().is_ok());
    }

    #[test]
    fn 横書きは上から下_左から右() {
        let ls = vec![
            line("右", rect(100.0, 10.0, 40.0, 20.0)),
            line("2行目", rect(10.0, 60.0, 60.0, 20.0)),
            line("左", rect(10.0, 12.0, 40.0, 20.0)),
        ];
        assert_eq!(layout_text(&ls), "左右\n2行目");
    }

    #[test]
    fn 傾いた画像でも行を取り違えない() {
        // 全体が 10° 傾いた 2 行 x 3 語。回さずに y だけで並べると右の語が上の行に混ざる
        let (s, c) = 10f32.to_radians().sin_cos();
        let rot = |p: [f32; 2]| [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
        let mk = |t: &str, x: f32, y: f32| {
            let r = rect(x, y, 80.0, 20.0);
            line(t, [rot(r[0]), rot(r[1]), rot(r[2]), rot(r[3])])
        };
        let ls = vec![
            mk("d", 0.0, 40.0),
            mk("c", 600.0, 0.0),
            mk("a", 0.0, 0.0),
            mk("f", 600.0, 40.0),
            mk("b", 300.0, 0.0),
            mk("e", 300.0, 40.0),
        ];
        // 600 離れた語の y 差は 600*sin10° ≈ 104 で行間 40 を超える
        assert_eq!(layout_text(&ls), "a b c\nd e f");
    }

    #[test]
    fn 縦書きは列を右から左_列の中は上から下() {
        // 縦長の箱が 3 列: 右列「ABC」(2 箱)、中列「DE」、左列「F」
        let ls = vec![
            line("B", rect(200.0, 100.0, 20.0, 80.0)),
            line("F", rect(20.0, 10.0, 20.0, 80.0)),
            line("A", rect(200.0, 10.0, 20.0, 80.0)),
            line("E", rect(110.0, 100.0, 20.0, 80.0)),
            line("D", rect(110.0, 10.0, 20.0, 80.0)),
        ];
        assert_eq!(layout_text(&ls), "AB\nDE\nF");
    }

    #[test]
    fn 連結成分は_8_近傍で束ね外周の画素だけを返す() {
        // 6x5 のマスク。左の 3x3 の塊と、斜めにだけ接する右下の 1 画素は同じ成分（8 近傍）、
        // 離れた右上の 1 画素は別の成分
        let (w, h) = (6usize, 5usize);
        let mut m = vec![false; w * h];
        for y in 0..3 {
            for x in 0..3 {
                m[y * w + x] = true;
            }
        }
        m[3 * w + 3] = true; // (3,3) は (2,2) と斜めで接する
        m[5] = true; // (5,0)
        let comps = component_boundaries(&m, w, h, 10);
        assert_eq!(comps.len(), 2);
        // 3x3 の中心 (1,1) は内側なので外周に入らない。塊 8 画素 + 斜めの 1 画素
        assert_eq!(comps[0].len(), 9);
        assert!(!comps[0].contains(&[1.0, 1.0]));
        assert_eq!(comps[1], vec![[5.0, 0.0]]);
        // 上限で打ち切る
        assert_eq!(component_boundaries(&m, w, h, 1).len(), 1);
    }

    #[test]
    fn 巨大な画像はデコードを断る() {
        // 幅 30000 の 1 ピクセル高の PNG（上限 20000 を超える）
        let img = image::RgbImage::new(30_000, 1);
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).unwrap();
        assert!(decode_image(&buf).is_err());
        let small = image::RgbImage::new(10, 10);
        let mut buf2 = Vec::new();
        small.write_to(&mut std::io::Cursor::new(&mut buf2), image::ImageFormat::Png).unwrap();
        assert!(decode_image(&buf2).is_ok());
        assert!(decode_image(b"not an image").is_err());
    }

    fn edit_distance(a: &[char], b: &[char]) -> usize {
        let mut prev: Vec<usize> = (0..=b.len()).collect();
        for i in 1..=a.len() {
            let mut cur = vec![i; b.len() + 1];
            for j in 1..=b.len() {
                let sub = prev[j - 1] + usize::from(a[i - 1] != b[j - 1]);
                cur[j] = sub.min(prev[j] + 1).min(cur[j - 1] + 1);
            }
            prev = cur;
        }
        prev[b.len()]
    }

    fn load_real_engine() -> OcrEngine {
        let det = std::env::var("GRAPHIUM_OCR_TEST_DET").expect("GRAPHIUM_OCR_TEST_DET");
        let rec = std::env::var("GRAPHIUM_OCR_TEST_REC").expect("GRAPHIUM_OCR_TEST_REC");
        let dict = parse_dict(include_str!("ocr_rec_dict.txt"));
        OcrEngine::load(Path::new(&det), Path::new(&rec), dict).unwrap()
    }

    /// 実モデルで 1 枚読み、正解との文字誤り率が小さいことを見る。
    /// GRAPHIUM_OCR_TEST_DET=<det の onnx> GRAPHIUM_OCR_TEST_REC=<rec の onnx>
    /// GRAPHIUM_OCR_TEST_IMAGE=<画像> GRAPHIUM_OCR_TEST_TRUTH=<正解のテキスト>
    /// cargo test real_model_reads_image -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_model_reads_image() {
        let engine = load_real_engine();
        let image = std::env::var("GRAPHIUM_OCR_TEST_IMAGE").expect("GRAPHIUM_OCR_TEST_IMAGE");
        let truth = std::env::var("GRAPHIUM_OCR_TEST_TRUTH").expect("GRAPHIUM_OCR_TEST_TRUTH");
        let img = decode_image(&std::fs::read(&image).unwrap()).unwrap();
        let lines = engine.recognize(&img, &OcrOptions::default()).unwrap();
        assert!(!lines.is_empty());
        let got = layout_text(&lines);
        let squash = |t: &str| t.chars().filter(|c| !c.is_whitespace()).collect::<Vec<char>>();
        let want = squash(&std::fs::read_to_string(&truth).unwrap());
        let have = squash(&got);
        let cer = edit_distance(&have, &want) as f64 / want.len().max(1) as f64;
        eprintln!("CER = {cer:.3}\n{got}");
        assert!(cer < 0.2, "CER {cer}");
    }

    /// 攻撃の再現: 細長い画像（1x20000・10x1600・20000x1・1x1）を読ませても確保が膨らまない。
    /// `/usr/bin/time -l` でピーク RSS を見る（DET・REC を環境変数で渡す）。
    /// cargo test --release --lib ocr_engine::tests::real_model_survives_extreme_aspect -- --ignored
    #[test]
    #[ignore]
    fn real_model_survives_extreme_aspect() {
        let engine = load_real_engine();
        for (w, h) in [(1u32, 20_000u32), (10, 1600), (20_000, 1), (1600, 10), (1, 1), (9, 20_000), (4000, 9)] {
            let img = image::RgbImage::from_fn(w, h, |x, y| image::Rgb([((x * 7 + y * 13) % 256) as u8; 3]));
            let mut png = Vec::new();
            img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
            let started = Instant::now();
            let decoded = decode_image(&png).unwrap();
            let opt = OcrOptions { deadline: Some(Instant::now() + std::time::Duration::from_secs(90)), ..OcrOptions::default() };
            let lines = engine.recognize(&decoded, &opt).unwrap();
            if w.min(h) < MIN_DETECT_SIDE {
                assert!(lines.is_empty(), "{w}x{h} は検出せず空を返す");
            }
            eprintln!("{w}x{h}: {} 行 / {} ms", lines.len(), started.elapsed().as_millis());
        }
    }

    /// フォルダ内の画像すべてを読み、`<出力dir>/<画像名>.txt` に layout_text を書く
    /// （imageproc を外す前後などで出力を突き合わせるため）。
    /// GRAPHIUM_OCR_TEST_IMAGES_DIR=<画像のフォルダ> GRAPHIUM_OCR_TEST_OUT_DIR=<出力先>（と DET・REC）
    #[test]
    #[ignore]
    fn real_model_dumps_folder() {
        let engine = load_real_engine();
        let dir = std::env::var("GRAPHIUM_OCR_TEST_IMAGES_DIR").expect("GRAPHIUM_OCR_TEST_IMAGES_DIR");
        let out = std::env::var("GRAPHIUM_OCR_TEST_OUT_DIR").expect("GRAPHIUM_OCR_TEST_OUT_DIR");
        std::fs::create_dir_all(&out).unwrap();
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).collect();
        files.sort();
        for f in files {
            if !matches!(f.extension().and_then(|e| e.to_str()), Some("png" | "jpg" | "jpeg")) {
                continue;
            }
            let img = decode_image(&std::fs::read(&f).unwrap()).unwrap();
            let text = layout_text(&engine.recognize(&img, &OcrOptions::default()).unwrap());
            let stem = f.file_stem().unwrap().to_string_lossy().to_string();
            std::fs::write(Path::new(&out).join(format!("{stem}.txt")), text).unwrap();
        }
    }
}
