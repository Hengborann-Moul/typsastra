use semver::Version;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const TINYMIST_RELEASES_URL: &str = "https://api.github.com/repos/Myriad-Dreamin/tinymist/releases";
const TINYMIST_TAGS_URL: &str = "https://api.github.com/repos/Myriad-Dreamin/tinymist/tags";
const TOOLCHAIN_DOWNLOAD_ATTEMPTS: usize = 3;
const MAX_TOOLCHAIN_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
const TOOLCHAIN_DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(60);
const TOOLCHAIN_VERSION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
struct GithubTag {
    name: String,
}

#[derive(Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Clone)]
struct StableRelease {
    version: Version,
    assets: Vec<GithubAsset>,
}

#[derive(Clone)]
struct InstalledToolchain {
    directory: String,
    tinymist_version: Version,
    typst_version: Version,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemToolchainInfo {
    pub path: String,
    pub tinymist_version: String,
    pub typst_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectToolchainState {
    ExactActive,
    ExactInstalled,
    DownloadRequired,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TinymistReleaseInfo {
    version: String,
    published_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    pub typst_version: Option<String>,
    pub typst_source: Option<String>,
    pub tinymist_version: Option<String>,
    pub tinymist_source: Option<String>,
    pub lsp_available: bool,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainInstallProgress {
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

type InstallProgressCallback<'a> = Option<&'a (dyn Fn(ToolchainInstallProgress) + Send + Sync)>;

fn report_install_progress(
    callback: InstallProgressCallback<'_>,
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

fn version_dir(data_dir: &Path, version: &str) -> PathBuf {
    data_dir.join("toolchain").join(version)
}

fn selected_system_path_file(data_dir: &Path) -> PathBuf {
    data_dir.join("toolchain").join("active-system-path")
}

fn clear_selected_system_path(data_dir: &Path) {
    let _ = std::fs::remove_file(selected_system_path_file(data_dir));
}

pub fn managed_executable_path(data_dir: &Path, version: &str, name: &str) -> PathBuf {
    #[cfg(windows)]
    let file_name = format!("{}.exe", name);
    #[cfg(not(windows))]
    let file_name = name.to_string();
    version_dir(data_dir, version).join(file_name)
}

fn command_for(executable: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(executable);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn version_output(executable: &Path) -> Option<String> {
    version_output_with_timeout(executable, TOOLCHAIN_VERSION_TIMEOUT)
}

fn version_output_with_timeout(executable: &Path, timeout: Duration) -> Option<String> {
    let mut child = command_for(executable)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}

fn labeled_version(text: &str, label: &str) -> Option<Version> {
    text.lines().find_map(|line| {
        let value = line
            .trim()
            .strip_prefix(label)?
            .trim()
            .trim_start_matches('v');
        Version::parse(value).ok()
    })
}

fn tinymist_metadata(executable: &Path) -> Option<(Version, Version)> {
    let text = version_output(executable)?;
    let tinymist = labeled_version(&text, "Build Git Describe:")
        .or_else(|| labeled_version(&text, "Tinymist Version:"))
        .or_else(|| {
            text.lines().find_map(|line| {
                let value = line
                    .trim()
                    .strip_prefix("tinymist")?
                    .trim()
                    .trim_start_matches('v');
                Version::parse(value).ok()
            })
        })
        .or_else(|| {
            let dir_name = executable.parent()?.file_name()?;
            Version::parse(&dir_name.to_string_lossy()).ok()
        })?;
    let typst = labeled_version(&text, "Typst Version:")?;
    Some((tinymist, typst))
}

fn installed_toolchains(data_dir: &Path) -> Vec<InstalledToolchain> {
    let Ok(entries) = std::fs::read_dir(data_dir.join("toolchain")) else {
        return Vec::new();
    };
    let mut installed: Vec<_> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let directory = entry.file_name().to_string_lossy().to_string();
            let executable = managed_executable_path(data_dir, &directory, "tinymist");
            let (tinymist_version, typst_version) = tinymist_metadata(&executable)?;
            Some(InstalledToolchain {
                directory,
                tinymist_version,
                typst_version,
            })
        })
        .collect();
    installed.sort_by(|left, right| right.tinymist_version.cmp(&left.tinymist_version));
    installed
}

pub fn project_toolchain_state(
    data_dir: &Path,
    required_tinymist: &str,
    required_typst: &str,
) -> ProjectToolchainState {
    let required_tinymist = Version::parse(required_tinymist).ok();
    let required_typst = Version::parse(required_typst).ok();
    let installed = installed_toolchains(data_dir);
    let active = if selected_system_path_file(data_dir).is_file() {
        selected_system_toolchain(data_dir).map(|toolchain| InstalledToolchain {
            directory: toolchain.path.to_string_lossy().to_string(),
            tinymist_version: toolchain.tinymist_version,
            typst_version: toolchain.typst_version,
        })
    } else {
        active_toolchain(data_dir)
    };
    classify_project_toolchain(
        active.as_ref(),
        &installed,
        required_tinymist.as_ref(),
        required_typst.as_ref(),
    )
}

fn classify_project_toolchain(
    active: Option<&InstalledToolchain>,
    installed: &[InstalledToolchain],
    required_tinymist: Option<&Version>,
    required_typst: Option<&Version>,
) -> ProjectToolchainState {
    let matches = |toolchain: &InstalledToolchain| {
        required_tinymist == Some(&toolchain.tinymist_version)
            && required_typst == Some(&toolchain.typst_version)
    };
    if active.is_some_and(matches) {
        return ProjectToolchainState::ExactActive;
    }
    if installed.iter().any(matches) {
        ProjectToolchainState::ExactInstalled
    } else {
        ProjectToolchainState::DownloadRequired
    }
}

pub fn select_project_toolchain(
    data_dir: &Path,
    required_tinymist: &str,
    required_typst: &str,
) -> Result<ToolchainStatus, String> {
    let required_tinymist = Version::parse(required_tinymist)
        .map_err(|_| format!("Invalid Tinymist version: {required_tinymist}"))?;
    let required_typst = Version::parse(required_typst)
        .map_err(|_| format!("Invalid Typst version: {required_typst}"))?;
    let installed = installed_toolchains(data_dir)
        .into_iter()
        .find(|toolchain| {
            toolchain.tinymist_version == required_tinymist
                && toolchain.typst_version == required_typst
        })
        .ok_or_else(|| {
            format!(
                "Tinymist {required_tinymist} with embedded Typst {required_typst} is not installed."
            )
        })?;
    let active_file = data_dir.join("toolchain").join("active-version");
    if let Some(parent) = active_file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create toolchain directory: {error}"))?;
    }
    std::fs::write(&active_file, &installed.directory).map_err(|error| {
        format!(
            "Failed to select Tinymist {}: {error}",
            installed.tinymist_version
        )
    })?;
    clear_selected_system_path(data_dir);
    Ok(status(data_dir))
}

fn active_toolchain(data_dir: &Path) -> Option<InstalledToolchain> {
    let installed = installed_toolchains(data_dir);
    let selected = std::fs::read_to_string(data_dir.join("toolchain").join("active-version"))
        .ok()
        .map(|value| value.trim().to_string());
    selected
        .and_then(|directory| {
            installed
                .iter()
                .find(|toolchain| toolchain.directory == directory)
                .cloned()
        })
        .or_else(|| installed.into_iter().next())
}

pub fn resolve_executable(data_dir: &Path, version: &str, name: &str) -> Option<PathBuf> {
    let path = managed_executable_path(data_dir, version, name);
    path.is_file().then_some(path)
}

pub fn active_tinymist(data_dir: &Path) -> Option<PathBuf> {
    if selected_system_path_file(data_dir).is_file() {
        return selected_system_toolchain(data_dir).map(|toolchain| toolchain.path);
    }
    let directory = active_toolchain(data_dir)?.directory;
    resolve_executable(data_dir, &directory, "tinymist")
}

pub fn inspect_active_tinymist(data_dir: &Path) -> Option<(PathBuf, String, String)> {
    let executable = active_tinymist(data_dir)?;
    let (tinymist_version, typst_version) = tinymist_metadata(&executable)?;
    Some((
        executable,
        tinymist_version.to_string(),
        typst_version.to_string(),
    ))
}

pub fn inspect_tinymist_executable(executable: &Path) -> Option<(String, String)> {
    let (tinymist_version, typst_version) = tinymist_metadata(executable)?;
    Some((tinymist_version.to_string(), typst_version.to_string()))
}

#[derive(Clone)]
struct SystemToolchain {
    path: PathBuf,
    tinymist_version: Version,
    typst_version: Version,
}

fn system_path_candidates() -> Vec<PathBuf> {
    let executable_names: &[&str] = if cfg!(windows) {
        &["tinymist.exe", "tinymist"]
    } else {
        &["tinymist"]
    };
    let mut candidates = Vec::new();
    for directory in system_search_directories() {
        for executable_name in executable_names {
            let candidate = directory.join(executable_name);
            if candidate.is_file() {
                let canonical = std::fs::canonicalize(&candidate).unwrap_or(candidate);
                if !candidates.iter().any(|existing| existing == &canonical) {
                    candidates.push(canonical);
                }
            }
        }
    }
    candidates
}

fn system_search_directories() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path));
    }
    paths.extend(current_windows_path_directories());
    let mut unique: Vec<PathBuf> = Vec::new();
    for path in paths {
        if !unique.iter().any(|existing| paths_equal(existing, &path)) {
            unique.push(path);
        }
    }
    unique
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

#[cfg(windows)]
fn current_windows_path_directories() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .ok()
        .and_then(|key| key.get_value::<String, _>("Path").ok());
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
        .ok()
        .and_then(|key| key.get_value::<String, _>("Path").ok());
    user.into_iter()
        .chain(machine)
        .flat_map(|path| path.split(';').map(str::to_string).collect::<Vec<_>>())
        .map(|path| expand_windows_environment_variables(path.trim()))
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(windows)]
fn expand_windows_environment_variables(value: &str) -> String {
    let mut expanded = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(start) = remaining.find('%') {
        expanded.push_str(&remaining[..start]);
        let variable = &remaining[start + 1..];
        let Some(end) = variable.find('%') else {
            expanded.push_str(&remaining[start..]);
            return expanded;
        };
        let name = &variable[..end];
        if let Some(replacement) = std::env::var_os(name) {
            expanded.push_str(&replacement.to_string_lossy());
        } else {
            expanded.push('%');
            expanded.push_str(name);
            expanded.push('%');
        }
        remaining = &variable[end + 1..];
    }
    expanded.push_str(remaining);
    expanded
}

