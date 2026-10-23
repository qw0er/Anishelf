# Using and Operating Anishelf

This section is for people installing, configuring and using Anishelf. It explains
product actions and operational recovery; implementation contracts and contributor
tests live in [Development](../development/README.md).

| Task | Guide |
| --- | --- |
| Install containers, set up HTTPS or manage services | [Deployment](deployment.md) |
| Configure environment variables, media directories, logs or backups | [Configuration and operations](operations.md) |
| Connect Jackett and select ordered sites | [Jackett setup](jackett-setup.md) |
| Subscribe manually, enable Watching creation or recover acquisition | [Watching and subscriptions](watching-automation.md) |
| Configure release preferences | [Acquisition profiles](acquisition-profiles.md) |
| Customize preparation profiles | [Commented transcode example](../examples/transcode-profiles-example.yaml) |

Start by installing Anishelf, signing in and configuring resource directories. For
automatic acquisition, configure Sources, the downloader/destination and defaults
before opting into Watching creation. Manual and automatically created subscriptions
share their editor and actions on work details. Activity shows progress and recovery;
Diagnostics explains source attempts. Existing local resources remain the playback
source and viewing state is separate from download state.

## First use

1. Sign in with the initial password from Backend logs. Container deployments use
   `/data/media` as the initial resource root; configure additional paths in Settings.
2. Browse Library or Files and resolve uncertain matches in Review.
3. Connect AniList in Settings → AniList account: authorize, paste the token, preview
   and confirm. Viewing progress is separate from local resource availability.
4. For downloads, configure Sources, qBittorrent, a validated destination and defaults.
   Subscribe on a work or opt into Watching creation. No resource-search preview is
   required before saving an ordinary subscription.
5. Use the work's Activity and Diagnostics for progress and recovery. Transfer controls
   stay in qBittorrent WebUI; [the deployment guide](deployment.md#bundled-qbittorrent)
   explains bundled credentials and external downloader setup.

[Requirements](../requirements.md) records delivered and future product scope.
[History](../history.md) retains completed iteration records and their verification.
Configuration examples stay in [examples](../examples/) because both guides and
repository tests use them.
