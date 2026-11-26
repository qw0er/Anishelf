# Using Anishelf

| Task | Guide |
| --- | --- |
| Deploy, maintain, update or uninstall | [Deployment](deployment.md) |
| Configure paths, preparation, logs and startup options | [Configuration](operations.md) |
| Connect Jackett and order sites | [Jackett setup](jackett-setup.md) |
| Subscribe, enable Watching or recover downloads | [Subscriptions and Watching](watching-automation.md) |
| Set release preferences | [Acquisition profiles](acquisition-profiles.md) |
| Customize preparation output | [Transcode profiles](transcode-profiles.md) |
| Play files and select subtitles | [Playback](#playback) |
| Configure Web URL templates and desktop command players | [External players](external-players.md) |

## First use

| Step | Action |
| --- | --- |
| 1. Sign in | Read the initial password from Backend logs |
| 2. Add media | Configure Settings resource roots; containers initially use `/data/media` |
| 3. Review Library | Browse posters/files and resolve uncertain matches in Review |
| 4. Connect a tracking account (optional) | Choose the default metadata source in Library settings. In Account settings, paste its access token and connect. Confirm when switching accounts. |
| 5. Add downloads | Configure Sources, qBittorrent and a validated destination; Subscribe on a work |
| 6. Follow progress | Use Activity/Diagnostics; manage transfers in qBittorrent WebUI |

You can browse local library works without a tracking account. Connecting an account
adds its collection and viewing-status filters. Watching creation is optional and off
by default. Viewing progress and download
state are independent. See [Development](../development/README.md) for contributor
work, [Requirements](../requirements.md) for scope and [History](../history.md) for
completed iterations.

## Playback

Anishelf uses libmedia-react-player on Web and desktop. It includes a
WebAssembly SIMD software decoding fallback for codecs such as H.264, HEVC
and AV1. Playback depends on the file's container and codec profile, the
browser or desktop runtime, and the device.

Use the player settings to select an audio track, select a subtitle track or
adjust subtitle timing. Open the time display when it shows a chevron to jump
to a chapter. The player can render styled ASS/SSA with fonts attached to the
selected Matroska file and embedded PGS, VobSub and DVB bitmap subtitles.
Matching SRT, WebVTT, ASS and SSA sidecars are also available. If styled
rendering fails, playback continues with basic subtitles for that track.

Playback starts with the original file by default. Use **Playback options** to
select an existing prepared copy, or [prepare a compatible copy](manual-preparation.md)
manually. You can also [open the original in an external player](external-players.md).
In the desktop app, **Download video** saves the original and shows progress in
the playback menu. You can also cache episodes or videos for offline playback;
see the [desktop guide](../../apps/desktop/README.md).

## Bangumi viewing progress

Set Bangumi as the default metadata source in Library settings, then create a
[personal access token](https://next.bgm.tv/demo/access-token) and connect it in
Account settings. The existing account stays active until a replacement is confirmed
or the account is disconnected.

Use Bangumi work associations for playback updates. Automatic tracking advances
to the next main episode when the watched episodes form a continuous sequence.
A confirmed manual progress edit sets the main-episode range and clears watched
marks beyond it. Special episodes keep their existing marks.
