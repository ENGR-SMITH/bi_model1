# Third-Party Notices

## FFmpeg

The API server (`artifacts/api-server`) invokes the FFmpeg command-line tools
(`ffmpeg` and `ffprobe`) as separate child processes to build low-resolution
video proxies and extract media metadata (duration, PCM audio for waveform
sync).

- **How it is used:** `spawnSync("ffmpeg", ...)` / `spawnSync("ffprobe", ...)`.
  FFmpeg is called as an external binary — it is **not** linked into the
  application, and the application does not embed or redistribute FFmpeg.
  The binary is installed in the runtime environment via Nix
  (`[nix] packages = ["ffmpeg"]` in `.replit`) or the host package manager.
- **License:** FFmpeg is distributed under the GNU LGPL v2.1+ and GNU GPL v2+,
  depending on build configuration. The build used includes GPL-licensed
  encoders (e.g. `libx264`).
- **Upstream:** https://ffmpeg.org — source is available there and via the
  nixpkgs derivation used to build the binary.

Compliance notes: keep FFmpeg as a separate binary (do not link its libraries
into the application), do not enable or distribute builds configured with
`--enable-nonfree` (e.g. `libfdk_aac`), and preserve these notices whenever the
binary is distributed with the application.
