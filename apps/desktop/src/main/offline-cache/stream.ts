import { open } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { pipeline } from "node:stream/promises";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import { byteRange } from "@anishelf/contracts/media";
import type { CacheFile } from "./store.js";

interface CacheStream {
	path: string;
	file: CacheFile;
	missing(): void;
	release(): void;
}

async function serve(
	request: IncomingMessage,
	response: ServerResponse,
	media: CacheStream,
) {
	try {
		const handle = await open(media.path, "r");
		try {
			const stat = await handle.stat();
			const { size, modifiedAt, mime } = media.file;
			if (!stat.isFile() || stat.size !== size || stat.mtimeMs !== modifiedAt) {
				media.missing();
				response.writeHead(404).end();
				return;
			}
			const range =
				request.method === "GET" && !request.headers["if-range"]
					? byteRange(request.headers.range, size)
					: null;
			response.setHeader("Content-Type", mime);
			response.setHeader("Accept-Ranges", "bytes");
			if (range === "unsatisfiable") {
				response
					.writeHead(416, {
						"Content-Range": `bytes */${size}`,
						"Content-Length": 0,
					})
					.end();
				return;
			}
			response.setHeader(
				"Content-Length",
				range ? range.end - range.start + 1 : size,
			);
			if (range)
				response.setHeader(
					"Content-Range",
					`bytes ${range.start}-${range.end}/${size}`,
				);
			response.statusCode = range ? 206 : 200;
			if (request.method === "HEAD" || size === 0) response.end();
			else
				await pipeline(
					handle.createReadStream({ ...range, autoClose: false }),
					response,
				);
		} finally {
			await handle.close();
		}
	} catch {
		if (!response.headersSent && !response.destroyed) {
			media.missing();
			response.writeHead(404).end();
		}
	} finally {
		media.release();
	}
}

export async function startCacheStream(
	resolve: (lease: string, asset: string) => CacheStream | null,
) {
	const server = createServer((request, response) => {
		response.setHeader("Access-Control-Allow-Origin", desktopOrigin);
		response.setHeader(
			"Access-Control-Expose-Headers",
			"Accept-Ranges, Content-Range",
		);
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("X-Content-Type-Options", "nosniff");
		if (request.headers.origin && request.headers.origin !== desktopOrigin) {
			response.writeHead(403).end();
			return;
		}
		const match = /^\/([a-f\d-]{36})\/(video|\d+)$/.exec(request.url ?? "");
		const lease = match?.[1];
		const asset = match?.[2];
		if (!lease || !asset) {
			response.writeHead(404).end();
			return;
		}
		if (request.method === "OPTIONS") {
			response
				.writeHead(204, {
					"Access-Control-Allow-Methods": "GET, HEAD",
					"Access-Control-Allow-Headers": "Range",
					"Access-Control-Allow-Private-Network": "true",
				})
				.end();
			return;
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, { Allow: "GET, HEAD, OPTIONS" }).end();
			return;
		}
		const media = resolve(lease, asset);
		if (media) void serve(request, response, media);
		else response.writeHead(404).end();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Invalid cache stream address.");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close() {
			server.close();
			server.closeAllConnections();
		},
	};
}