#[cfg(not(windows))]
fn current_windows_path_directories() -> Vec<PathBuf> {
    Vec::new()
}

fn inspect_system_toolchain(path: PathBuf) -> Option<SystemToolchain> {
    let (tinymist_version, typst_version) = tinymist_metadata(&path)?;
    Some(SystemToolchain {
        path,
        tinymist_version,
        typst_version,
    })
}

fn selected_system_toolchain(data_dir: &Path) -> Option<SystemToolchain> {
    let path = std::fs::read_to_string(selected_system_path_file(data_dir)).ok()?;
    inspect_system_toolchain(PathBuf::from(path.trim()))
}

pub fn system_toolchains() -> Vec<SystemToolchainInfo> {
    system_path_candidates()
        .into_iter()
        .filter_map(inspect_system_toolchain)
        .map(|toolchain| SystemToolchainInfo {
            path: toolchain.path.to_string_lossy().to_string(),
            tinymist_version: toolchain.tinymist_version.to_string(),
            typst_version: toolchain.typst_version.to_string(),
        })
        .collect()
}

pub fn select_system_toolchain(
    data_dir: &Path,
    requested_path: &str,
) -> Result<ToolchainStatus, String> {
    let requested = std::fs::canonicalize(requested_path)
        .map_err(|error| format!("Tinymist is no longer available at {requested_path}: {error}"))?;
    let discovered = system_path_candidates();
    if !discovered.iter().any(|candidate| candidate == &requested) {
        return Err(
            "The selected Tinymist executable is not available through the system PATH."
                .to_string(),
        );
    }
    let toolchain = inspect_system_toolchain(requested.clone()).ok_or_else(|| {
        "The selected executable did not report valid Tinymist and embedded Typst versions."
            .to_string()
    })?;
    let toolchain_dir = data_dir.join("toolchain");
    std::fs::create_dir_all(&toolchain_dir)
        .map_err(|error| format!("Failed to create toolchain directory: {error}"))?;
    std::fs::write(
        selected_system_path_file(data_dir),
        requested.to_string_lossy().as_bytes(),
    )
    .map_err(|error| format!("Failed to select system Tinymist: {error}"))?;
    let status = status(data_dir);
    if status.tinymist_version != Some(toolchain.tinymist_version.to_string()) {
        return Err("System Tinymist selection could not be verified.".to_string());
    }
    Ok(status)
}

