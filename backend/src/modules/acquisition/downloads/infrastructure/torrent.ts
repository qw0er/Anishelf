import parseTorrent from "parse-torrent";
import type { FeedEntry } from "../../discovery/public.js";
import { DownloadError } from "../domain/model.js";
import { relativeDownloadPath } from "../domain/paths.js";
import { downloadPolicy } from "../policy.js";
import type { TorrentTransport } from "../ports.js";

function rawPaths(info: unknown) {
	if (!info || typeof info !== "object")
		throw new DownloadError("unsupported_torrent");
	const data = info as Record<string, unknown>;
	const component = (value: unknown) => {
		const text =
			value instanceof Uint8Array
				? new TextDecoder("utf-8", { fatal: true }).decode(value)
				: typeof value === "string"
					? value
					: "";
		relativeDownloadPath(text);
		if (text.includes("/")) throw new DownloadError("invalid_file_path");
	};
	component(data["name.utf-8"] ?? data.name);
	if (Array.isArray(data.files))
		for (const value of data.files) {
			if (!value || typeof value !== "object")
				throw new DownloadError("invalid_file_path");
			const file = value as Record<string, unknown>,
				path = file["path.utf-8"] ?? file.path;
			if (!Array.isArray(path) || !path.length)
				throw new DownloadError("invalid_file_path");
			path.forEach(component);
		}
	// Hybrid metadata must not hide unsafe v2 path components behind valid v1 paths.
	let count = 0;
	const tree = (node: unknown, depth: number) => {
		if (++count > 10000 || depth > 64 || !node || typeof node !== "object")
			throw new DownloadError("invalid_file_path");
		for (const [name, child] of Object.entries(node))
			if (name) {
				component(name);
				tree(child, depth + 1);
			}
	};
	if (data["file tree"]) tree(data["file tree"], 0);
}
export async function resolveTorrent(
	entry: Pick<FeedEntry, "downloadUrl" | "hash">,
	transport: TorrentTransport,
	signal: AbortSignal,
) {
	if (!entry.downloadUrl) throw new DownloadError("missing_download");
	try {
		const magnet = entry.downloadUrl.startsWith("magnet:?");
		const bytes = magnet
			? null
			: await transport.read(entry.downloadUrl, signal);
		if (bytes && bytes.byteLength > downloadPolicy.maximumTorrentBytes)
			throw new DownloadError("torrent_too_large");
		const parsed = await parseTorrent(bytes ?? entry.downloadUrl);
		if (!/^[a-f0-9]{40}$/.test(parsed.infoHash))
			throw new DownloadError("unsupported_torrent");
		if (entry.hash && parsed.infoHash !== entry.hash.toLowerCase())
			throw new DownloadError("torrent_identity_conflict");
		if (bytes) rawPaths(parsed.info);
		for (const file of parsed.files ?? []) relativeDownloadPath(file.path);
		return {
			hash: parsed.infoHash,
			source: bytes
				? { torrent: new Uint8Array(bytes) }
				: { magnet: entry.downloadUrl },
		};
	} catch (error) {
		if (error instanceof DownloadError) throw error;
		throw new DownloadError("torrent_unavailable");
	}
}
