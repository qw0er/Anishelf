import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
	ApiClientError,
	getDirectory,
	getLibrary,
	isRequestCancelled,
	startScan,
} from "../src/api/client.js";
import type {
	DirectoryResponse,
	LibraryResponse,
	ScanResponse,
} from "../src/api/contracts.js";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
	fetcher.mockReset();
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const library: LibraryResponse = {
	ready: true,
	revision: 0,
	scan: null,
	error: null,
	stale: false,
};
const directory: DirectoryResponse = {
	directory: { kind: "directory", id: "root", name: "root", parentId: null },
	children: [],
};
const scan: ScanResponse = {
	scan: {
		id: "scan-id",
		status: "running",
		startedAt: "2026-09-28T00:00:00.000Z",
		finishedAt: null,
		visitedCount: 0,
		matchedCount: 0,
		warnings: { count: 0, messages: [] },
	},
};

function json(body: unknown, status = 200, requestId = "header-id") {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "x-request-id": requestId },
	});
}

test("typed methods use the browsing endpoints and same-origin uncached requests", async () => {
	fetcher
		.mockResolvedValueOnce(json(library))
		.mockResolvedValueOnce(json(scan, 202))
		.mockResolvedValueOnce(json(directory));
	const state: LibraryResponse = await getLibrary();
	const started: ScanResponse = await startScan();
	const listing: DirectoryResponse = await getDirectory("root");
	expect(state).toEqual(library);
	expect(started).toEqual(scan);
	expect(listing).toEqual(directory);
	for (const [position, path, method] of [
		[1, "/api/library", "GET"],
		[2, "/api/library/scan", "POST"],
		[3, "/api/directories/root", "GET"],
	] as const) {
		expect(fetcher).toHaveBeenNthCalledWith(position, path, {
			method,
			headers: { Accept: "application/json" },
			credentials: "same-origin",
			cache: "no-store",
		});
	}
});

test("directory IDs are encoded as one URL segment", async () => {
	fetcher.mockResolvedValue(json(directory));
	await getDirectory("folder/name?#café");
	expect(fetcher.mock.calls[0]?.[0]).toBe(
		"/api/directories/folder%2Fname%3F%23caf%C3%A9",
	);
});

test.each([400, 403, 404, 503])(
	"HTTP %s errors preserve the public code, message, status and request ID",
	async (status) => {
		fetcher.mockResolvedValue(
			json(
				{
					error: {
						code: "RESOURCE_ROOT_UNAVAILABLE",
						message: "The resource directory is unavailable.",
						requestId: "body-id",
					},
				},
				status,
			),
		);
		await expect(getLibrary()).rejects.toMatchObject({
			name: "ApiClientError",
			kind: "http",
			status,
			code: "RESOURCE_ROOT_UNAVAILABLE",
			message: "The resource directory is unavailable.",
			requestId: "body-id",
		});
	},
);

test("library readiness errors remain a successful library response", async () => {
	const unavailable: LibraryResponse = {
		...library,
		ready: false,
		error: {
			code: "RESOURCE_ROOT_UNAVAILABLE",
			message: "Fix the resource root.",
		},
	};
	fetcher.mockResolvedValue(json(unavailable));
	expect(await getLibrary()).toEqual(unavailable);
});

test.each([
	"<html>secret /private/config</html>",
	JSON.stringify({ error: { code: 123, message: "secret /private/config" } }),
	JSON.stringify({ message: "secret /private/config" }),
])("malformed HTTP errors use a safe fallback: %s", async (body) => {
	fetcher.mockResolvedValue(
		new Response(body, {
			status: 500,
			headers: { "x-request-id": "header-id" },
		}),
	);
	const error = await getLibrary().catch((cause: unknown) => cause);
	expect(error).toBeInstanceOf(ApiClientError);
	expect(error).toMatchObject({
		kind: "http",
		status: 500,
		code: null,
		requestId: "header-id",
	});
	expect((error as ApiClientError).message).not.toContain("secret");
	expect((error as ApiClientError).message).not.toContain("/private");
});

test("invalid success JSON is distinguished from HTTP and network failures", async () => {
	fetcher.mockResolvedValue(
		new Response("<html>wrong server</html>", {
			headers: { "x-request-id": "id" },
		}),
	);
	await expect(getLibrary()).rejects.toMatchObject({
		kind: "invalid_response",
		status: 200,
		code: null,
		requestId: "id",
	});
});

test("network failures get a displayable message without the raw exception", async () => {
	fetcher.mockRejectedValue(new TypeError("secret URL"));
	const error = await getLibrary().catch((cause: unknown) => cause);
	expect(error).toBeInstanceOf(ApiClientError);
	expect(error).toMatchObject({
		kind: "network",
		status: null,
		code: null,
		requestId: null,
	});
	expect((error as ApiClientError).message).not.toContain("secret URL");
});

test("already aborted requests never call fetch", async () => {
	const controller = new AbortController();
	controller.abort();
	const error = await getLibrary({ signal: controller.signal }).catch(
		(cause: unknown) => cause,
	);
	expect(isRequestCancelled(error)).toBe(true);
	expect(error).not.toBeInstanceOf(ApiClientError);
	expect(fetcher).not.toHaveBeenCalled();
});

test("aborting one request leaves a newer independent request usable", async () => {
	const oldController = new AbortController();
	fetcher
		.mockImplementationOnce(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					);
				}),
		)
		.mockResolvedValueOnce(json(directory));
	const old = getDirectory("old", { signal: oldController.signal }).catch(
		(cause: unknown) => cause,
	);
	const current = getDirectory("root");
	oldController.abort();
	expect(isRequestCancelled(await old)).toBe(true);
	expect(await current).toEqual(directory);
	expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(oldController.signal);
});

test("cancellation while consuming JSON remains cancellation", async () => {
	const controller = new AbortController();
	const response = json(library);
	vi.spyOn(response, "json").mockImplementation(async () => {
		controller.abort();
		throw controller.signal.reason;
	});
	fetcher.mockResolvedValue(response);
	const error = await getLibrary({ signal: controller.signal }).catch(
		(cause: unknown) => cause,
	);
	expect(isRequestCancelled(error)).toBe(true);
	expect(error).not.toBeInstanceOf(ApiClientError);
});

test("a cancelled response is discarded even if fetch ignores the signal", async () => {
	const controller = new AbortController();
	fetcher.mockImplementation(async () => {
		controller.abort();
		return json(library);
	});
	const error = await getLibrary({ signal: controller.signal }).catch(
		(cause: unknown) => cause,
	);
	expect(isRequestCancelled(error)).toBe(true);
});

test("custom abort reasons are still recognized as cancellation", async () => {
	const controller = new AbortController();
	controller.abort("navigation changed");
	const error = await getLibrary({ signal: controller.signal }).catch(
		(cause: unknown) => cause,
	);
	expect(isRequestCancelled(error)).toBe(true);
	expect(fetcher).not.toHaveBeenCalled();
});
