import type { CachedMetadata, Page } from "../domain/model.js";

export function projectEnvelope<T, U>(
	value: CachedMetadata<T>,
	project: (data: T) => U,
): CachedMetadata<U> {
	return {
		...value,
		refreshError: value.refreshError
			? {
					...value.refreshError,
					message: "Metadata refresh failed. Retry shortly.",
				}
			: null,
		data: project(value.data),
	};
}
export function projectPage<T, U>(
	page: Page<T>,
	project: (item: T) => U,
): Page<U> {
	return { ...page, items: page.items.map(project) };
}
export function combineResults<T>(
	values: CachedMetadata<unknown>[],
	data: T,
	failed = false,
): CachedMetadata<T> {
	const refreshFailure = values.find(
		(value) => value.refreshError,
	)?.refreshError;
	return {
		snapshotId: values.map((value) => value.snapshotId).join(":"),
		fetchedAt: values.length
			? Math.min(...values.map((value) => value.fetchedAt))
			: Date.now(),
		stale: failed || values.some((value) => value.stale),
		refreshing: values.some((value) => value.refreshing),
		refreshError: failed
			? {
					code: "unavailable",
					message: "Some work information is temporarily unavailable.",
					retryAt: null,
				}
			: refreshFailure
				? {
						...refreshFailure,
						message: "Metadata refresh failed. Retry shortly.",
					}
				: null,
		data,
	};
}
