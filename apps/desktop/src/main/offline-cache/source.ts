import { extname } from "node:path";
import { subtitleConstraints } from "@anishelf/contracts/defaults";
import type {
	CatalogSourceResponse,
	FileResponse,
	MediaAccessLinkResponse,
	SubtitleDiscoveryResponse,
} from "@anishelf/contracts/http";
import {
	matchesOriginalMediaLink,
	originalMediaPath,
} from "@anishelf/contracts/media";
import type { OfflineCacheFailure } from "@anishelf/contracts/offline-cache";
import { subtitleFormats } from "@anishelf/contracts/subtitles";

export interface CacheServer {
	key: string;
	origin: string;
	authorization(): string | undefined;
}

export class CacheError extends Error {
	constructor(readonly reason: OfflineCacheFailure) {
		super(reason);
	}
}

export function cacheFailure(error: unknown): OfflineCacheFailure {
	if (error instanceof CacheError) return error.reason;
	if (error instanceof Error && error.name === "TimeoutError")
		return "unreachable";
	if (error instanceof Error && "code" in error) {
		if (
			error.code === "ENOSPC" ||
			error.code === "EDQUOT" ||
			String(error.code).includes("SQLITE_FULL")
		)
			return "space";
		return "storage";
	}
	return "download";
}

export function createCacheSource(
	server: CacheServer,
	fileId: string,
	lifetime: AbortSignal,
	fetch: (url: string, init: RequestInit) => Promise<Response>,
) {
	const filePath = `/api/files/${encodeURIComponent(fileId)}`;

	async function request(path: string, method: "GET" | "POST" = "GET") {
		const authorization = server.authorization();
		if (!authorization) throw new CacheError("authentication");
		const signal = AbortSignal.any([lifetime, AbortSignal.timeout(30_000)]);
		let response: Response;
		try {
			response = await fetch(new URL(path, server.origin).href, {
				method,
				signal,
				headers: { Authorization: authorization },
				credentials: "omit",
				redirect: "error",
				cache: "no-store",
			});
		} catch {
			signal.throwIfAborted();
			throw new CacheError("unreachable");
		}
		if (!response.ok) {
			await response.body?.cancel();
			if (response.status === 401 || response.status === 403)
				throw new CacheError("authentication");
			if (response.status === 404 || response.status === 409)
				throw new CacheError("sourceChanged");
			throw new CacheError("download");
		}
		return response;
	}

	async function json<T>(path: string, method?: "POST") {
		return (await (await request(path, method)).json()) as T;
	}

	async function file(expected: string | null) {
		const { file, originalMediaUrl } = await json<FileResponse>(filePath);
		const format = extname(file.name).slice(1).toLowerCase();
		if (
			file.id !== fileId ||
			!file.sourceVersion ||
			originalMediaUrl !== originalMediaPath(fileId) ||
			!Number.isSafeInteger(file.sizeBytes) ||
			file.sizeBytes <= 0 ||
			!["mkv", "mp4", "m4v", "webm"].includes(format) ||
			!/^video\/[\w.+-]+$/.test(file.mimeType)
		)
			throw new CacheError("download");
		if (expected && expected !== file.sourceVersion)
			throw new CacheError("sourceChanged");
		return { ...file, sourceVersion: file.sourceVersion, format };
	}

	return {
		file,
		async episodes(version: string) {
			try {
				const data = await json<CatalogSourceResponse>(
					`/api/catalog/sources/${encodeURIComponent(fileId)}`,
				);
				return data.sourceVersion === version
					? data.associations.map(({ workId, workTitle, number, label }) => ({
							workId,
							workTitle,
							number,
							label,
						}))
					: [];
			} catch {
				lifetime.throwIfAborted();
				return [];
			}
		},
		async subtitles(version: string) {
			const data = await json<SubtitleDiscoveryResponse>(
				`${filePath}/subtitles`,
			);
			if (data.sourceVersion !== version) throw new CacheError("sourceChanged");
			return data.tracks.flatMap((track) => {
				const { format } = track;
				return track.origin === "external" &&
					track.supported &&
					format &&
					subtitleFormats.includes(format)
					? [{ ...track, format }]
					: [];
			});
		},
		async subtitle(
			version: string,
			track: { id: string; sourceVersion: string },
		) {
			const query = new URLSearchParams({
				sourceVersion: version,
				subtitleVersion: track.sourceVersion,
			});
			const response = await request(
				`${filePath}/subtitles/${encodeURIComponent(track.id)}/content?${query}`,
			);

			const chunks: Uint8Array[] = [];
			let size = 0;
			if (!response.body) throw new CacheError("download");
			const reader = response.body.getReader();
			try {
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) break;
					size += chunk.value.byteLength;
					if (size > subtitleConstraints.maximumBytes)
						throw new CacheError("download");
					chunks.push(chunk.value);
				}
				return Buffer.concat(chunks, size);
			} finally {
				await reader.cancel().catch(() => {});
			}
		},
		async link() {
			const { url } = await json<MediaAccessLinkResponse>(
				`${originalMediaPath(fileId)}/access-link`,
				"POST",
			);
			const resolved = URL.parse(url, server.origin);
			if (
				!resolved ||
				!matchesOriginalMediaLink(server.origin, fileId, resolved)
			)
				throw new CacheError("download");
			return resolved.href;
		},
	};
}
