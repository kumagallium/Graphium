fn main() {
    // 会議の録音（meeting_audio.rs）は相手の声を ScreenCaptureKit で取る。
    // ScreenCaptureKit は macOS 12.3 以降にしか無いが、配布の最低対応は 11.0
    // （Apple Silicon の Mac はすべて 11 以降）。強いリンクのままだと 11.0〜12.2 で
    // dyld がフレームワークを見つけられず、アプリ自体が起動しなくなる。
    // 弱いリンクにして、起動はでき、録音を始めたときだけ失敗する（エラーを出す）形にする。
    // objc2-screen-capture-kit は `#[link(kind = "framework")]` で強くリンクするので、
    // ld64 の `-weak_framework` で上書きする（参照がすべて weak import になる）。
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
    }
    tauri_build::build()
}
