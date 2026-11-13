import { notifyManager } from "@tanstack/react-query";

notifyManager.setScheduler(queueMicrotask);

import { afterEach, beforeEach, vi } from "vitest";
import { clearCsrfToken, queryClient, testRuntime } from "../setup.js";

beforeEach(() => queryClient.clear());
afterEach(() => queryClient.clear());

// Business tests start with a bootstrapped browser CSRF token, like the app guard.
beforeEach(async () => {
	const original = globalThis.fetch;
	clearCsrfToken();
	globalThis.fetch = vi
		.fn()
		.mockResolvedValue(
			new Response(
				JSON.stringify({ authenticated: true, csrfToken: "test-csrf" }),
				{ headers: { "content-type": "application/json" } },
			),
		);
	try {
		await testRuntime.authentication.getSession();
	} finally {
		globalThis.fetch = original;
	}
});
