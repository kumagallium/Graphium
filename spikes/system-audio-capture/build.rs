// 検証バイナリに Info.plist を埋め込む（CLI でも TCC の usage description を持たせる）。
fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    println!("cargo:rerun-if-changed=Info.plist");
    #[cfg(target_os = "macos")]
    println!(
        "cargo:rustc-link-arg-bins=-Wl,-sectcreate,__TEXT,__info_plist,{dir}/Info.plist"
    );
}
