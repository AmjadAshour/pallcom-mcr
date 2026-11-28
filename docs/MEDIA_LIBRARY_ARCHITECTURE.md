# Phase Three — Media Storage and Resumable Upload Architecture

## 1. Storage Architecture and Filesystem Layout

Phase Three introduces a persistent, filesystem-backed media storage layer (`backend/src/infrastructure/media/storage-manager.js`) that stores full-length movies, television programs, audio tracks, advertisements, and graphics outside both the relational database and public frontend directories.

Configurable storage root (`MCR_MEDIA_STORAGE_ROOT`, default `backend/storage/media-library`, Linux production target `/srv/pallcom-mcr`):

- `<root>/media/<orgId>/<uuid>.bin` — Validated, immutable media objects promoted after final SHA-256 verification.
- `<root>/uploads/<orgId>/<sessionUuid>.part` — Active resumable upload staging files (mode `0600`).
- `<root>/thumbnails/<orgId>/<assetUuid>.jpg` — Generated JPEG thumbnails (`480x270` max bounding box).
- `<root>/processing/<orgId>/` — Scratch processing workspace.
- `<root>/quarantine/<orgId>/<assetUuid>.bin` — Quarantined uploads that failed binary signature or codec/category safety validation.
- `MCR_MEDIA_IMPORT_DIR` (default `<root>/imports`, Linux target `/srv/pallcom-mcr/imports`) — Administrator-authorized server import directory.

### Filesystem Security Controls

1. **Opaque Internal Storage Keys**: User-supplied filenames are sanitized for display metadata only (`sanitizeDisplayFilename`) and are never used in filesystem paths. Every storage key matches `^(media|uploads|thumbnails|processing|quarantine)\/[a-zA-Z0-9_-]{1,80}\/[a-f0-9-]{36}\.(bin|part|jpg|png|mp4|m4a)$`.
2. **Path Traversal and Symlink Defense**: `resolveKeyPath` and `resolveImportSource` enforce strict prefix containment within the resolved storage or import root and call `lstat()` (`verifyNoSymlink`) to reject symbolic links before reading, writing, promoting, or serving files.
3. **Private Authorized Delivery**: Media files are never exposed via `express.static`. All thumbnail and preview streams (`/api/v1/media/assets/:id/thumbnail` and `/api/v1/media/assets/:id/preview` with HTTP `206 Partial Content` byte-range support) require authentication, `station:read` permission, organization ownership, `READY` processing state, and `Cache-Control: private, no-store`.

---

## 2. Resumable Chunked Upload Protocol

The resumable upload service (`backend/src/infrastructure/media/upload-service.js`) implements an offset-verified, streaming chunk protocol inspired by tus:

1. **Session Initiation (`POST /api/v1/media/uploads`)**:
   - Requires `media:upload`.
   - Purges expired sessions (`cleanupExpiredUploadSessions`), checks free disk headroom (`assertDiskHeadroom`, returning HTTP `507` when free disk falls below `MCR_MEDIA_MIN_FREE_DISK_MIB`), and atomically reserves `expectedSizeBytes` against the organization's storage quota (`MCR_MEDIA_ORG_QUOTA_MIB`) inside a SQLite `BEGIN IMMEDIATE` transaction.
   - Creates an empty `0600` `.part` staging file and returns the session ID, `chunkSizeBytes`, and `Upload-Expires`.
2. **Streaming Chunk Transfer (`PATCH /api/v1/media/uploads/:id`)**:
   - Requires `Content-Type: application/offset+octet-stream` (or `application/octet-stream`) and an integer `Upload-Offset` header.
   - Enforces per-session mutual exclusion and a process-wide concurrent upload stream limit (`MCR_MEDIA_MAX_CONCURRENT_UPLOADS`).
   - Compares `Upload-Offset` against the actual `.part` file byte size on disk. Mismatched or duplicate chunks return HTTP `409 Conflict` with the current `Upload-Offset` header so the client can resume accurately without corrupting the file.
   - Streams incoming request chunks directly to the `.part` file descriptor at the verified byte offset without buffering the full file in Node.js memory. Optional per-chunk `Upload-Checksum-Sha256` verification rolls back (`ftruncate`) any corrupted chunk transfer.
