/** HTTP Retry-After supports either delay seconds or an absolute HTTP date. */
export function sourceRetryAt(value: unknown, now = Date.now()): number {
	const header = typeof value === "string" ? value.trim() : "";
	const parsed = /^\d+$/.test(header)
		? now + Number(header) * 1000
		: Date.parse(header);
	return Number.isFinite(parsed) ? Math.max(now, parsed) : now + 60_000;
}
