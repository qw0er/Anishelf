import type { Logger } from "pino";
import { MetadataError } from "../domain/model.js";

export function metadataStorage<T>(operation: () => T, logger?: Logger): T {
	try {
		return operation();
	} catch (cause) {
		if (cause instanceof MetadataError) throw cause;
		logger?.error(
			{ event: "metadata.identity_storage_failed", err: cause },
			"Metadata identity storage is unavailable.",
		);
		throw new MetadataError(
			{
				code: "storage-unavailable",
				message: "Metadata identity storage is unavailable.",
				retryAt: null,
			},
			{ cause },
		);
	}
}
export async function readMetadata<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (cause) {
		if (!(cause instanceof MetadataError)) throw cause;
		throw new MetadataError(
			{
				...cause.failure,
				message: "Metadata could not be loaded. Retry shortly.",
			},
			{ cause },
		);
	}
}
