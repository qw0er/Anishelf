import { expect, test, vi } from "vitest";
import { createHttpApp } from "../../../../src/app/bootstrap/http.js";
import { createAuthenticationModule } from "../../../../src/modules/system/create.js";
import {
	cleanup,
	fixture,
	key,
	setupTestLifecycle,
} from "./support/rss-fixture.js";

vi.mock("node:fs/promises", async () => {
	const { memoryFs } = await import("../../../support/memory-filesystem.js");
	return memoryFs.promises;
});

setupTestLifecycle();

test("subscription HTTP routes are authenticated, CSRF protected and redact private RSS addresses", async () => {
	const f = await fixture();
	const auth = await createAuthenticationModule({
		logger: f.options.logger,
		dataDir: f.dataDir,
		store: f.database.authentication,

		sources: { version: async () => "one" },
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: f.options.logger,
		configure: auth.registerHttp,
		registrations: [f.module.registerHttp],
		closeDependencies: async () => {},
	});
	cleanup.push(() => app.close());
	const headers = { host: "127.0.0.1:3000" },
		path = "/api/acquisition/subscriptions";
	expect(
		(await app.inject({ url: `${path}?workKey=${key}`, headers })).statusCode,
	).toBe(401);
	const session = await app.inject({ url: "/api/auth/session", headers });
	const login = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: {
			...headers,
			cookie: session.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
			"x-csrf-token": session.json().csrfToken,
		},
		payload: { password: auth.initialPassword },
	});
	const signed = {
		...headers,
		cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
	};
	const mutation = { ...signed, "x-csrf-token": login.json().csrfToken };
	const payload = {
		...f.stamp(),
		workKey: key,
		source: {
			kind: "feed" as const,
			url: "https://feeds.example.org/private-token/rss?passkey=private-token",
		},
		startEpisode: 1,
		revision: null,
	};
	expect(
		(
			await app.inject({
				url: path,
				method: "PUT",
				headers: signed,
				payload,
			})
		).statusCode,
	).toBe(403);
	const saved = await app.inject({
		url: path,
		method: "PUT",
		headers: mutation,
		payload,
	});
	expect(saved.statusCode).toBe(200);
	expect(saved.json().candidates).toEqual([]);
	expect(f.fetch).not.toHaveBeenCalled();
	expect(
		(
			await app.inject({
				url: `${path}/preview`,
				method: "POST",
				headers: mutation,
				payload,
			})
		).statusCode,
	).toBe(404);
	expect(saved.body).not.toContain("private-token");
	expect(saved.body).not.toContain("downloadUrl");
	expect(
		(
			await app.inject({
				url: `${path}?workKey=${key}&page=0`,
				headers: signed,
			})
		).statusCode,
	).toBe(400);
	expect(f.logs.join("")).not.toContain("private-token");
});
