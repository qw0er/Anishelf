import parseTorrent from "parse-torrent";
import { isWindowsPathPart } from "../../../../platform/paths.js";
import type { ReleaseEvidence } from "../../sources/public.js";
import { downloadDefaults } from "../defaults.js";
import { DownloadError } from "../domain/model.js";
import {
	isDownloadPathPart,
	maximumDownloadFilePathLength,
} from "../domain/paths.js";
import type { TorrentReader } from "../ports.js";

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
		if (
			text.length > maximumDownloadFilePathLength ||
			!isDownloadPathPart(text) ||
			(process.platform === "win32" && !isWindowsPathPart(text))
		)
			throw new DownloadError("invalid_file_path");
		return text.length;
	};
	const nameLength = component(data["name.utf-8"] ?? data.name);
	if (Array.isArray(data.files))
		for (const value of data.files) {
			if (!value || typeof value !== "object")
				throw new DownloadError("invalid_file_path");
			const file = value as Record<string, unknown>,
				path = file["path.utf-8"] ?? file.path;
			if (!Array.isArray(path) || !path.length)
				throw new DownloadError("invalid_file_path");
			let length = nameLength;
			for (const part of path) {
				length += 1 + component(part);
				if (length > maximumDownloadFilePathLength)
					throw new DownloadError("invalid_file_path");
			}
		}
	// Hybrid metadata must not hide unsafe v2 path components behind valid v1 paths.
	let count = 0;
	const tree = (node: unknown, depth: number, parentLength: number) => {
		if (++count > 10000 || depth > 64 || !node || typeof node !== "object")
			throw new DownloadError("invalid_file_path");
		for (const [name, child] of Object.entries(node))
			if (name) {
				const length = parentLength + 1 + component(name);
				if (length > maximumDownloadFilePathLength)
					throw new DownloadError("invalid_file_path");
				tree(child, depth + 1, length);
			}
	};
	if (data["file tree"]) tree(data["file tree"], 0, nameLength);
}
export async function resolveTorrent(
	entry: Pick<ReleaseEvidence, "download" | "hash">,
	transport: TorrentReader,
	signal: AbortSignal,
) {
	if (!entry.download) throw new DownloadError("missing_download");
	try {
		const content = await transport.read(entry.download, signal);
		const bytes = content.kind === "bytes" ? content.bytes : null;
		const magnet = content.kind === "magnet" ? content.uri : null;
		if (bytes && bytes.byteLength > downloadDefaults.maximumTorrentBytes)
			throw new DownloadError("torrent_too_large");
		const parsed = await parseTorrent(bytes ?? magnet ?? "");
		if (!/^[a-f0-9]{40}$/.test(parsed.infoHash))
			throw new DownloadError("unsupported_torrent");
		if (entry.hash && parsed.infoHash !== entry.hash.toLowerCase())
			throw new DownloadError("torrent_identity_conflict");
		if (bytes) rawPaths(parsed.info);
		return {
			hash: parsed.infoHash,
			source: bytes
				? { torrent: new Uint8Array(bytes) }
				: { magnet: magnet ?? "" },
		};
	} catch (error) {
		if (error instanceof DownloadError) throw error;
		throw new DownloadError("torrent_unavailable");
	}
}