pub fn status(data_dir: &Path) -> ToolchainStatus {
    if let Some(toolchain) = selected_system_toolchain(data_dir) {
        return ToolchainStatus {
            typst_version: Some(toolchain.typst_version.to_string()),
            typst_source: Some(format!(
                "Embedded in Tinymist {}",
                toolchain.tinymist_version
            )),
            tinymist_version: Some(toolchain.tinymist_version.to_string()),
            tinymist_source: Some(format!("System PATH · {}", toolchain.path.display())),
            lsp_available: true,
            message: format!(
                "System Tinymist {} with embedded Typst {} is ready.",
                toolchain.tinymist_version, toolchain.typst_version
            ),
        };
    }
    if selected_system_path_file(data_dir).is_file() {
        let selected_path =
            std::fs::read_to_string(selected_system_path_file(data_dir)).unwrap_or_default();
        let selected_path = selected_path.trim();
        return ToolchainStatus {
            typst_version: None,
            typst_source: None,
            tinymist_version: None,
            tinymist_source: (!selected_path.is_empty())
                .then(|| format!("System PATH - {selected_path}")),
            lsp_available: false,
            message: "The selected system Tinymist is no longer available or does not report valid version information. Select another toolchain in Settings."
                .to_string(),
        };
    }
    let Some(toolchain) = active_toolchain(data_dir) else {
        return ToolchainStatus {
            typst_version: None,
            typst_source: None,
            tinymist_version: None,
            tinymist_source: None,
            lsp_available: false,
            message: "Tinymist is not installed.".to_string(),
        };
    };
    let tinymist = toolchain.tinymist_version.to_string();
    let typst = toolchain.typst_version.to_string();
    ToolchainStatus {
        typst_version: Some(typst.clone()),
        typst_source: Some(format!("Embedded in Tinymist {}", tinymist)),
        tinymist_version: Some(tinymist.clone()),
        tinymist_source: Some("Managed by Typsastra".to_string()),
        lsp_available: true,
        message: format!(
            "Tinymist {} with embedded Typst {} is ready.",
            tinymist, typst
        ),
    }
}

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Typsastra/{}", env!("CARGO_PKG_VERSION")))
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/vnd.github+json"),
            );
            headers.insert(
                "x-github-api-version",
                reqwest::header::HeaderValue::from_static("2022-11-28"),
            );
            headers
        })
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to initialize GitHub client: {}", error))
}

