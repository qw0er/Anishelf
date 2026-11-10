import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const maxBytes = 32 * 1024 * 1024;

async function requestBytes(url, headers) {
	for (let attempt = 0; attempt < 3; attempt++) {
		let response;
		try {
			response = await fetch(url, {
				headers,
				signal: AbortSignal.timeout(120_000),
			});
			if (response.ok) {
				const chunks = [];
				let size = 0;
				for await (const chunk of response.body) {
					size += chunk.byteLength;
					if (size > maxBytes)
						throw new Error("libmedia asset exceeds the 32 MiB download limit");
					chunks.push(chunk);
				}
				return Buffer.concat(chunks);
			}
			await response.body?.cancel();
		} catch (error) {
			if (attempt === 2) throw error;
			console.warn(
				`libmedia: request failed for ${url}: ${error.message}; retry ${attempt + 1}/2.`,
			);
			await delay(1000);
			continue;
		}
		if (!retryableStatuses.has(response.status) || attempt === 2)
			throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
		console.warn(
			`libmedia: HTTP ${response.status} for ${url}; retry ${attempt + 1}/2.`,
		);
		await delay(1000);
	}
}

export async function downloadAsset(item, revision) {
	const sources = [
		{
			url: `https://raw.githubusercontent.com/zhaohappy/libmedia/${revision}/dist/${item.path}`,
		},
		{
			url: `https://api.github.com/repos/zhaohappy/libmedia/contents/dist/${item.path}?ref=${revision}`,
			headers: { Accept: "application/vnd.github.raw+json" },
		},
	];
	for (const [index, source] of sources.entries()) {
		console.log(`libmedia: downloading ${item.path} from ${source.url}`);
		try {
			const bytes = await requestBytes(source.url, source.headers);
			if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
				throw new Error(`libmedia asset checksum mismatch: ${item.path}`);
			return bytes;
		} catch (error) {
			console.warn(
				`libmedia: download failed for ${item.path}: ${error.message}`,
			);
			if (index === sources.length - 1)
				throw new Error(
					`Unable to download verified libmedia asset ${item.path} from raw.githubusercontent.com or api.github.com: ${error.message}`,
					{ cause: error },
				);
			console.warn("libmedia: retrying with the GitHub API fallback.");
		}
	}
}
