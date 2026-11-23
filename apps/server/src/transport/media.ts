import type { FileHandle } from "node:fs/promises";
import { byteRange } from "@anishelf/contracts/media";
import type { FastifyReply, FastifyRequest } from "fastify";

/** HTTP byte delivery shared by authorized original and prepared media owners. */
export async function sendMediaResponse(
	request: Pick<FastifyRequest, "method" | "headers" | "log">,
	reply: FastifyReply,
	file: {
		handle: FileHandle;
		sizeBytes: number;
		mimeType: string;
		release(): Promise<void>;
	},
	fileId: string,
) {
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
		request.log.trace(
			{
				event: "media.response_started",
				fileId: fileId,
				rangeStart: range?.start,
				rangeEnd: range?.end,
				sizeBytes: file.sizeBytes,
			},
			"Media response started.",
		);
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
				request.log.error(
					{ event: "media.release_failed", fileId: fileId, err },
					"Media file release failed.",
				);
			});
		});
		stream.once("error", (err) => {
			request.log.error(
				{ event: "media.stream_failed", fileId: fileId, err },
				"Media stream failed.",
			);
		});
		streaming = true;
		return reply.send(stream);
	} finally {
		if (!streaming) await file.release();
	}
}
