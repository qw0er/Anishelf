import { expect, test } from "vitest";
import { createHttpApp } from "../../../src/app/bootstrap/http.js";
import { registerWatchingRoutes } from "../../../src/modules/acquisition/watching/http/routes.js";
import { createAuthenticationModule } from "../../../src/modules/system/create.js";

import {
	cleanup,
	config,
	fixture,
	required,
	setupTestLifecycle,
	workKey,
} from "./support/watching-automation-fixture.js";

setupTestLifecycle();

test("Watching HTTP routes require login, CSRF and the preview's actual session", async () => {
	const f = await fixture();
	const auth = await createAuthenticationModule({
		logger: f.logger,
		dataDir: f.directory,
		store: f.db.authentication,

		sources: { version: async () => "one" },
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: f.logger,
		configure: auth.registerHttp,
		registrations: [(app) => registerWatchingRoutes(app, f.watching)],
		closeDependencies: async () => {},
	});
	cleanup.push(() => app.close());
	const base = "/api/acquisition/watching";
	const headers = { host: "127.0.0.1:3000" };
	const mutations = [
		{
			method: "POST" as const,
			url: `${base}/preview`,
			payload: { revision: "unconfigured", config },
		},
		{
			method: "POST" as const,
			url: `${base}/confirm`,
			payload: { id: "missing" },
		},
		{
			method: "POST" as const,
			url: `${base}/disable`,
			payload: { revision: "unconfigured" },
		},
		{
			method: "PUT" as const,
			url: `${base}/works`,
			payload: {
				accountId: "tracking-account",
				trackingGeneration: "tracking-generation",
				workKey,
				revision: null,
				excluded: true,
				paused: false,
			},
		},
	];
	expect((await app.inject({ url: base, headers })).statusCode).toBe(401);
	for (const request of mutations)
		expect((await app.inject({ ...request, headers })).statusCode).toBe(401);
	async function login() {
		const session = await app.inject({ url: "/api/auth/session", headers });
		const result = await app.inject({
			method: "POST",
			url: "/api/auth/login",
			headers: {
				...headers,
				cookie: session.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
				"x-csrf-token": session.json().csrfToken,
			},
			payload: { password: auth.initialPassword },
		});
		expect(result.statusCode).toBe(200);
		const authenticated = {
			...headers,
			cookie: result.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
		};
		return {
			authenticated,
			mutation: { ...authenticated, "x-csrf-token": result.json().csrfToken },
		};
	}
	const first = await login();
	for (const request of mutations)
		expect(
			(await app.inject({ ...request, headers: first.authenticated }))
				.statusCode,
		).toBe(403);
	const state = await app.inject({ url: base, headers: first.authenticated });
	expect(state.headers["cache-control"]).toBe("no-store");
	const preview = await app.inject({
		...required(mutations[0]),
		headers: first.mutation,
	});
	expect(preview.statusCode).toBe(200);
	expect(preview.body).not.toContain("private-key");
	const second = await login();
	const confirm = {
		method: "POST" as const,
		url: `${base}/confirm`,
		payload: { id: preview.json().id },
	};
	expect(
		(await app.inject({ ...confirm, headers: second.mutation })).statusCode,
	).toBe(409);
	const accepted = await app.inject({ ...confirm, headers: first.mutation });
	expect(accepted.statusCode).toBe(200);
	expect(accepted.json().enabled).toBe(true);
	expect(accepted.headers["cache-control"]).toBe("no-store");
	expect(
		(await app.inject({ ...confirm, headers: first.mutation })).statusCode,
	).toBe(409);
	const disabled = await app.inject({
		method: "POST",
		url: `${base}/disable`,
		headers: first.mutation,
		payload: { revision: accepted.json().revision },
	});
	expect(disabled.statusCode).toBe(200);
	expect(disabled.json().enabled).toBe(false);
});
