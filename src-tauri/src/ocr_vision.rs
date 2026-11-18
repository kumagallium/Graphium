//! macOS 標準の Vision（VNRecognizeTextRequest）による「もう 1 つの読み」。
//!
//! - PP-OCR は印刷文字・数値に強く、Vision は手書きの日本語の文に強い。表示する文字は PP-OCR のまま、
//!   Vision の読みは検索用に別に持つ（ocr_models.rs が altText として返す）
//! - 攻撃面を広げない: 外から来た画像のバイト列は Vision（ImageIO）に直接渡さない。
//!   `decode_image`（寸法・メモリの上限つき）でデコード済みの RGB を長辺 3000 px 以下に縮め、
//!   自分で PNG にエンコードし直したバイト列だけを渡す
//! - 失敗（Vision が使えない・nil・Objective-C の例外）は Err を返すだけ。パニックしない
//! - 端末内で完結する（ネットワークには出ない）

use anyhow::{anyhow, Result};
use image::RgbImage;
use objc2::rc::{autoreleasepool, Retained};
use objc2::AnyThread;
use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};

/// Vision に渡す画像の長辺の上限（px）。これより大きければ縮める
pub const VISION_MAX_SIDE: u32 = 3000;

/// 並べ替え前の 1 つの認識結果。座標は Vision の正規化座標（0〜1・原点は左下）
#[derive(Debug, Clone, PartialEq)]
pub struct VisionBox {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 上→下・左→右の順に並べ、同じ行は半角空白で、行どうしは改行でつなぐ。
/// Vision の y は下が 0 なので、中心の y が大きい（上にある）ものが先。
/// 中心の y の差が低い方の高さの半分未満なら同じ行とみなす
pub fn order_boxes(mut boxes: Vec<VisionBox>) -> String {
    // 有限でない座標の箱は捨てる（NaN で並べ替えが壊れる・panic するのを防ぐ）
    boxes.retain(|b| {
        !b.text.trim().is_empty() && [b.x, b.y, b.w, b.h].iter().all(|v| v.is_finite())
    });
    boxes.sort_by(|a, b| (b.y + b.h / 2.0).total_cmp(&(a.y + a.h / 2.0)));
    let mut rows: Vec<Vec<VisionBox>> = Vec::new();
    for b in boxes {
        let cy = b.y + b.h / 2.0;
        let same_row = rows.last().and_then(|r| r.first()).is_some_and(|f| {
            let fcy = f.y + f.h / 2.0;
            (fcy - cy).abs() < f.h.min(b.h) / 2.0
        });
        if same_row {
            rows.last_mut().unwrap().push(b);
        } else {
            rows.push(vec![b]);
        }
    }
    rows.into_iter()
        .map(|mut r| {
            r.sort_by(|a, b| a.x.total_cmp(&b.x));
            r.iter().map(|b| b.text.trim()).collect::<Vec<_>>().join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 長辺が `VISION_MAX_SIDE` を超えるなら縮め、PNG にエンコードし直す
fn reencode_png(img: &RgbImage) -> Result<Vec<u8>> {
    let (w, h) = img.dimensions();
    let long = w.max(h);
    let mut out = Vec::new();
    let write = |im: &RgbImage, out: &mut Vec<u8>| -> Result<()> {
        im.write_to(&mut std::io::Cursor::new(out), image::ImageFormat::Png)?;
        Ok(())
    };
    if long > VISION_MAX_SIDE {
        let ratio = VISION_MAX_SIDE as f64 / long as f64;
        let nw = ((w as f64 * ratio) as u32).max(1);
        let nh = ((h as f64 * ratio) as u32).max(1);
        let small = image::imageops::resize(img, nw, nh, image::imageops::FilterType::Triangle);
        write(&small, &mut out)?;
    } else {
        write(img, &mut out)?;
    }
    Ok(out)
}

/// 画像を Vision で読み、上→下・左→右の順の文字列を返す。
/// Vision が使えない・失敗したら Err（呼び出し側は握りつぶして PP-OCR の結果だけ返す）
pub fn recognize(img: &RgbImage) -> Result<String> {
    let png = reencode_png(img)?;
    // Objective-C の例外はここで受けて Err にする（Rust 側へ unwind させない）
    let caught = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
        autoreleasepool(|_| recognize_png(&png))
    }));
    match caught {
        Ok(r) => r,
        Err(_) => Err(anyhow!("Vision で例外が起きました")),
    }
}

fn recognize_png(png: &[u8]) -> Result<String> {
    let data = NSData::with_bytes(png);
    let options = NSDictionary::new();
    let handler = VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &options);

