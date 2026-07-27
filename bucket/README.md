# Scoop packaging

`typsastra.json` is the [Scoop](https://scoop.sh) manifest for the Windows
portable build. The release workflow attaches a `Typsastra_<version>_x64_portable.zip`
to each GitHub release, and this manifest points Scoop at it.

## In-app updater

The portable zip ships a `.updater-disabled` marker next to the executable. The
app's `updater_disabled` command detects it and skips the in-app self-updater, so
Scoop-installed copies update via `scoop update` instead of fighting the built-in
updater. The MSI build has no marker and keeps its self-updater.

## Publishing the bucket

Scoop installs from a *bucket* (a git repo of manifests). Create a dedicated repo
so the install command stays short:

1. Create `github.com/Sovichea/scoop-typsastra`.
2. Copy `typsastra.json` into a `bucket/` folder in that repo.
3. Enable [Excavator](https://github.com/ScoopInstaller/Excavator) (the auto-update
   Action) so `checkver`/`autoupdate` bump the version and hash on each release.

Users then install with:

```powershell
scoop bucket add typsastra https://github.com/Sovichea/scoop-typsastra
scoop install typsastra
```

## Filling the hash for the first release

`autoupdate` computes the hash automatically for future versions, but the initial
manifest needs a real one. After the first release with the portable zip exists:

```powershell
$url = "https://github.com/Sovichea/typsastra/releases/download/v0.5.2/Typsastra_0.5.2_x64_portable.zip"
Invoke-WebRequest $url -OutFile portable.zip
(Get-FileHash portable.zip -Algorithm SHA256).Hash.ToLower()
```

Paste the result into `architecture.64bit.hash`. (The workflow also prints this
hash in the "Package Portable Zip" step log.)
