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
export async function collectMetadata<T>(
	tasks: (() => Promise<T>)[],
	signal?: AbortSignal,
	logger?: Logger,
): Promise<{ values: T[]; failed: boolean }> {
	const results = await Promise.allSettled(
		tasks.map((task) => Promise.resolve().then(task)),
	);
	signal?.throwIfAborted();
	const values = results.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	if (!values.length && results.length) {
		const failure = results.find((result) => result.status === "rejected");
		if (failure?.status === "rejected") {
			const cause: unknown = failure.reason;
			if (cause instanceof MetadataError)
				throw new MetadataError(
					{
						...cause.failure,
						message: "Metadata could not be loaded. Retry shortly.",
					},
					{ cause },
				);
			throw cause;
		}
	}
	const failed = values.length !== results.length;
	if (failed)
		logger?.warn(
			{
				event: "metadata.partial_read",
				completed: values.length,
				attempted: results.length,
			},
			"Metadata retained available content after a partial failure.",
		);
	return { values, failed };
}
