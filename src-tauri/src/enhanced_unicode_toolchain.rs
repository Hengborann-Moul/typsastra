use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::toolchain::ToolchainInstallProgress;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const MANIFEST_URL: &str = "https://github.com/Sovichea/typsastra/releases/download/enhanced-unicode-v0.4.0/enhanced-unicode-manifest.json";
const RELEASE_REPOSITORY: &str = "Sovichea/typsastra";
const RELEASE_TAG: &str = "enhanced-unicode-v0.4.0";
const ENGINE_VERSION: &str = "0.4.0";
const DOWNLOAD_ATTEMPTS: usize = 3;
const MAX_DOWNLOAD_BYTES: u64 = 128 * 1024 * 1024;
const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(60);

struct PinnedAsset {
    target: &'static str,
    archive: &'static str,
    executable: &'static str,
    bytes: u64,
    sha256: &'static str,
}

const PINNED_ASSETS: &[PinnedAsset] = &[
    PinnedAsset {
        target: "x86_64-pc-windows-msvc",
        archive: "typsastra-enhanced-unicode-v0.4.0-x86_64-pc-windows-msvc.zip",
        executable: "typst.exe",
        bytes: 23_333_041,
        sha256: "ae7e245a7f813da0c481bd4d9bce369c14c26b9658c26b4483d72b2e813257a3",
    },
    PinnedAsset {
        target: "x86_64-unknown-linux-gnu",
        archive: "typsastra-enhanced-unicode-v0.4.0-x86_64-unknown-linux-gnu.zip",
        executable: "typst",
        bytes: 23_412_159,
        sha256: "7b8abbced1ea873b8c96cfc82ecdd19aba23197fded19c9017d60be892078784",
    },
    PinnedAsset {
        target: "aarch64-unknown-linux-gnu",
        archive: "typsastra-enhanced-unicode-v0.4.0-aarch64-unknown-linux-gnu.zip",
        executable: "typst",
        bytes: 22_520_392,
        sha256: "b8aa9da0cbb20f21db0c614b2e774e4be5e5797762262f9e7290237157366932",
    },
    PinnedAsset {
        target: "x86_64-apple-darwin",
        archive: "typsastra-enhanced-unicode-v0.4.0-x86_64-apple-darwin.zip",
        executable: "typst",
        bytes: 22_949_338,
        sha256: "de6d36a828c03fb675c954cd410920dfbb6e243b42193ff7cb5523dbe7697275",
    },
    PinnedAsset {
        target: "aarch64-apple-darwin",
        archive: "typsastra-enhanced-unicode-v0.4.0-aarch64-apple-darwin.zip",
        executable: "typst",
        bytes: 22_060_106,
        sha256: "a74647186706efa0470a24649e2c79ed7140fb868bd4b1ccf0d1cb5cb919faea",
    },
];

