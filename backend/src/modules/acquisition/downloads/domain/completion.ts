import type { TorrentTask } from "../../torrent-clients/public.js";

export function isTorrentComplete(task: TorrentTask): boolean {
	return (
		task.progress === 1 &&
		task.remainingBytes === 0 &&
		[
			"downloading",
			"seeding",
			"completed",
			"paused",
			"queued",
			"stalled",
		].includes(task.state)
	);
}