fn github_asset_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Typsastra/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|error| format!("Failed to initialize toolchain downloader: {}", error))
}

async fn decode_github_json<T: DeserializeOwned>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, String> {
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read {} response: {}", context, error))?;
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&body);
        return Err(format!(
            "{} request failed ({}): {}",
            context,
            status,
            detail.chars().take(240).collect::<String>()
        ));
    }
    serde_json::from_slice(&body).map_err(|error| {
        format!(
            "Failed to decode {} response ({}; {} bytes): {}",
            context,
            content_type,
            body.len(),
            error
        )
    })
}

async fn fetch_stable_versions() -> Result<Vec<Version>, String> {
    let client = github_client()?;
    let mut versions = Vec::new();
    for page in 1.. {
        let response = client
            .get(TINYMIST_TAGS_URL)
            .query(&[("per_page", 100), ("page", page)])
            .send()
            .await
            .map_err(|error| format!("Failed to fetch Tinymist tags: {}", error))?;
        let page_tags: Vec<GithubTag> = decode_github_json(response, "Tinymist tags").await?;
        let is_last_page = page_tags.len() < 100;
        versions.extend(page_tags.into_iter().filter_map(|tag| {
            let version = Version::parse(tag.name.trim_start_matches('v')).ok()?;
            (version.pre.is_empty() && version.patch % 2 == 0).then_some(version)
        }));
        if is_last_page {
            break;
        }
    }
    versions.sort_by(|left, right| right.cmp(left));
    versions.dedup();
    Ok(versions)
}