type ProgressCallback<'a> = Option<&'a (dyn Fn(ToolchainInstallProgress) + Send + Sync)>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseManifest {
    schema_version: u32,
    engine: ManifestEngine,
    release: ManifestRelease,
    assets: Vec<ManifestAsset>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEngine {
    version: String,
    typst_version: String,
}

#[derive(Deserialize)]
struct ManifestRelease {
    repository: String,
    tag: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestAsset {
    target: String,
    archive: String,
    executable: String,
    bytes: u64,
    sha256: String,
    download_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackagedRelease {
    version: String,
    target: String,
    executable: String,
    typst_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedUnicodeInstallResult {
    pub path: String,
    pub version: String,
    pub engine_version: String,
}

fn report(
    callback: ProgressCallback<'_>,
    phase: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) {
    if let Some(callback) = callback {
        callback(ToolchainInstallProgress {
            phase: phase.to_string(),
            downloaded_bytes,
            total_bytes,
        });
    }
}

fn platform_target() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("x86_64-pc-windows-msvc"),
        ("linux", "x86_64") => Ok("x86_64-unknown-linux-gnu"),
        ("linux", "aarch64") => Ok("aarch64-unknown-linux-gnu"),
        ("macos", "x86_64") => Ok("x86_64-apple-darwin"),
        ("macos", "aarch64") => Ok("aarch64-apple-darwin"),
        (os, arch) => Err(format!(
            "Enhanced Unicode Engine {ENGINE_VERSION} is not published for {os} {arch}. Choose a compatible local executable instead."
        )),
    }
}

fn install_root(data_dir: &Path) -> PathBuf {
    data_dir.join("toolchain").join("enhanced-unicode")
}

fn installed_executable(data_dir: &Path, executable: &str) -> PathBuf {
    install_root(data_dir).join(ENGINE_VERSION).join(executable)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Typsastra/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|error| format!("Failed to initialize Enhanced Unicode downloader: {error}"))
}

async fn fetch_manifest(client: &reqwest::Client) -> Result<ReleaseManifest, String> {
    let response = client.get(MANIFEST_URL).send().await.map_err(|error| {
        format!("Failed to retrieve the Enhanced Unicode release manifest: {error}")
    })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| {
        format!("Failed to read the Enhanced Unicode release manifest: {error}")
    })?;
    if !status.is_success() {
        return Err(format!(
            "Enhanced Unicode release manifest request failed ({status}): {}",
            String::from_utf8_lossy(&bytes)
                .chars()
                .take(240)
                .collect::<String>()
        ));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Failed to decode the Enhanced Unicode release manifest: {error}"))
}

fn select_asset(manifest: &ReleaseManifest) -> Result<ManifestAsset, String> {
    if manifest.schema_version != 1
        || manifest.engine.version != ENGINE_VERSION
        || manifest.release.repository != RELEASE_REPOSITORY
        || manifest.release.tag != RELEASE_TAG
    {
        return Err(format!(
            "The Enhanced Unicode release manifest does not describe the trusted {ENGINE_VERSION} release."
        ));
    }
    let target = platform_target()?;
    let pinned = PINNED_ASSETS
        .iter()
        .find(|asset| asset.target == target)
        .ok_or_else(|| {
            format!("Enhanced Unicode Engine {ENGINE_VERSION} has no pinned asset for {target}.")
        })?;
    let asset = manifest
        .assets
        .iter()
        .find(|asset| asset.target == target)
        .cloned()
        .ok_or_else(|| {
            format!("Enhanced Unicode Engine {ENGINE_VERSION} has no asset for {target}.")
        })?;
    if asset.archive != pinned.archive
        || asset.executable != pinned.executable
        || asset.bytes != pinned.bytes
        || !asset.sha256.eq_ignore_ascii_case(pinned.sha256)
    {
        return Err(format!(
            "The Enhanced Unicode release manifest does not match Typsastra's pinned {target} artifact."
        ));
    }
    if asset.bytes == 0 || asset.bytes > MAX_DOWNLOAD_BYTES {
        return Err("The Enhanced Unicode archive has an unsafe or invalid declared size.".into());
    }
    if asset.sha256.len() != 64 || !asset.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The Enhanced Unicode archive has an invalid SHA-256 digest.".into());
    }
    let url = reqwest::Url::parse(&asset.download_url)
        .map_err(|error| format!("The Enhanced Unicode download URL is invalid: {error}"))?;
    let expected_prefix = format!("/{RELEASE_REPOSITORY}/releases/download/{RELEASE_TAG}/");
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.path().starts_with(&expected_prefix)
        || !url.path().ends_with(&format!("/{}", asset.archive))
    {
        return Err(
            "The Enhanced Unicode manifest points outside the trusted Typsastra release.".into(),
        );
    }
    Ok(asset)
}

async fn download_archive(
    client: &reqwest::Client,
    asset: &ManifestAsset,
    data_dir: &Path,
    progress: ProgressCallback<'_>,
) -> Result<tempfile::NamedTempFile, String> {
    let mut last_error = String::new();
    for attempt in 1..=DOWNLOAD_ATTEMPTS {
        match download_archive_once(client, asset, data_dir, progress).await {
            Ok(file) => return Ok(file),
            Err(error) => {
                last_error = error;
                if attempt < DOWNLOAD_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                }
            }
        }
    }
    Err(format!(
        "Failed to download {} after {DOWNLOAD_ATTEMPTS} attempts: {last_error}. Check the internet connection, VPN/proxy, firewall, or antivirus HTTPS scanning, then retry.",
        asset.archive
    ))
}

