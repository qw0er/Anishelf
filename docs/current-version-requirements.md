# Anishelf Current Version Requirements

**Current version: V1.**

Architecture and implementation decisions are described in [Current Version — Overall Design](current-version-design.md).

This document defines the active release scope. Deferred capabilities are maintained in [Future Requirements](future-requirements.md). Together, these two documents form the requirements set; when planning a new version, move selected requirements here and update the version label.

## 1. Goal

Allow the user to browse existing animation files on the server through a Web interface and select a file to play.

Core workflow: **configure an existing resource directory → scan manually → browse directories and files → play in the browser**.

This release validates resource access and playback. It does not require online anime metadata, episode mapping, tracking records, or a download workflow. The user supplies the existing files.

## 2. Operating Scope

- Personal use, one server, and one resource root with nested directories.
- Read-only access to original media: no uploading, moving, renaming, or deleting files.
- Acceptance testing covers local use and one explicitly selected desktop browser. Listen on localhost by default; LAN access and authentication are later extensions.
- Validate one active playback session; client coordination is outside this release.
- Configure the resource directory through a simple UI form. A missing persistent settings file must allow startup; the application generates it on the first successful save. A multi-step setup wizard is not required.
- Use English for application UI, messages, and metadata. Localization is deferred to O14 in the future requirements. Preserve original resource filenames.

## 3. Minimum Feature List

| ID | Feature | Current requirement |
| --- | --- | --- |
| V01 | Resource directory configuration | Configure and persist one server-accessible root through the UI; allow startup before setup; check existence and readability on startup or scan and expose errors |
| V02 | Manual scanning | Recursively discover agreed video file types; repeated scans do not duplicate paths; rescanning reflects additions and removals |
| V03 | Resource browsing | Show the actual directory hierarchy and original filenames with stable natural sorting; support parent-directory navigation |
| V04 | Web playback | Open a selected file in the player and serve its media from the server without requiring a full download before playback |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory |
| V06 | Failure feedback | Distinguish missing files, unreadable files, and unsupported media or playback failures; provide understandable feedback |

Directories are the organizational unit and files are the playback unit. Anime identification, manual title linking, episode parsing, posters, and detail pages are unnecessary. Natural sorting helps users select files whose names contain episode numbers.

## 4. Playback Compatibility Boundary

Version 1 starts with browser direct playback. **Server-side transcoding and remuxing are not required for this release.**

Manual on-demand preparation of reusable Web-compatible copies is assigned to a later release; see [On-demand Web Preparation](future-requirements.md#on-demand-web-preparation-p05p07).

- Select the target browser and version before implementation, then collect representative files from the user's existing library.
- MP4 with H.264 video and AAC audio is the initial validation candidate. Actual browser and file testing determines support; an extension alone does not guarantee playback.
- Document the file types included in scanning. Discovery does not imply that the browser supports the contained codecs.
- Subtitle discovery, loading, rendering, selection, and controls are outside this release, including external WebVTT. Subtitles already burned into the video image require no separate support. Audio-track selection is also deferred.
- If files such as MKV or HEVC media cannot play directly in the target browser, display an unsupported-media message. Do not automatically convert them or launch an external player.

**Scope validation prerequisite:** check whether representative files from the user's actual library can play directly. If the primary library requires conversion, this minimum release validates infrastructure but does not yet satisfy everyday viewing needs. In that case, explicitly revise the scope to add only the compatibility path required by those samples, rather than expanding into general format support.

## 5. Minimum Interface

Only two screens are required:

1. **Resource browser:** current directory, subdirectories and files, scan action, scan status, and errors.
2. **Player:** filename, video player, back action, and playback errors.

A dashboard, anime detail page, task center, tracking page, and integration settings are outside this release.

## 6. Explicit Exclusions

- Online metadata search, cover fetching, anime recognition, and episode mapping.
- Persistent playback progress, resume playback, watched markers, a continue-watching list, and automatic next-episode playback.
- Tracking status, subscriptions, RSS, resource search, download clients, and automatic ingestion.
- A dedicated Web action to download existing library files to the user's device; media delivery for playback remains included.
- AniList accounts or other external synchronization.
- Desktop player bridges, remote control, cross-client handoff, and native apps.
- Server-side transcoding, remuxing, all subtitle support, audio-track selection, and universal format support.
- Multiple users, multiple libraries, public access, file management, and automatic filesystem monitoring.

These belong to [Future Requirements](future-requirements.md) and must not become hidden Version 1 dependencies.

## 7. Acceptance Criteria

| ID | Scenario | Passing result |
| --- | --- | --- |
| A01 | Configure and scan a directory containing nested folders and video files | The Web interface shows the hierarchy and allows navigation |
| A02 | Repeat a scan, then add or remove a file and rescan | No duplicate entries; the listing reflects the changes |
| A03 | Select a validated supported sample | Playback starts in the target browser with working audio and video before the entire file is downloaded |
| A04 | Pause, resume, seek to an unplayed position, adjust volume, and enter fullscreen | Controls work and playback resumes from the requested position |
| A05 | Use an unreadable directory, remove a file after scanning, or open unplayable media | An appropriate error appears; the interface remains usable and allows returning to the listing |
| A06 | Exit the player | The original directory is restored and another file can be selected |
| A07 | Use paths containing Chinese characters and spaces, then attempt to access a file outside the configured root | Valid resources play; outside-root access is rejected, including escapes through symbolic links |

Record the browser version and media codecs for the acceptance samples. Passing these scenarios completes Version 1 without waiting for future features.

## 8. Essential Quality Requirements

- Scanning and playback never modify original media.
- Media access is restricted to the configured root; endpoints cannot read arbitrary system paths.
- Scanning exposes running and completion states; an error does not make the resource browser unusable.
- Media delivery supports the partial reads required for seeking and does not load an entire video into server memory.
- Persist the resource-directory configuration. The file index may be rebuilt on startup; a comprehensive database model for future features is unnecessary.

Language, framework, and database choices are not prescribed by this document.