async fn fetch_release(version: &Version) -> Result<StableRelease, String> {
    let client = github_client()?;
    let response = client
        .get(format!("{}/tags/v{}", TINYMIST_RELEASES_URL, version))
        .send()
        .await
        .map_err(|error| format!("Failed to fetch Tinymist {}: {}", version, error))?;
    let release: GithubRelease =
        decode_github_json(response, &format!("Tinymist {} release", version)).await?;
    stable_release(release).ok_or_else(|| format!("Tinymist {} is not a stable release.", version))
}

fn stable_release(release: GithubRelease) -> Option<StableRelease> {
    if release.draft || release.prerelease {
        return None;
    }
    let version = Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
    if !version.pre.is_empty() || version.patch % 2 == 1 {
        return None;
    }
    Some(StableRelease {
        version,
        assets: release.assets,
    })
}

pub async fn tinymist_releases() -> Result<Vec<TinymistReleaseInfo>, String> {
    Ok(fetch_stable_versions()
        .await?
        .into_iter()
        .map(|version| TinymistReleaseInfo {
            version: version.to_string(),
            published_at: None,
        })
        .collect())
}

fn platform_asset_name() -> Result<String, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("tinymist-win32-x64.exe".into()),
        ("windows", "aarch64") => Ok("tinymist-win32-arm64.exe".into()),
        ("macos", "x86_64") => Ok("tinymist-darwin-x64".into()),
        ("macos", "aarch64") => Ok("tinymist-darwin-arm64".into()),
        ("linux", "x86_64") => Ok("tinymist-linux-x64".into()),
        ("linux", "aarch64") => Ok("tinymist-linux-arm64".into()),
        (os, arch) => Err(format!(
            "No Tinymist binary is published for {} {}.",
            os, arch
        )),
    }
}

async fn download_to_temporary_file(
    asset: &GithubAsset,
    directory: &Path,
    progress: InstallProgressCallback<'_>,
) -> Result<tempfile::NamedTempFile, String> {
    let client = github_asset_client()?;
    let mut last_error = None;

    for attempt in 1..=TOOLCHAIN_DOWNLOAD_ATTEMPTS {
        match download_once(&client, asset, directory, progress).await {
            Ok(download) => return Ok(download),
            Err(error) => {
                last_error = Some(error);
                if attempt < TOOLCHAIN_DOWNLOAD_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                }
            }
        }
    }

    Err(format!(
        "Failed to download {} after {} attempts: {}. Check the internet connection, VPN/proxy, firewall, or antivirus HTTPS scanning, then retry.",
        asset.name,
        TOOLCHAIN_DOWNLOAD_ATTEMPTS,
        last_error.unwrap_or_else(|| "unknown download error".to_string())
    ))
}

