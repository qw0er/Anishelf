import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { createAcquisitionModule } from "../src/modules/acquisition/create.js";
import { JackettClient } from "../src/modules/acquisition/sources/jackett/client.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) await close();
});
test("Source connector settings and unified diagnostics require authentication and CSRF, and project safe evidence", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-jackett-http-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const database = ApplicationDatabase.open(dataDir);
	cleanup.push(async () => database.close());
	const logs: string[] = [];
	const logger = pino({ level: "trace" }, { write: (line) => logs.push(line) });
	const module = await createAcquisitionModule({
		dataDir,
		store: database.acquisition,
		downloadStore: database.acquisitionDownloads,
		autoStart: false,
		logger,
	});
	cleanup.push(() => module.close());
	const auth = await createAuthenticationModule({
		logger,
		dataDir,
		store: database.authentication,
		secure: false,
		sources: { version: async () => "one" },
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		configure: auth.registerHttp,
		registrations: [module.registerHttp],
		closeDependencies: async () => {},
	});
	cleanup.push(() => app.close());
	const url = "/api/acquisition/sources/connector",
		headers = { host: "127.0.0.1:3000" };
	expect((await app.inject({ url, headers })).statusCode).toBe(401);
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
	const authenticated = {
		...headers,
		cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
	};
	const mutationHeaders = {
		...authenticated,
		"x-csrf-token": login.json().csrfToken,
	};
	const current = await app.inject({ url, headers: authenticated });
	expect(current.headers["cache-control"]).toBe("no-store");
	for (const [testHeaders, expected] of [
		[headers, 401],
		[authenticated, 403],
		[mutationHeaders, 503],
	] as const) {
		for (const initializeSite of [false, true]) {
			expect(
				(
					await app.inject({
						url: `${url}/bundled`,
						method: "POST",
						headers: testHeaders,
						payload: { generation: current.json().generation, initializeSite },
					})
				).statusCode,
			).toBe(expected);
		}
	}

	const secret = "private-http-key";
	const payload = {
		generation: current.json().generation,
		url: "http://jackett:9117",
		managementUrl: "https://sites.example.org/",
		origin: "external",
		apiKey: secret,
		providers: ["example"],
	};
	expect(
		(await app.inject({ url, method: "PUT", headers: authenticated, payload }))
			.statusCode,
	).toBe(403);
	const saved = await app.inject({
		url,
		method: "PUT",
		headers: mutationHeaders,
		payload,
	});
	expect(saved.statusCode).toBe(200);
	expect(saved.body).not.toContain(secret);
	expect(saved.json().ready).toBe(true);
	expect(saved.json().managementUrl).toBe("https://sites.example.org/");
	expect(
		(
			await app.inject({
				url,
				method: "PUT",
				headers: mutationHeaders,
				payload,
			})
		).statusCode,
	).toBe(409);
	expect(
		(
			await app.inject({
				url,
				method: "PUT",
				headers: mutationHeaders,
				payload: {
					...payload,
					generation: saved.json().generation,
					url: "http://jackett:9117?apikey=secret",
				},
			})
		).statusCode,
	).toBe(400);
	const search = vi.spyOn(JackettClient.prototype, "search").mockResolvedValue({
		outcome: "matches",
		coverage: {
			limited: true,
			reason: "missing_pagination",
			pages: 1,
			queries: 1,
		},
		entries: [
			{
				id: "release",
				observationId: "evidence",
				hash: null,
				title: "Example Season 2",
				publishedAt: null,
				downloadUrl: null,
				guid: `http://jackett/${secret}`,
				download: {
					kind: "jackett-torrent",
					generation: saved.json().generation,
					indexerId: "example",
					path: "opaque",
					file: "example",
				},
			},
		],
	});
	const result = await app.inject({
		url: "/api/acquisition/sources/test",
		method: "POST",
		headers: mutationHeaders,
		payload: {
			kind: "search",
			connectionRevision: saved.json().generation,
			providerId: "example",
			titles: ["Example Season 2"],
		},
	});
	expect(result.statusCode).toBe(200);
	expect(result.json()).toMatchObject({
		outcome: "matches",
		coverage: { limited: true },
		entries: [{ downloadAvailable: true, seeders: null }],
	});
	expect(result.body).not.toContain("opaque");
	expect(result.body).not.toContain(secret);
	expect(search).toHaveBeenCalledOnce();
	const rejected = await app.inject({
		url: "/api/acquisition/sources/test",
		method: "POST",
		headers: mutationHeaders,
		payload: {
			kind: "search",
			connectionRevision: saved.json().generation,
			providerId: "all",
			titles: ["Example"],
		},
	});
	expect(rejected.statusCode).toBe(400);
	expect(search).toHaveBeenCalledOnce();
	const feedInput = {
		kind: "feed",
		url: "https://example.org/rss?key=private-feed-key",
	};
	expect(
		(
			await app.inject({
				url: "/api/acquisition/sources",
				method: "POST",
				headers: authenticated,
				payload: feedInput,
			})
		).statusCode,
	).toBe(404);
	const removedRegistration = await app.inject({
		url: "/api/acquisition/sources",
		method: "POST",
		headers: mutationHeaders,
		payload: feedInput,
	});
	expect(removedRegistration.statusCode).toBe(404);
	expect(logs.join("\n")).not.toContain(secret);
	expect(logs.join("\n")).not.toContain("private-feed-key");
});
