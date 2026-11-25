import type {
	TorrentFile,
	TorrentManifest,
} from "../../torrent-clients/public.js";
import type { DownloadFileObservation } from "./model.js";

export function sameManifest(left: TorrentManifest, right: TorrentManifest) {
	return (
		left.hash === right.hash &&
		left.v2Hash === right.v2Hash &&
		left.indexSource === right.indexSource &&
		left.files.length === right.files.length &&
		left.files.every((file, i) => {
			const other = right.files[i];
			return (
				file.index === other?.index &&
				file.path === other.path &&
				file.sizeBytes === other.sizeBytes
			);
		})
	);
}

/** File paths and sizes make client indices meaningful across an add and readback. */
export function observeFileSelection(
	manifest: TorrentManifest,
	files: readonly TorrentFile[],
): DownloadFileObservation[] | null {
	const byIndex = new Map(files.map((file) => [file.index, file]));
	if (byIndex.size !== files.length || files.length !== manifest.files.length)
		return null;
	const observed: DownloadFileObservation[] = [];
	for (const expected of manifest.files) {
		const actual = byIndex.get(expected.index);
		const priority = actual?.priority;
		if (
			!actual ||
			actual.path !== expected.path ||
			actual.sizeBytes !== expected.sizeBytes ||
			typeof priority !== "number" ||
			!Number.isSafeInteger(priority) ||
			priority < 0 ||
			actual.selected !== priority > 0
		)
			return null;
		observed.push({ ...expected, priority, selected: actual.selected });
	}
	return observed;
}
