import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiClientError } from "@anishelf/client-core";
import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";

test("API clients keep session bootstrap, CSRF tokens and expiry notifications separate", async () => {
	function client(token) {
		const requests = [];
		const authEvents = [];
		const {
			connection: { api },
		} = createCookieConnection({
			origin: "https://example.test",
			async fetch(path, init) {
				requests.push({ path, headers: init.headers });
				switch (path) {
					case "/api/auth/session":
						return Response.json({ authenticated: true, csrfToken: token });
					case "/api/private":
						return Response.json(
							{
								error: {
									code: "AUTH_REQUIRED",
									message: "Sign in.",
									requestId: "id",
								},
							},
							{ status: 401 },
						);
					default:
						return new Response(null, { status: 204 });
				}
			},
			onAuthRequired: () => authEvents.push("expired"),
		});
		return { api, requests, authEvents };
	}

	const first = client("first");
	const second = client("second");
	await Promise.all([
		first.api.request("/api/one", "POST"),
		first.api.request("/api/two", "POST"),
		second.api.request("/api/one", "POST"),
	]);
	for (const [instance, token] of [
		[first, "first"],
		[second, "second"],
	]) {
		const [session, ...mutations] = instance.requests;
		assert.equal(session.path, "/api/auth/session");
		assert.equal(mutations.length, instance === first ? 2 : 1);
		for (const request of mutations) {
			assert.equal(request.headers["x-csrf-token"], token);
		}
	}

	await assert.rejects(
		first.api.request("/api/private", "GET"),
		(error) => error instanceof ApiClientError && error.status === 401,
	);
	await first.api.request("/api/three", "POST");
	await second.api.request("/api/two", "POST");
	assert.deepEqual(first.authEvents, ["expired"]);
	assert.deepEqual(second.authEvents, []);
	assert.equal(first.requests.at(-2).path, "/api/auth/session");
	assert.equal(second.requests.at(-2).path, "/api/one");
	assert.equal(second.requests.at(-1).headers["x-csrf-token"], "second");
});
