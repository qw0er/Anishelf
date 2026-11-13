import { isRequestCancelled } from "@anishelf/client-core";
import { createServerConnection } from "@anishelf/client-core/connection";
import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";
import { expect, test } from "vitest";

test("JSON requests and resource addresses use the same configured server", async () => {
	const urls: string[] = [];
	const connection = createServerConnection({
		origin: "https://server.test:8443/",
		async fetch(url) {
			urls.push(url);
			return Response.json({ ok: true });
		},
	});
	await connection.api.request("/api/health", "GET");
	await connection.fetchResource("/api/files/a/subtitles");
	expect(urls).toEqual([
		"https://server.test:8443/api/health",
		"https://server.test:8443/api/files/a/subtitles",
	]);
	expect(
		connection.resolveResourceUrl("/api/media/a?access_token=one%2Ftwo"),
	).toBe("https://server.test:8443/api/media/a?access_token=one%2Ftwo");

	const web = createServerConnection({
		origin: "https://server.test",
		sameOrigin: true,
		fetch: () => {
			throw new Error("Invalid resource addresses must never be fetched.");
		},
	});
	expect(web.resolveResourceUrl("/api/cover?v=2")).toBe("/api/cover?v=2");
	expect(web.resolveResourceUrl("/api/media/a", true)).toBe(
		"https://server.test/api/media/a",
	);
	for (const unsafe of [
		"//other.test/api/media/a",
		"https://other.test/api/media/a",
		"https://user:pass@server.test/api/media/a",
		"https://server.test//other.test/api/media/a",
		"/api/..//other.test/api/media/a",
		"javascript:alert(1)",
	]) {
		expect(web.resolveResourceUrl(unsafe)).toBeNull();
		await expect(web.fetchResource(unsafe)).rejects.toBeInstanceOf(TypeError);
	}
});

test("disposal cancels outstanding session and media reads without notifying expiry", async () => {
	const pending: {
		url: string;
		signal: AbortSignal | null | undefined;
		finish(response: Response): void;
	}[] = [];
	const { connection } = createCookieConnection({
		origin: "https://old.test",
		fetch(url, init) {
			const result = Promise.withResolvers<Response>();
			pending.push({ url, signal: init.signal, finish: result.resolve });
			return result.promise;
		},
		onAuthRequired: () => {
			throw new Error("A closed connection must ignore stale 401s.");
		},
	});
	const mutation = connection.api.request("/api/change", "POST");
	const subtitle = connection.fetchResource("/api/subtitle");
	expect(pending).toHaveLength(2);
	connection.dispose();
	for (const request of pending) {
		expect(request.signal?.aborted).toBe(true);
		request.finish(Response.json({}, { status: 401 }));
	}
	await expect(mutation).rejects.toSatisfy(isRequestCancelled);
	await expect(subtitle).rejects.toSatisfy(isRequestCancelled);
	await expect(connection.api.request("/api/health", "GET")).rejects.toSatisfy(
		isRequestCancelled,
	);
	expect(pending).toHaveLength(2);
});
