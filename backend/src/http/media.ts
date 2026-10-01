import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { LibraryApplication } from "../application/library.js";
import type { FileResponse } from "./contracts.js";

import { fileDto } from "./presenters.js";

const schema = {
	params: {
		type: "object",
		additionalProperties: false,
		required: ["id"],
		properties: {
			id: {
				type: "string",
				minLength: 1,
				maxLength: 64,
				pattern: "^[A-Za-z0-9_-]+$",
			},
		},
	},
} as const;

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

// Malformed/multipart fields are ignored; BigInt prevents integer overflow.
function byteRange(header: string | undefined, size: number): ByteRange {
	const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
	if (!match || (!match[1] && !match[2])) return null;
	const length = BigInt(size);
	if (!match[1]) {
		const suffix = BigInt(match[2] as string);
		if (suffix === 0n || length === 0n) return "unsatisfiable";
		return {
			start: Number(suffix >= length ? 0n : length - suffix),
			end: size - 1,
		};
	}
	const start = BigInt(match[1]);
	const end = match[2] ? BigInt(match[2]) : null;
	if (end !== null && end < start) return null;
	if (start >= length) return "unsatisfiable";
	return {
		start: Number(start),
		end: Number(end === null || end >= length ? length - 1n : end),
	};
}

export function registerMediaRoutes(
	app: FastifyInstance<
		RawServerDefault,
		IncomingMessage,
		ServerResponse,
		Logger
	>,
	library: LibraryApplication,
): void {
	app.get<{ Params: { id: string } }>(
		"/api/files/:id",
		{ schema },
		async (request, reply): Promise<FileResponse> => {
			const file = await library.getFile(request.params.id);
			reply.header("Cache-Control", "no-store");
			return {
				file: fileDto(file),
				playbackUrl: `/api/media/${encodeURIComponent(file.id)}`,
			};
		},
	);
	app.route<{ Params: { id: string } }>({
		method: ["GET", "HEAD"],
		url: "/api/media/:id",
		schema,
		handler: async (request, reply) => {
			const file = await library.openMedia(request.params.id);
			let streaming = false;
			try {
				const range =
					request.method === "HEAD" || request.headers["if-range"] !== undefined
						? null
						: byteRange(request.headers.range, file.sizeBytes);
				reply
					.header("Accept-Ranges", "bytes")
					.header("Cache-Control", "no-store")
					.type(file.mimeType);
				if (range === "unsatisfiable") {
					return reply
						.code(416)
						.header("Content-Range", `bytes */${file.sizeBytes}`)
						.header("Content-Length", 0)
						.send();
				}
				const length = range ? range.end - range.start + 1 : file.sizeBytes;
				reply.header("Content-Length", length);
				if (range) {
					reply
						.code(206)
						.header(
							"Content-Range",
							`bytes ${range.start}-${range.end}/${file.sizeBytes}`,
						);
				}
				if (request.method === "HEAD" || length === 0) return reply.send();
				const stream = file.handle.createReadStream({
					start: range?.start ?? 0,
					end: range?.end ?? file.sizeBytes - 1,
				});
				const disconnect = () => stream.destroy();
				reply.raw.once("close", disconnect);
				stream.once("close", () => {
					reply.raw.off("close", disconnect);
					void file.release().catch((err: unknown) => {
						request.log.error({ err }, "Media file release failed.");
					});
				});
				stream.once("error", (err) => {
					request.log.error({ err }, "Media stream failed.");
				});
				streaming = true;
				return reply.send(stream);
			} finally {
				if (!streaming) await file.release();
			}
		},
	});
}
