import { setTimeout as wait } from "node:timers/promises";
import type { QBittorrent } from "@ctrl/qbittorrent";
import {
	TorrentError,
	type TorrentManifest,
	type TorrentSource,
} from "../public.js";

const uploadName = "metadata.torrent";

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TorrentError("invalid-response", "read");
	return value as Record<string, unknown>;
}

export async function inspectQbittorrentMetadata(
	sdk: QBittorrent,
	input: { source: TorrentSource; expectedHash: string },
	signal: AbortSignal,
): Promise<TorrentManifest> {
	let response: Record<string, unknown>;
	if ("torrent" in input.source) {
		const parsed = await sdk.parseTorrentMetadata(
			input.source.torrent,
			uploadName,
		);
		if (parsed.length !== 1) throw new TorrentError("invalid-response", "read");
		const item = record(parsed[0]);
		// Older API versions keyed the result by the uploaded filename.
		response = Object.hasOwn(item, uploadName)
			? record(item[uploadName])
			: item;
	} else {
		const magnet = input.source.magnet;
		while (true) {
			signal.throwIfAborted();
			response = record(await sdk.fetchTorrentMetadata(magnet));
			if (response.infohash_v1 !== input.expectedHash)
				throw new TorrentError("invalid-response", "read");
			if (Object.hasOwn(response, "info")) break;
			await wait(350, undefined, { signal });
		}
	}
	signal.throwIfAborted();
	const info = record(response.info);
	if (
		response.infohash_v1 !== input.expectedHash ||
		!Array.isArray(info.files) ||
		info.files.length < 1 ||
		info.files.length > 4096
	)
		throw new TorrentError("invalid-response", "read");
	let size = 0;
	const files = info.files.map((value, index) => {
		const { path, length } = record(value);
		if (
			typeof path !== "string" ||
			typeof length !== "number" ||
			!Number.isSafeInteger(length) ||
			length < 0
		)
			throw new TorrentError("invalid-response", "read");
		size += length;
		return { index, path, sizeBytes: length };
	});
	if (!Number.isSafeInteger(size) || info.length !== size)
		throw new TorrentError("invalid-response", "read");
	return { hash: input.expectedHash, indexSource: "client", files };
}
