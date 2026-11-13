import assert from "node:assert/strict";
import { test } from "node:test";
import { isRequestCancelled } from "@anishelf/client-core";
import { createServerConnection } from "@anishelf/client-core/connection";

import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";

test("JSON requests and resource addresses use the same configured server", async () => {
	const urls = [];
	const connection = createServerConnection({
		origin: "https://server.test:8443/",
		async fetch(url) {
			urls.push(url);
			return Response.json({ ok: true });
		},
	});
	await connection.api.request("/api/health", "GET");
	await connection.fetchResource("/api/files/a/subtitles");
	assert.deepEqual(urls, [
		"https://server.test:8443/api/health",
		"https://server.test:8443/api/files/a/subtitles",
	]);
	assert.equal(
		connection.resolveResourceUrl("/api/media/a?access_token=one%2Ftwo"),
		"https://server.test:8443/api/media/a?access_token=one%2Ftwo",
	);

	const web = createServerConnection({
		origin: "https://server.test",
		sameOrigin: true,
		fetch: () =>
			assert.fail("Invalid resource addresses must never be fetched."),
	});
	assert.equal(web.resolveResourceUrl("/api/cover?v=2"), "/api/cover?v=2");
	assert.equal(
		web.resolveResourceUrl("/api/media/a", true),
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
		assert.equal(web.resolveResourceUrl(unsafe), null);
		await assert.rejects(web.fetchResource(unsafe), TypeError);
	}
});

test("disposal cancels outstanding session and media reads without notifying expiry", async () => {
	const pending = [];
	const { connection } = createCookieConnection({
		origin: "https://old.test",
		fetch(url, init) {
			const result = Promise.withResolvers();
			pending.push({ url, signal: init.signal, finish: result.resolve });
			return result.promise;
		},
		onAuthRequired: () =>
			assert.fail("A closed connection must ignore stale 401s."),
	});
	const mutation = connection.api.request("/api/change", "POST");
	const subtitle = connection.fetchResource("/api/subtitle");
	assert.equal(pending.length, 2);
	connection.dispose();
	for (const request of pending) {
		assert.equal(request.signal.aborted, true);
		request.finish(Response.json({}, { status: 401 }));
	}
	await assert.rejects(mutation, isRequestCancelled);
	await assert.rejects(subtitle, isRequestCancelled);
	await assert.rejects(
		connection.api.request("/api/health", "GET"),
		isRequestCancelled,
	);
	assert.equal(pending.length, 2);
});