    let request: Retained<VNRecognizeTextRequest> = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);
    let langs = NSArray::from_retained_slice(&[NSString::from_str("ja-JP"), NSString::from_str("en-US")]);
    request.setRecognitionLanguages(&langs);

    let base: Retained<VNRequest> = Retained::into_super(Retained::into_super(request.clone()));
    let requests = NSArray::from_retained_slice(&[base]);
    handler
        .performRequests_error(&requests)
        .map_err(|e| anyhow!("Vision の認識に失敗: {}", e.localizedDescription()))?;

    let Some(results) = request.results() else {
        return Ok(String::new());
    };
    let mut boxes = Vec::new();
    for i in 0..results.count() {
        let obs = results.objectAtIndex(i);
        let cands = obs.topCandidates(1);
        if cands.count() == 0 {
            continue;
        }
        let text = cands.objectAtIndex(0).string().to_string();
        // SAFETY: 引数なしの読み取りだけ
        let r = unsafe { obs.boundingBox() };
        boxes.push(VisionBox { text, x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height });
    }
    Ok(order_boxes(boxes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(text: &str, x: f64, y: f64, w: f64, h: f64) -> VisionBox {
        VisionBox { text: text.into(), x, y, w, h }
    }

    #[test]
    fn orders_top_to_bottom_then_left_to_right() {
        // Vision は左下原点: y が大きいほど上
        let out = order_boxes(vec![
            b("下", 0.1, 0.1, 0.2, 0.05),
            b("右上", 0.6, 0.80, 0.2, 0.05),
            b("左上", 0.1, 0.81, 0.2, 0.05),
            b("中", 0.1, 0.5, 0.2, 0.05),
        ]);
        assert_eq!(out, "左上 右上\n中\n下");
    }

    #[test]
    fn non_finite_boxes_are_dropped_without_panicking() {
        let out = order_boxes(vec![
            b("NaN", f64::NAN, 0.5, 0.1, 0.1),
            b("無限", 0.1, f64::INFINITY, 0.1, 0.1),
            b("高さNaN", 0.1, 0.5, 0.1, f64::NAN),
            b("下", 0.1, 0.1, 0.2, 0.05),
            b("上", 0.1, 0.9, 0.2, 0.05),
        ]);
        assert_eq!(out, "上\n下");
    }

    #[test]
    fn drops_empty_and_handles_nothing() {
        assert_eq!(order_boxes(vec![]), "");
        assert_eq!(order_boxes(vec![b("  ", 0.0, 0.0, 0.1, 0.1)]), "");
    }

    #[test]
    fn long_side_is_shrunk_before_encoding() {
        let img = RgbImage::from_pixel(6000, 100, image::Rgb([255, 255, 255]));
        let png = reencode_png(&img).unwrap();
        let back = image::load_from_memory(&png).unwrap();
        assert_eq!(back.width(), VISION_MAX_SIDE);
        assert_eq!(back.height(), 50);
        // 小さい画像はそのまま
        let small = RgbImage::from_pixel(10, 10, image::Rgb([0, 0, 0]));
        let back = image::load_from_memory(&reencode_png(&small).unwrap()).unwrap();
        assert_eq!((back.width(), back.height()), (10, 10));
    }

    /// 合成画像 1 枚（印刷の英数字）を読んで正解と比べる。実機（macOS）だけ。
    /// GRAPHIUM_OCR_TEST_IMAGE=<画像> GRAPHIUM_OCR_TEST_TRUTH=<正解のテキスト>
    /// cargo test --release --lib ocr_vision::tests::real_vision_reads_image -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_vision_reads_image() {
        let image = std::env::var("GRAPHIUM_OCR_TEST_IMAGE").expect("GRAPHIUM_OCR_TEST_IMAGE");
        let truth = std::env::var("GRAPHIUM_OCR_TEST_TRUTH").expect("GRAPHIUM_OCR_TEST_TRUTH");
        let img = crate::ocr_engine::to_rgb_on_white(&crate::ocr_engine::decode_image(&std::fs::read(image).unwrap()).unwrap()).into_owned();
        let text = recognize(&img).unwrap();
        let squash = |t: &str| t.chars().filter(|c| !c.is_whitespace()).collect::<String>();
        eprintln!("{text}");
        // Vision は言語補正で 1〜2 字違うことがある（salt→sait など）ので、編集距離が 10 % 以内なら合格
        let (got, want): (Vec<char>, Vec<char>) =
            (squash(&text).chars().collect(), squash(&std::fs::read_to_string(truth).unwrap()).chars().collect());
        let mut prev: Vec<usize> = (0..=want.len()).collect();
        for (i, g) in got.iter().enumerate() {
            let mut cur = vec![i + 1];
            for (j, w) in want.iter().enumerate() {
                cur.push((prev[j] + usize::from(g != w)).min(prev[j + 1] + 1).min(cur[j] + 1));
            }
            prev = cur;
        }
        let dist = prev[want.len()];
        assert!(dist * 10 <= want.len(), "編集距離 {dist} / 正解 {} 字", want.len());
    }

    /// フォルダ内の画像すべてを Vision で読み、`<出力dir>/<画像名>.txt` に書く。
    /// GRAPHIUM_OCR_TEST_IMAGES_DIR=<画像のフォルダ> GRAPHIUM_OCR_TEST_OUT_DIR=<出力先>（モデルのパスは不要）
    #[test]
    #[ignore]
    fn real_vision_dumps_folder() {
        let dir = std::env::var("GRAPHIUM_OCR_TEST_IMAGES_DIR").expect("GRAPHIUM_OCR_TEST_IMAGES_DIR");
        let out = std::env::var("GRAPHIUM_OCR_TEST_OUT_DIR").expect("GRAPHIUM_OCR_TEST_OUT_DIR");
        std::fs::create_dir_all(&out).unwrap();
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).collect();
        files.sort();
        for f in files {
            if !matches!(f.extension().and_then(|e| e.to_str()), Some("png" | "jpg" | "jpeg")) {
                continue;
            }
            let img = crate::ocr_engine::to_rgb_on_white(&crate::ocr_engine::decode_image(&std::fs::read(&f).unwrap()).unwrap()).into_owned();
            let text = recognize(&img).unwrap_or_default();
            let stem = f.file_stem().unwrap().to_string_lossy().to_string();
            std::fs::write(std::path::Path::new(&out).join(format!("{stem}.txt")), text).unwrap();
        }
    }
}
