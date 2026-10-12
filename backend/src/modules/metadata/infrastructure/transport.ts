import { abortable } from "../domain/async.js";
import { MetadataError } from "../domain/model.js";
export async function boundedBody(
	response: Response,
	maximum: number,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const length = Number(response.headers.get("content-length"));
	if (length > maximum) {
		await response.body?.cancel();
		throw new MetadataError({
			code: "invalid-response",
			message: "Provider response exceeds the size limit.",
			retryAt: null,
		});
	}
	if (!response.body)
		throw new MetadataError({
			code: "invalid-response",
			message: "Provider response has no body.",
			retryAt: null,
		});
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await abortable(reader.read(), signal);
			if (done) break;
			size += value.byteLength;
			if (size > maximum)
				throw new MetadataError({
					code: "invalid-response",
					message: "Provider response exceeds the size limit.",
					retryAt: null,
				});
			chunks.push(value);
		}
		return Buffer.concat(chunks, size);
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
