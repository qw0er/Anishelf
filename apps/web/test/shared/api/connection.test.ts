import { expect, test, vi } from "vitest";
import { createWebConnection } from "../../../src/shared/api/connection.js";

test("disposing one Web connection clears its cache and leaves the other connection usable", async () => {
	const fetcher = vi.fn(async () => Response.json({ ok: true }));
	const first = createWebConnection("https://first.test", fetcher);
	const second = createWebConnection("https://second.test", fetcher);
	const key = ["file", "same-id"];
	first.queryClient.setQueryData(key, "first");
	second.queryClient.setQueryData(key, "second");

	first.dispose();

	expect(first.queryClient.getQueryData(key)).toBeUndefined();
	expect(second.queryClient.getQueryData(key)).toBe("second");
	await expect(first.api.request("/api/health", "GET")).rejects.toMatchObject({
		name: "AbortError",
	});
	await expect(second.api.request("/api/health", "GET")).resolves.toEqual({
		ok: true,
	});
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		"/api/health",
		expect.objectContaining({ credentials: "same-origin" }),
	);
	second.dispose();
});