async fn download_once(
    client: &reqwest::Client,
    asset: &GithubAsset,
    directory: &Path,
    progress: InstallProgressCallback<'_>,
) -> Result<tempfile::NamedTempFile, String> {
    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("server returned an error: {error}"))?;
    let expected_length = response.content_length();
    if expected_length.is_some_and(|length| length > MAX_TOOLCHAIN_DOWNLOAD_BYTES) {
        return Err(format!(
            "server reported an unexpected download size of {} bytes",
            expected_length.unwrap_or_default()
        ));
    }

    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| format!("could not create a temporary download: {error}"))?;
    let mut downloaded = 0_u64;
    let mut last_reported_percent = None;
    let mut last_reported_bytes = 0_u64;
    report_install_progress(progress, "downloading", 0, expected_length);
    loop {
        let chunk = tokio::time::timeout(TOOLCHAIN_DOWNLOAD_STALL_TIMEOUT, response.chunk())
            .await
            .map_err(|_| {
                format!(
                    "download stalled for {} seconds after receiving {downloaded} bytes",
                    TOOLCHAIN_DOWNLOAD_STALL_TIMEOUT.as_secs()
                )
            })?
            .map_err(|error| {
                format!("connection ended while reading the response body: {error}")
            })?;
        let Some(chunk) = chunk else {
            break;
        };
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "download size overflowed".to_string())?;
        if downloaded > MAX_TOOLCHAIN_DOWNLOAD_BYTES {
            return Err(format!(
                "download exceeded the {} MiB safety limit",
                MAX_TOOLCHAIN_DOWNLOAD_BYTES / 1024 / 1024
            ));
        }
        temporary
            .write_all(&chunk)
            .map_err(|error| format!("could not write the temporary download: {error}"))?;
        let percent = expected_length
            .filter(|length| *length > 0)
            .map(|length| downloaded.saturating_mul(100) / length);
        let should_report = percent != last_reported_percent
            || downloaded.saturating_sub(last_reported_bytes) >= 1024 * 1024;
        if should_report {
            report_install_progress(progress, "downloading", downloaded, expected_length);
            last_reported_percent = percent;
            last_reported_bytes = downloaded;
        }
    }
    temporary
        .flush()
        .map_err(|error| format!("could not flush the temporary download: {error}"))?;

    if downloaded == 0 {
        return Err("server returned an empty download".to_string());
    }
    if expected_length.is_some_and(|length| length != downloaded) {
        return Err(format!(
            "incomplete download: received {downloaded} of {} bytes",
            expected_length.unwrap_or_default()
        ));
    }
    Ok(temporary)
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(|error| format!("Failed to inspect downloaded executable: {}", error))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions)
            .map_err(|error| format!("Failed to mark executable as runnable: {}", error))?;
    }
    Ok(())
}

fn install_managed_executable(data_dir: &Path, version: &str, source: &Path) -> Result<(), String> {
    let destination = managed_executable_path(data_dir, version, "tinymist");
    let directory = destination.parent().ok_or("Invalid toolchain directory")?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create toolchain directory: {}", error))?;
    let staged = directory.join(".tinymist.new");
    let backup = directory.join(".tinymist.old");
    let _ = std::fs::remove_file(&staged);
    let _ = std::fs::remove_file(&backup);
    std::fs::copy(source, &staged)
        .map_err(|error| format!("Failed to stage Tinymist: {}", error))?;
    make_executable(&staged)?;
    if destination.exists() {
        std::fs::rename(&destination, &backup)
            .map_err(|error| format!("Failed to replace existing Tinymist: {}", error))?;
    }
    if let Err(error) = std::fs::rename(&staged, &destination) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, &destination);
        }
        return Err(format!("Failed to activate Tinymist: {}", error));
    }
    let _ = std::fs::remove_file(backup);
    Ok(())
}

async fn install_internal(
    data_dir: &Path,
    requested_version: &str,
    progress: InstallProgressCallback<'_>,
) -> Result<ToolchainStatus, String> {
    report_install_progress(progress, "resolving", 0, None);
    let requested = Version::parse(requested_version.trim_start_matches('v'))
        .map_err(|_| format!("Invalid stable Tinymist version: {}", requested_version))?;
    if !requested.pre.is_empty() || requested.patch % 2 == 1 {
        return Err(
            "Release candidates, prereleases, and Tinymist nightly builds are not supported."
                .to_string(),
        );
    }
    let release = fetch_release(&requested).await?;
    let asset_name = platform_asset_name()?;
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| format!("Tinymist {} has no {} asset.", release.version, asset_name))?;
    let version = requested.to_string();
    let destination = managed_executable_path(data_dir, &version, "tinymist");
    let already_installed =
        tinymist_metadata(&destination).is_some_and(|(tinymist, _)| tinymist == requested);
    if !already_installed {
        std::fs::create_dir_all(data_dir)
            .map_err(|error| format!("Failed to create app data directory: {}", error))?;
        let temporary = download_to_temporary_file(asset, data_dir, progress).await?;
        report_install_progress(progress, "installing", 0, None);
        install_managed_executable(data_dir, &version, temporary.path())?;
    }
    report_install_progress(progress, "verifying", 0, None);
    let (installed, _) = tinymist_metadata(&destination)
        .ok_or_else(|| "Downloaded Tinymist executable could not be started or did not report its embedded Typst version.".to_string())?;
    if installed != requested {
        return Err(format!(
            "Downloaded Tinymist reported version {}, expected {}.",
            installed, requested
        ));
    }
    std::fs::write(data_dir.join("toolchain").join("active-version"), &version)
        .map_err(|error| format!("Failed to select Tinymist {}: {}", version, error))?;
    clear_selected_system_path(data_dir);
    let status = status(data_dir);
    report_install_progress(progress, "complete", 0, None);
    Ok(status)
}

