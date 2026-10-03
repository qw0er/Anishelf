import { DomainError } from "../../../shared/errors.js";
import type { OpenedResourceFile } from "../../resource-access/public.js";
import { subtitlePolicy } from "../domain/policy.js";

/** Bound reads even when a source grows after opening. Never writes the source. */
export async function readSubtitleText(
	file: OpenedResourceFile,
	maximumSubtitleBytes = subtitlePolicy.maximumBytes,
	readChunkBytes = subtitlePolicy.readChunkBytes,
): Promise<string> {
	if (file.sizeBytes > maximumSubtitleBytes)
		throw new DomainError(
			"SUBTITLE_TOO_LARGE",
			`Subtitle exceeds ${maximumSubtitleBytes} bytes.`,
		);
	const chunks: Buffer[] = [];
	let size = 0;
	while (true) {
		const buffer = Buffer.alloc(
			Math.min(readChunkBytes, maximumSubtitleBytes + 1 - size),
		);
		const { bytesRead } = await file.handle.read(
			buffer,
			0,
			buffer.length,
			null,
		);
		if (!bytesRead) break;
		size += bytesRead;
		if (size > maximumSubtitleBytes)
			throw new DomainError(
				"SUBTITLE_TOO_LARGE",
				`Subtitle exceeds ${maximumSubtitleBytes} bytes.`,
			);
		chunks.push(buffer.subarray(0, bytesRead));
	}
	const bytes = Buffer.concat(chunks);
	const encoding =
		bytes[0] === 0xff && bytes[1] === 0xfe
			? "utf-16le"
			: bytes[0] === 0xfe && bytes[1] === 0xff
				? "utf-16be"
				: "utf-8";
	try {
		return new TextDecoder(encoding, { fatal: true }).decode(bytes);
	} catch (cause) {
		throw new DomainError(
			"SUBTITLE_INVALID_ENCODING",
			"Save the subtitle as UTF-8 or UTF-16 with a byte-order mark.",
			{ cause },
		);
	}
}
