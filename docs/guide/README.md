# Using Anishelf

| Task | Guide |
| --- | --- |
| Deploy, maintain, update or uninstall | [Deployment](deployment.md) |
| Configure paths, preparation, logs and startup options | [Configuration](operations.md) |
| Connect Jackett and order sites | [Jackett setup](jackett-setup.md) |
| Subscribe, enable Watching or recover downloads | [Subscriptions and Watching](watching-automation.md) |
| Set release preferences | [Acquisition profiles](acquisition-profiles.md) |
| Customize preparation output | [Transcode YAML example](../examples/transcode-profiles-example.yaml) |

## First use

| Step | Action |
| --- | --- |
| 1. Sign in | Read the initial password from Backend logs |
| 2. Add media | Configure Settings resource roots; containers initially use `/data/media` |
| 3. Review Library | Browse posters/files and resolve uncertain matches in Review |
| 4. Connect AniList | In Settings, authorize, paste the token, preview and confirm |
| 5. Add downloads | Configure Sources, qBittorrent and a validated destination; Subscribe on a work |
| 6. Follow progress | Use Activity/Diagnostics; manage transfers in qBittorrent WebUI |

Watching creation is optional and off by default. Viewing progress and download
state are independent. See [Development](../development/README.md) for contributor
work, [Requirements](../requirements.md) for scope and [History](../history.md) for
completed iterations.
