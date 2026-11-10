# Manual preparation

Play the original file with AVPlayer, or explicitly choose a completed copy from
playback options. Playback never starts a preparation job or chooses a copy from a
browser compatibility prediction.

Choose **Pre-transcode** in a file's actions or playback options. Select the
preparation profile in Settings. Select which audio tracks to retain when offered;
all source audio tracks are retained by default. Tasks can be monitored, cancelled,
retried and completed copies deleted from the prepared-media page.

The default **Matroska** profile creates H.264/AAC MKV while retaining embedded
subtitles, font attachments and chapters. Existing profiles keep their IDs/settings.
Custom containers that cannot satisfy the preservation policy are rejected before
work starts; choose Matroska rather than losing subtitles silently.

[Transcode profiles](transcode-profiles.md) describe video/audio encoding. Matching
streams may be copied according to profile rules and container constraints, without
browser capability checks. FFmpeg encoders and filters must exist on the server.

Existing copies survive profile changes/removal. Older copies created without
embedded subtitles remain unchanged; use the original or explicitly prepare a new
copy to include those tracks. Sidecar subtitles continue to refer to the source
file and its timeline. Automatic preparation settings and presets are retired.

Updating does not restart interrupted commands. Retry manually after checking
source access, available space and tool/configuration errors. Missing source files
invalidate their copies; temporary root unavailability defers cleanup.
