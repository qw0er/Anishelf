import { afterEach, expect, vi } from "vitest";

// Happy DOM does not implement the font readiness promise used by navigation measurements.
if (typeof document !== "undefined" && !document.fonts) {
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: { ready: Promise.resolve() },
	});
}

const unexpectedRequests: string[] = [];

// Per-test fetch stubs restore this offline baseline, never native fetch.
// Keep a separate ledger because callers may catch the rejected promise.
globalThis.fetch = vi.fn<typeof fetch>(async (input) => {
	const url =
		typeof input === "string" || input instanceof URL
			? String(input)
			: input.url;
	const path = new URL(url, "http://test.invalid").pathname;
	unexpectedRequests.push(path);
	throw new Error(`Unexpected fetch in a web test: ${path}`);
});

afterEach(() => {
	const requests = unexpectedRequests.splice(0);
	expect(
		requests,
		"Mock each API request explicitly, including background queries.",
	).toEqual([]);
});
