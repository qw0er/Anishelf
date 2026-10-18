// @vitest-environment happy-dom
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { operationsQuery } from "../src/features/anime/tracking/operations.js";
import type { TrackingOperationsResponse } from "../src/shared/api/contracts.js";

test("operation observation slows after completion and immediately resumes fast checks for admitted work", async () => {
	vi.useFakeTimers();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity } },
	});
	const read = vi
		.fn<() => Promise<TrackingOperationsResponse>>()
		.mockResolvedValue([]);
	const observer = new QueryObserver(client, {
		...operationsQuery({ accountId: "anilist:7", generation: "one" }),
		queryFn: read,
	});
	const unsubscribe = observer.subscribe(() => {});
	try {
		await observer.refetch();
		read.mockClear();
		await vi.advanceTimersByTimeAsync(59_999);
		expect(read).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(read).toHaveBeenCalledTimes(1);
		// A command response populates pending intent, enabling fast observation immediately.
		client.setQueryData(observer.options.queryKey, [
			{ id: "op", state: "pending", retryAt: null },
		]);
		await vi.advanceTimersByTimeAsync(1499);
		expect(read).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(read).toHaveBeenCalledTimes(2);
		// The successful read returns an empty queue, so the fast interval stops again.
		await vi.advanceTimersByTimeAsync(10_000);
		expect(read).toHaveBeenCalledTimes(2);
	} finally {
		unsubscribe();
		client.clear();
		vi.useRealTimers();
	}
});