pub async fn install(data_dir: &Path, requested_version: &str) -> Result<ToolchainStatus, String> {
    install_internal(data_dir, requested_version, None).await
}

pub async fn install_with_progress(
    data_dir: &Path,
    requested_version: &str,
    progress: &(dyn Fn(ToolchainInstallProgress) + Send + Sync),
) -> Result<ToolchainStatus, String> {
    install_internal(data_dir, requested_version, Some(progress)).await
}

pub async fn ensure(data_dir: &Path) -> Result<ToolchainStatus, String> {
    let current = status(data_dir);
    if current.lsp_available {
        return Ok(current);
    }
    let latest = fetch_stable_versions()
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "GitHub returned no stable Tinymist releases.".to_string())?;
    install(data_dir, &latest.to_string()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prerelease_and_nightly_versions_are_not_stable() {
        let release = |tag: &str, prerelease| GithubRelease {
            tag_name: tag.to_string(),
            draft: false,
            prerelease,
            assets: vec![],
        };
        assert!(stable_release(release("v0.15.2", false)).is_some());
        assert!(stable_release(release("v0.15.1", false)).is_none());
        assert!(stable_release(release("v0.15.2-rc.1", false)).is_none());
        assert!(stable_release(release("v0.15.2", true)).is_none());
    }

    #[test]
    fn project_toolchain_matching_distinguishes_active_installed_and_missing() {
        let required_tinymist = Version::parse("0.13.10").unwrap();
        let required_typst = Version::parse("0.13.1").unwrap();
        let compatible = InstalledToolchain {
            directory: "0.13.10".to_string(),
            tinymist_version: required_tinymist.clone(),
            typst_version: required_typst.clone(),
        };
        let other = InstalledToolchain {
            directory: "0.14.0".to_string(),
            tinymist_version: Version::parse("0.14.0").unwrap(),
            typst_version: Version::parse("0.13.0").unwrap(),
        };
        assert!(matches!(
            classify_project_toolchain(
                Some(&compatible),
                &[compatible.clone()],
                Some(&required_tinymist),
                Some(&required_typst)
            ),
            ProjectToolchainState::ExactActive
        ));
        assert!(matches!(
            classify_project_toolchain(
                Some(&other),
                &[other.clone(), compatible],
                Some(&required_tinymist),
                Some(&required_typst)
            ),
            ProjectToolchainState::ExactInstalled
        ));
        assert!(matches!(
            classify_project_toolchain(
                Some(&other),
                &[other.clone()],
                Some(&required_tinymist),
                Some(&required_typst)
            ),
            ProjectToolchainState::DownloadRequired
        ));
    }

    #[test]
    fn parses_tinymist_and_embedded_typst_versions() {
        let output = "tinymist\nBuild Git Describe: v0.14.20\nTypst Version: 0.14.2\n";
        assert_eq!(
            labeled_version(output, "Build Git Describe:").unwrap(),
            Version::new(0, 14, 20)
        );
        assert_eq!(
            labeled_version(output, "Typst Version:").unwrap(),
            Version::new(0, 14, 2)
        );
    }

    #[test]
    fn platform_asset_is_supported_for_current_host() {
        assert!(platform_asset_name().is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn version_probe_times_out_for_an_unresponsive_executable() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("unresponsive-tinymist");
        std::fs::write(&executable, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let started = Instant::now();
        assert!(version_output_with_timeout(&executable, Duration::from_millis(50)).is_none());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn missing_selected_system_toolchain_does_not_fall_back_silently() {
        let data_dir = tempfile::tempdir().unwrap();
        let marker = selected_system_path_file(data_dir.path());
        std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
        std::fs::write(
            &marker,
            data_dir
                .path()
                .join("missing-tinymist")
                .display()
                .to_string(),
        )
        .unwrap();

        let status = status(data_dir.path());
        assert!(!status.lsp_available);
        assert!(status.message.contains("no longer available"));
        assert!(active_tinymist(data_dir.path()).is_none());
    }
}
