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

Not implemented: native notifications,
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
- **Power events.** The desktop app pauses built-in playback and saves the
  position on `suspend` and on `lock-screen` (macOS and Windows). On `resume`,
  it checks the backend session, retries pending progress saves, and refreshes
  subscription and download state. Playback remains paused after wake.

### 2. Native notifications

Give each category a switch in Settings → Desktop. For each enabled event,
show an in-app toast while the window has focus. When the window is hidden,
minimized or unfocused, use Electron `Notification`. Clicking a notification
should bring the relevant window or folder to the foreground.

| Priority | When to notify | Where a click leads |
| --- | --- | --- |
| First release | A subscribed episode has successfully entered the library. Include the work title and episode number. Group a season pack into one message with the number of imported episodes. | The episode, or the work page for a group. |
| First release | An import needs a match confirmed or has exhausted its automatic retries. Group related items that need attention. | The review item, failed task or list of affected items. |
| First release | An offline cache entry is ready to play or has failed. | The offline episode, or the cache entry with its retry action. |
| Optional | A video saved from the player has finished downloading to this computer. | The saved file in its folder. |
| Optional | A background update check finds a release with a package for this installation. Notify once per version. | The release details. |

#### Delivery from a bundled or remote backend

The current download activity endpoint requires a work key, and the activity
panel polls while mounted. For subscription imports and items needing review,
add one authenticated endpoint that returns events across works in ascending ID
order after a supplied cursor.

1. When an import enters a state listed above, persist the event in the same
   database transaction as the state change. Give it a monotonically increasing
   ID, its type, and the work, episode, task or review identifiers needed to open
   the destination.
2. While signed in, have the Electron main process poll every 30 seconds using
   the existing device session. Polling continues in the tray and works through
   the same outbound connection for bundled and remote servers, including a NAS
   or VPS. It requires no inbound port on the user's computer.
3. Store the last processed event ID per device and server. On first connection,
   start at the server's latest ID. On reconnect, wake or restart, fetch subsequent
   events and advance the cursor as they are processed. Group accumulated episodes
   by work and skip review items that have already been resolved.

While the desktop app is fully quit, a running remote backend continues recording
events. The desktop app summarizes them on its next launch. Immediate delivery
during that interval would require a separate push channel.

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

### 4. System appearance and behaviour

- Follow system theme changes live through `nativeTheme.on('updated')` or a
  `matchMedia` change listener.

## Suggested first step

Implement native notifications and the extended tray menu next.
Start with offline cache events to verify tray delivery and click navigation.
Then add the backend event feed for subscription imports and review items. Deep links
support notification navigation and opening the desktop app from Web, so they
fit a second stage.

Log every integration point, including registration failures and unsupported
platforms, so that support for each desktop environment can be diagnosed.
