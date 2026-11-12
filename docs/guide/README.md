# Using Anishelf

| Task | Guide |
| --- | --- |
| Deploy, maintain, update or uninstall | [Deployment](deployment.md) |
| Configure paths, preparation, logs and startup options | [Configuration](operations.md) |
| Connect Jackett and order sites | [Jackett setup](jackett-setup.md) |
| Subscribe, enable Watching or recover downloads | [Subscriptions and Watching](watching-automation.md) |
| Set release preferences | [Acquisition profiles](acquisition-profiles.md) |
| Customize preparation output | [Transcode profiles](transcode-profiles.md) |
| Configure external players and custom URL handlers | [External players](external-players.md) |

## First use

| Step | Action |
| --- | --- |
| 1. Sign in | Read the initial password from Backend logs |
| 2. Add media | Configure Settings resource roots; containers initially use `/data/media` |
| 3. Review Library | Browse posters/files and resolve uncertain matches in Review |
| 4. Connect a tracking account | Choose the default metadata source in Library settings. In Account settings, paste its access token and connect. Confirm when switching accounts. |
| 5. Add downloads | Configure Sources, qBittorrent and a validated destination; Subscribe on a work |
| 6. Follow progress | Use Activity/Diagnostics; manage transfers in qBittorrent WebUI |

Watching creation is optional and off by default. Viewing progress and download
state are independent. See [Development](../development/README.md) for contributor
work, [Requirements](../requirements.md) for scope and [History](../history.md) for
completed iterations.

## Bangumi viewing progress

Set Bangumi as the default metadata source in Library settings, then create a
[personal access token](https://next.bgm.tv/demo/access-token) and connect it in
Account settings. The existing account stays active until a replacement is confirmed
or the account is disconnected.

Use Bangumi work associations for playback updates. Automatic tracking advances
to the next main episode when the watched episodes form a continuous sequence.
A confirmed manual progress edit sets the main-episode range and clears watched
marks beyond it. Special episodes keep their existing marks.
