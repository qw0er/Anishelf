import { notifyManager } from "@tanstack/react-query";

notifyManager.setScheduler(queueMicrotask);

import { afterEach, beforeEach, vi } from "vitest";
import { queryClient, testRuntime } from "../setup.js";

beforeEach(() => queryClient.clear());
afterEach(() => queryClient.clear());

// Business tests start with a bootstrapped browser CSRF token, like the app guard.
beforeEach(async () => {
	const original = globalThis.fetch;
	const { loadAuthSession } = await vi.importActual<
		typeof import("../../src/shared/api/client.js")
	>("../../src/shared/api/client.js");
	testRuntime.connection.api.clearAuthToken();
	globalThis.fetch = vi
		.fn()
		.mockResolvedValue(
			new Response(
				JSON.stringify({ authenticated: true, csrfToken: "test-csrf" }),
				{ headers: { "content-type": "application/json" } },
			),
		);
	try {
		await loadAuthSession();
	} finally {
		globalThis.fetch = original;
	}
});
