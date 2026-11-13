import { createServerConnection } from "@anishelf/client-core/connection";
import { expect, test, vi } from "vitest";
import { createClientRuntime } from "../../../src/shared/api/connection.js";

test("disposing one Web connection clears its cache and leaves the other connection usable", async () => {
	const fetcher = vi.fn(async () => Response.json({ ok: true }));
	const createRuntime = (origin: string) =>
		createClientRuntime({
			connection: createServerConnection({
				origin,
				sameOrigin: true,
				fetch: fetcher,
			}),
			buildInfo: {
				version: "1.0.2",
				commit: "test",
				channel: "development",
				builtAt: null,
			},
			changelog: "",
			onAuthRequired: vi.fn(),
			replaceLocation: vi.fn(),
		});
	const first = createRuntime("https://first.test");
	const second = createRuntime("https://second.test");
	const key = ["file", "same-id"];
	first.queryClient.setQueryData(key, "first");
	second.queryClient.setQueryData(key, "second");

	first.dispose();

	expect(first.queryClient.getQueryData(key)).toBeUndefined();
	expect(second.queryClient.getQueryData(key)).toBe("second");
	await expect(
		first.connection.api.request("/api/health", "GET"),
	).rejects.toMatchObject({
		name: "AbortError",
	});
	await expect(
		second.connection.api.request("/api/health", "GET"),
	).resolves.toEqual({
		ok: true,
	});
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		"/api/health",
		expect.objectContaining({ credentials: "same-origin" }),
	);
	second.dispose();
});
