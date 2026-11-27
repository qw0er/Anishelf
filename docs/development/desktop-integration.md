# Desktop integration roadmap

This document records the current state of operating system integration in the
desktop app and proposes directions for improving it. Items are proposals, not
commitments. Add accepted items to [Requirements](../requirements.md) before
implementation, and follow the [UI design docs](design-system.md) for any new
settings.

## Current state

| Area | Status | Location |
| --- | --- | --- |
| Tray | Optional close to tray. Menu has **Open Anishelf** and **Quit Anishelf** only. | `apps/desktop/src/main/native/tray.ts` |
| Launch at login | Login item on Windows and macOS, XDG autostart entry on Linux. | `apps/desktop/src/main/native/login-item.ts` |
| Single instance | `second-instance` shows the window. Its argv is ignored. | `apps/desktop/src/main/index.ts` |
| macOS menu | About, Check for Updates…, Settings, Go shortcuts, Window, Help. | `apps/desktop/src/main/native/menu.ts` |
| Update check | Queries GitHub `releases/latest` and links to the matching package. No download or install. | `apps/desktop/src/main/native/updates.ts` |
| Downloads | Progress in the playback menu, **Show in folder** from an in-app toast. | `apps/desktop/src/main/native/download.ts` |
| Theme | `prefers-color-scheme` is read once at startup. No live updates, no accent colour. | `apps/desktop/src/renderer/main.tsx` |
| Language | Follows `app.getLocale()` unless the user stores a language. The tray and menu follow the in-app language. | `apps/desktop/src/main` |
| Media session | Sets `navigator.mediaSession` metadata (work title, episode, poster), playback/position state and play, pause, seek, previous and next handlers. Runtime verification on each desktop backend remains pending. | `packages/client-ui/src/features/playback/media-session.ts` |

Not implemented: native notifications, `powerMonitor`,
taskbar progress, badge counts, Windows thumbnail toolbar and jump lists, macOS
dock menu, a custom URL protocol, file associations, drag and drop,
picture-in-picture or mini player, live theme following, and automatic update
installation.

## Proposed directions

The groups are in suggested priority order.

### 1. Playback and system media controls

- **Media session.** Implemented in
  `packages/client-ui/src/features/playback/media-session.ts` to set
  `navigator.mediaSession` metadata (work title, episode, poster), playback and
  position state, and handle play, pause, previous track, next track, seek
  backward, seek forward and seek to. Electron maps these to MPRIS on Linux,
  System Media Transport Controls on Windows and Now Playing on macOS, and
  media keys work through them. Because libmedia-react-player renders through
  WASM, WebGL and WebAudio, confirm runtime behaviour across Linux, Windows and
  macOS.
- **Prevent sleep during playback.** Implemented for built-in online and
  offline playback with Electron's `powerSaveBlocker`. The app releases the
  blocker when playback stops, the player is left or the window closes.
  Closing to the tray releases it until the window reopens.
- **Power events.** Use `powerMonitor` `suspend` and `lock-screen` to pause
  playback and save progress. On `resume`, reconnect to the backend and refresh
  subscription and download state.
- **Mini player.** Add an optional compact, always-on-top window
  (`setAlwaysOnTop`) for watching alongside other work.

### 2. Native notifications

- Use Electron `Notification` for these events: new episodes for a
  subscription, download completed or imported, matches that need review,
  offline cache completed, and update available.
- When the user clicks a notification, open the related page.
- Show native notifications only while the window is hidden or unfocused. Keep
  in-app toasts while the window is focused.
- Give each notification category its own switch in Settings → Desktop.

### 3. Taskbar, dock and tray

- **Progress.** Show download and offline cache progress with
  `BrowserWindow.setProgressBar`.
- **Badge.** Show the number of items needing review or new episodes with
  `app.setBadgeCount` (supported on macOS and some Linux desktops).
- **Tray menu.** Add Continue watching (the three most recent works), Today's
  episodes, Pause or resume downloads, Scan library and Open offline cache.
- **Windows.** Add play, pause, previous and next to the thumbnail toolbar with
  `setThumbarButtons`. Add recently watched works with `setUserTasks` or
  `setJumpList`.
- **macOS.** Add a dock menu with `app.dock.setMenu`.
- **Linux.** Add desktop entry `Actions`, such as Continue watching and Open
  offline cache.

### 4. Deep links and file handling

- **`anishelf://` protocol.** Register it with `app.setAsDefaultProtocolClient`
  and support routes such as `anishelf://work/<id>` and
  `anishelf://play/<id>`. Handle `open-url` on macOS and parse the argv of
  `second-instance` on Windows and Linux. With deep links, the browser, the Web
  client, notifications and scripts can open the desktop app on a specific
  page. Validate every route before navigating.
- **Drag and drop.** Dropping a folder adds it as a resource directory when the
  app uses the bundled backend. Dropping a video file plays or identifies it.
- **File associations (optional).** Configure electron-builder
  `fileAssociations` so users can choose Anishelf as a local video player.

### 5. System appearance and behaviour

- Follow system theme changes live through `nativeTheme.on('updated')` or a
  `matchMedia` change listener. Consider using the system accent colour.
- Consider `electron-updater` for automatic updates. Unsigned Windows and macOS
  builds limit the experience, and AppImage support is the strongest. A smaller
  first step is a background update check that sends a native notification.
- Use `shell.openPath` to open local files with the default application.

## Suggested first step

Implement native notifications and the extended tray menu next.
The changes are mostly in the main process
and the player adapter, carry low risk and give visible results. Deep links
support notification navigation and opening the desktop app from Web, so they
fit a second stage.

Log every integration point, including registration failures and unsupported
platforms, so that support for each desktop environment can be diagnosed.