async fn download_archive_once(
    client: &reqwest::Client,
    asset: &ManifestAsset,
    data_dir: &Path,
    progress: ProgressCallback<'_>,
) -> Result<tempfile::NamedTempFile, String> {
    let mut response = client
        .get(&asset.download_url)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("server returned an error: {error}"))?;
    if response
        .content_length()
        .is_some_and(|bytes| bytes > MAX_DOWNLOAD_BYTES)
    {
        return Err("server reported an unexpectedly large download".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(data_dir)
        .map_err(|error| format!("Could not create the temporary engine download: {error}"))?;
    let mut downloaded = 0_u64;
    report(progress, "downloading", 0, Some(asset.bytes));
    loop {
        let chunk = tokio::time::timeout(DOWNLOAD_STALL_TIMEOUT, response.chunk())
            .await
            .map_err(|_| format!("download stalled after receiving {downloaded} bytes"))?
            .map_err(|error| format!("connection ended while reading the archive: {error}"))?;
        let Some(chunk) = chunk else { break };
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "download size overflowed".to_string())?;
        if downloaded > MAX_DOWNLOAD_BYTES || downloaded > asset.bytes {
            return Err("download exceeded its signed manifest size".into());
        }
        temporary
            .write_all(&chunk)
            .map_err(|error| format!("Could not write the engine download: {error}"))?;
        report(progress, "downloading", downloaded, Some(asset.bytes));
    }
    temporary
        .flush()
        .map_err(|error| format!("Could not flush the engine download: {error}"))?;
    if downloaded != asset.bytes {
        return Err(format!(
            "incomplete download: received {downloaded} of {} bytes",
            asset.bytes
        ));
    }
    Ok(temporary)
}

fn verify_archive(path: &Path, expected: &str) -> Result<(), String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Could not verify the downloaded engine: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not hash the downloaded engine: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "Enhanced Unicode archive integrity check failed (expected {expected}, received {actual})."
        ));
    }
    Ok(())
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(|error| format!("Could not inspect the installed engine: {error}"))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions)
            .map_err(|error| format!("Could not make the installed engine executable: {error}"))?;
    }
    Ok(())
}

fn compiler_version(path: &Path) -> Result<String, String> {
    let mut command = Command::new(path);
    command.arg("--version");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| {
        format!("Could not start the installed Enhanced Unicode engine: {error}")
    })?;
    if !output.status.success() {
        return Err("The installed Enhanced Unicode engine rejected 'typst --version'.".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .chain(String::from_utf8_lossy(&output.stderr).lines())
        .map(str::trim)
        .find(|line| line.to_ascii_lowercase().starts_with("typst "))
        .map(str::to_string)
        .ok_or_else(|| {
            "The installed Enhanced Unicode engine did not report a Typst version.".into()
        })
}

fn version_matches(reported: &str, expected: &str) -> bool {
    reported
        .split_whitespace()
        .nth(1)
        .is_some_and(|version| version == expected)
}

fn extract_archive(
    archive_path: &Path,
    asset: &ManifestAsset,
    expected_typst_version: &str,
    data_dir: &Path,
) -> Result<PathBuf, String> {
    let root = install_root(data_dir);
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create the managed toolchain directory: {error}"))?;
    let staging = root.join(format!(".installing-{}", std::process::id()));
    let destination = root.join(ENGINE_VERSION);
    let backup = root.join(format!(".previous-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_dir_all(&backup);
    std::fs::create_dir_all(&staging)
        .map_err(|error| format!("Could not stage the Enhanced Unicode engine: {error}"))?;

    let result = (|| {
        let file = std::fs::File::open(archive_path)
            .map_err(|error| format!("Could not open the Enhanced Unicode archive: {error}"))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|error| format!("Could not read the Enhanced Unicode archive: {error}"))?;
        for entry_name in [&asset.executable, "ENGINE_RELEASE.json", "LICENSE"] {
            let Ok(mut entry) = archive.by_name(entry_name) else {
                if entry_name == "LICENSE" {
                    continue;
                }
                return Err(format!(
                    "The Enhanced Unicode archive is missing {entry_name}."
                ));
            };
            if entry.is_dir() {
                return Err(format!(
                    "The Enhanced Unicode archive entry {entry_name} is invalid."
                ));
            }
            let output = staging.join(entry_name);
            let mut output_file = std::fs::File::create(&output)
                .map_err(|error| format!("Could not extract {entry_name}: {error}"))?;
            std::io::copy(&mut entry, &mut output_file)
                .map_err(|error| format!("Could not extract {entry_name}: {error}"))?;
        }

        let packaged: PackagedRelease = serde_json::from_slice(
            &std::fs::read(staging.join("ENGINE_RELEASE.json"))
                .map_err(|error| format!("Could not read packaged release metadata: {error}"))?,
        )
        .map_err(|error| format!("Could not decode packaged release metadata: {error}"))?;
        if packaged.version != ENGINE_VERSION
            || packaged.target != asset.target
            || packaged.executable != asset.executable
            || packaged.typst_version != expected_typst_version
        {
            return Err("The archive metadata does not match the signed release manifest.".into());
        }
        let executable = staging.join(&asset.executable);
        make_executable(&executable)?;
        let version = compiler_version(&executable)?;
        if !version_matches(&version, expected_typst_version) {
            return Err(format!(
                "The installed engine reported {version}, expected Typst {expected_typst_version}."
            ));
        }
        Ok(())
    })();

    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    if destination.exists() {
        std::fs::rename(&destination, &backup).map_err(|error| {
            format!("Could not replace the existing Enhanced Unicode engine: {error}")
        })?;
    }
    if let Err(error) = std::fs::rename(&staging, &destination) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, &destination);
        }
        return Err(format!(
            "Could not activate the Enhanced Unicode engine: {error}"
        ));
    }
    let _ = std::fs::remove_dir_all(backup);
    Ok(destination.join(&asset.executable))
}