3. **Session Status and Recovery (`GET /api/v1/media/uploads/:id`)**:
   - Reconciles the database `receivedBytes` with the actual `.part` file size on disk, enabling seamless recovery after network drop, browser refresh, or backend process restart.
4. **Atomic Finalization (`POST /api/v1/media/uploads/:id/complete`)**:
   - Verifies that the `.part` file size equals `expectedSizeBytes`, computes the full-file SHA-256 digest in 1 MiB streaming reads, verifies it against `expectedChecksumSha256`, atomically renames the file into `media/<orgId>/<assetUuid>.bin`, creates the `media_assets` and `media_processing_jobs` records inside one transaction, and enqueues asynchronous FFprobe/FFmpeg validation.

---

## 3. Asynchronous Media Validation and Broadcast Compatibility

`backend/src/infrastructure/media/media-processor.js` runs a bounded background worker queue (`MCR_MEDIA_MAX_PROCESSING_JOBS`, default `2`) that automatically recovers unfinished jobs (`UPLOADED`, `VALIDATING`, `PROCESSING`) on server startup:

1. **Magic-Byte Signature Inspection (`sniffMagicSignature`)**:
   - Inspects the first 2,048 bytes to identify actual container signatures (`PNG`, `JPEG`, `WebP`, `RIFF/WAV`, `RIFF/AVI`, `ISO-BMFF MP4/MOV/M4A`, `EBML MKV/WebM`, `Ogg`, `FLAC`, `ID3/ADTS MP3/AAC`, `MPEG-TS 0x47 sync`).
   - Files with unrecognized or spoofed signatures (such as an executable renamed `.mp4`) are moved to `quarantine/<orgId>/<assetUuid>.bin` and marked `QUARANTINED` (`UNSUPPORTED`).
2. **FFprobe & FFmpeg Verification**:
   - Executes `ffprobe` and `ffmpeg` via `execFile` with fixed argument arrays (no shell interpolation), restricted environment variables, `-threads 1`, and bounded timeouts (`MCR_MEDIA_PROCESSING_TIMEOUT_MS`).
   - Extracts container format, duration, video/audio codecs, width, height, frame rate, bitrate, audio channels, and sample rate.
   - Runs a 1-second null-mux decode test (`ffmpeg -t 1 -i <file> -f null -`) to catch truncated or corrupted media streams (`FAILED`), and extracts a JPEG thumbnail for video and image assets.
3. **Broadcast Compatibility Classification**:
   - `DIRECT_PLAYBACK`: H.264 video + AAC (or silent) audio in MP4/MOV/MPEG-TS containers, MP3/AAC/M4A audio, or validated single-frame PNG/JPEG/WebP images.
   - `REMUX_REQUIRED`: H.264/AAC streams packaged in MKV or AVI containers that can be remuxed without video re-encoding.
   - `TRANSCODE_REQUIRED`: Validated VP8/VP9/AV1/HEVC/MPEG-2 video or WAV/FLAC/Ogg/Opus/Vorbis audio requiring transcoding or normalization before playout.
   - `UNSUPPORTED`: Failed or quarantined files.

---

## 4. Configurable Limits and Environment Variables

