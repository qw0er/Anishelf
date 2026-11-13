import { ApiClientError } from "@anishelf/client-core";
import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";
import { expect, test } from "vitest";

interface CapturedRequest {
	path: string;
	headers: Record<string, string>;
}

test("API clients keep session bootstrap, CSRF tokens and expiry notifications separate", async () => {
	function client(token: string) {
		const requests: CapturedRequest[] = [];
		const authEvents: string[] = [];
		const {
			connection: { api },
		} = createCookieConnection({
			origin: "https://example.test",
			async fetch(path, init) {
				requests.push({
					path,
					headers: init.headers as Record<string, string>,
				});
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
	] as const) {
		const [session, ...mutations] = instance.requests;
		expect(session?.path).toBe("/api/auth/session");
		expect(mutations.length).toBe(instance === first ? 2 : 1);
		for (const request of mutations)
			expect(request.headers["x-csrf-token"]).toBe(token);
	}

	const error = await first.api
		.request("/api/private", "GET")
		.catch((cause: unknown) => cause);
	expect(error).toBeInstanceOf(ApiClientError);
	expect((error as ApiClientError).status).toBe(401);

	await first.api.request("/api/three", "POST");
	await second.api.request("/api/two", "POST");
	expect(first.authEvents).toEqual(["expired"]);
	expect(second.authEvents).toEqual([]);
	expect(first.requests.at(-2)?.path).toBe("/api/auth/session");
	expect(second.requests.at(-2)?.path).toBe("/api/one");
	expect(second.requests.at(-1)?.headers["x-csrf-token"]).toBe("second");
});