async fn install_internal(
    data_dir: &Path,
    progress: ProgressCallback<'_>,
) -> Result<EnhancedUnicodeInstallResult, String> {
    report(progress, "resolving", 0, None);
    std::fs::create_dir_all(data_dir)
        .map_err(|error| format!("Could not create the Typsastra data directory: {error}"))?;
    let client = client()?;
    let manifest = fetch_manifest(&client).await?;
    let asset = select_asset(&manifest)?;
    let destination = installed_executable(data_dir, &asset.executable);
    if destination.is_file() {
        if let Ok(version) = compiler_version(&destination) {
            if version_matches(&version, &manifest.engine.typst_version) {
                report(progress, "complete", 0, None);
                return Ok(EnhancedUnicodeInstallResult {
                    path: dunce::simplified(&destination)
                        .to_string_lossy()
                        .to_string(),
                    version,
                    engine_version: manifest.engine.version,
                });
            }
        }
    }

    let archive = download_archive(&client, &asset, data_dir, progress).await?;
    report(progress, "verifying", asset.bytes, Some(asset.bytes));
    verify_archive(archive.path(), &asset.sha256)?;
    report(progress, "installing", asset.bytes, Some(asset.bytes));
    let destination = extract_archive(
        archive.path(),
        &asset,
        &manifest.engine.typst_version,
        data_dir,
    )?;
    let version = compiler_version(&destination)?;
    report(progress, "complete", asset.bytes, Some(asset.bytes));
    Ok(EnhancedUnicodeInstallResult {
        path: dunce::simplified(&destination)
            .to_string_lossy()
            .to_string(),
        version,
        engine_version: manifest.engine.version,
    })
}

pub async fn install_with_progress(
    data_dir: &Path,
    progress: &(dyn Fn(ToolchainInstallProgress) + Send + Sync),
) -> Result<EnhancedUnicodeInstallResult, String> {
    install_internal(data_dir, Some(progress)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_for_current_platform() -> ReleaseManifest {
        let target = platform_target().expect("test runner must use a supported desktop target");
        let pinned = PINNED_ASSETS
            .iter()
            .find(|asset| asset.target == target)
            .expect("supported target must have a pinned artifact");
        ReleaseManifest {
            schema_version: 1,
            engine: ManifestEngine {
                version: ENGINE_VERSION.into(),
                typst_version: "0.15.1".into(),
            },
            release: ManifestRelease {
                repository: RELEASE_REPOSITORY.into(),
                tag: RELEASE_TAG.into(),
            },
            assets: vec![ManifestAsset {
                target: pinned.target.into(),
                archive: pinned.archive.into(),
                executable: pinned.executable.into(),
                bytes: pinned.bytes,
                sha256: pinned.sha256.into(),
                download_url: format!(
                    "https://github.com/{RELEASE_REPOSITORY}/releases/download/{RELEASE_TAG}/{}",
                    pinned.archive
                ),
            }],
        }
    }

    #[test]
    fn accepts_only_the_pinned_platform_artifact() {
        let manifest = manifest_for_current_platform();
        let selected = select_asset(&manifest).expect("pinned artifact should be accepted");
        assert_eq!(selected.target, platform_target().unwrap());

        let mut changed = manifest_for_current_platform();
        changed.assets[0].sha256 = "0".repeat(64);
        assert!(select_asset(&changed).is_err());
    }

    #[test]
    fn validates_the_exact_typst_version_token() {
        assert!(version_matches("typst 0.15.1 (enhanced)", "0.15.1"));
        assert!(!version_matches("typst 0.15.10", "0.15.1"));
        assert!(!version_matches("not-typst", "0.15.1"));
    }
}