| Variable | Default | Range | Purpose |
| --- | --- | --- | --- |
| `MCR_MEDIA_STORAGE_ROOT` | `backend/storage/media-library` | Path | Root directory for `media`, `uploads`, `thumbnails`, `processing`, and `quarantine` |
| `MCR_MEDIA_IMPORT_DIR` | `<root>/imports` | Path | Authorized server-side directory for controlled local file imports |
| `MCR_MEDIA_MAX_FILE_SIZE_MIB` | `20480` (20 GiB) | `1`–`102400` | Maximum individual media file size |
| `MCR_MEDIA_ORG_QUOTA_MIB` | `512000` (500 GiB) | `1`–`2097152` | Per-organization persistent + reserved media storage quota |
| `MCR_MEDIA_MAX_DURATION_SECONDS` | `28800` (8 hours) | `1`–`259200` | Maximum allowed media duration |
| `MCR_MEDIA_MAX_CONCURRENT_UPLOADS` | `4` | `1`–`32` | Maximum concurrent active chunk upload streams |
| `MCR_MEDIA_MAX_PROCESSING_JOBS` | `2` | `1`–`16` | Maximum concurrent FFprobe/FFmpeg validation workers |
| `MCR_MEDIA_CHUNK_MAX_MIB` | `64` | `1`–`256` | Maximum size of a single resumable upload chunk |
| `MCR_MEDIA_UPLOAD_TTL_MINUTES` | `1440` (24 hours) | `5`–`10080` | Expiration lifetime for incomplete resumable upload sessions |
| `MCR_MEDIA_MIN_FREE_DISK_MIB` | `512` | `16`–`1048576` | Minimum free disk space required before accepting new uploads/imports (HTTP `507`) |
| `MCR_MEDIA_LOW_DISK_ALERT_MIB` | `2048` | `32`–`1048576` | Threshold below which `/api/v1/media/storage` emits `lowDiskAlert: true` |
| `MCR_MEDIA_PROCESSING_TIMEOUT_MS` | `120000` | `5000`–`3600000` | Subprocess timeout budget for FFprobe/FFmpeg validation |

---

## 5. Linux Ubuntu LTS, Docker Compose, and Reverse Proxy Requirements

1. **Dedicated Persistent Volume**:
   - Mount an independent host filesystem (500 GB–1 TB XFS or ext4 volume, e.g., `/srv/pallcom-mcr`) into the API/worker container outside the container image layer so application updates and container recreations never overwrite or delete media.
   - Set directory ownership to the non-root container runtime identity (`UID 1000:GID 1000`) with mode `0700` on directories and `0600` on files.
2. **Nginx Reverse Proxy Upload Configuration**:
   - Route `/api/v1/media/uploads` with `client_max_body_size 128m;` (matching the 64 MiB chunk ceiling), `proxy_request_buffering off;`, `proxy_read_timeout 300s;`, and `proxy_send_timeout 300s;` so chunk streams pass directly to the Node.js chunk writer without double buffering on the gateway disk.
3. **Database & MySQL Roadmap Evaluation**:
   - All Phase Three metadata (`media_assets`, `media_upload_sessions`, `media_processing_jobs`, `media_playlists`) is accessed exclusively through the async `IMediaRepository` contract (`RepositoryFactory.getMediaRepository()`) with matching MySQL models in `backend/database/prisma/schema.prisma` (`MediaAsset`, `MediaUploadSession`, `MediaProcessingJob`, `MediaPlaylist`) and zero media BLOB columns.
   - Existing short-clip SQLite BLOB tables (`ad_assets`, `ad_frames`, `ad_asset_audio`) remain intact for backward compatibility with Phase 1–2 receiver fixtures until Phase 15 migrates runtime persistence to MySQL.
   - **Recommendation**: Pulling the Phase 15 MySQL persistence foundation ahead of Phases 04–08 (as proposed in `DEVELOPMENT_PLAN.md`) is recommended so new source catalogs, multi-track timelines, and channel leases write directly to InnoDB rather than adding dual SQLite/MySQL adapters.
4. **Backup and Rollback**:
   - Back up the SQLite/MySQL metadata database together with `<MCR_MEDIA_STORAGE_ROOT>/media` and `<MCR_MEDIA_STORAGE_ROOT>/thumbnails`, verifying SHA-256 checksums against `media_assets.checksumSha256`.
   - To roll back Phase Three, revert the `/api/v1/media` router mount, `MediaLibraryPage.jsx`, and the `IMediaRepository` wiring; the additive tables and external storage directory can remain untouched on disk without affecting legacy routes.
