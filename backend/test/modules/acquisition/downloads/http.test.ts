import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { createHttpApp } from "../../../../src/app/bootstrap/http.js";
import { createAcquisitionModule } from "../../../../src/modules/acquisition/create.js";
import { createAuthenticationModule } from "../../../../src/modules/system/create.js";

import {
	cleanup,
	fixture,
	key,
	logger,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("download endpoints enforce authentication, CSRF, revision checks and safe projections", async () => {
	const f = await fixture();
	const module = await createAcquisitionModule({
		dataDir: f.dir,
		logger,
		store: f.db.acquisition,
		downloadStore: f.db.acquisitionDownloads,
		resources: f.resources,
		anime: f.anime,
		ingestion: f.ingestion,
		torrentTransport: f.transport,
		createClient: () => f.client,
		transport: { fetch: vi.fn(), close: async () => {} },
		autoStart: false,
	});
	cleanup.push(() => module.close());
	const auth = await createAuthenticationModule({
		logger,
		dataDir: f.dir,
		store: f.db.authentication,

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
	const headers = { host: "127.0.0.1:3000" },
		url = "/api/acquisition/downloads/settings";
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
	const signed = {
			...headers,
			cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
		},
		mutation = { ...signed, "x-csrf-token": login.json().csrfToken };
	expect(
		(
			await app.inject({
				method: "PUT",
				url,
				headers: signed,
				payload: { revision: null, scopeId: "root", path: "/downloads" },
			})
		).statusCode,
	).toBe(403);
	const result = await app.inject({
		method: "PUT",
		url,
		headers: mutation,
		payload: { revision: null, scopeId: "root", path: "/downloads" },
	});
	expect(result.statusCode).toBe(200);
	expect(
		(
			await app.inject({
				method: "PUT",
				url,
				headers: mutation,
				payload: { revision: null, scopeId: "root", path: "/other" },
			})
		).statusCode,
	).toBe(409);
	const activity = await app.inject({
		url: `/api/acquisition/downloads?workKey=${key}`,
		headers: signed,
	});
	expect(activity.statusCode).toBe(200);
	expect(activity.json()).toMatchObject({ authorized: false, items: [] });
	expect(activity.body).not.toContain("secret");
	const episodeUrl = "/api/acquisition/downloads/episodes";
	const payload = { workKey: key, episode: 3, commandId: randomUUID() };
	expect(
		(await app.inject({ method: "POST", url: episodeUrl, headers, payload }))
			.statusCode,
	).toBe(401);
	expect(
		(
			await app.inject({
				method: "POST",
				url: episodeUrl,
				headers: signed,
				payload,
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await app.inject({
				method: "POST",
				url: episodeUrl,
				headers: mutation,
				payload: { ...payload, episode: 0 },
			})
		).statusCode,
	).toBe(400);
	await module.api.connection.save({
		generation: module.api.connection.settings().generation,
		url: "http://downloader:8080",
		username: "user",
		password: "secret-password",
	});
	const destination = await module.api.downloads?.saveDestination({
		revision: result.json().revision,
		scopeId: "root",
		path: "/downloads",
	});
	if (!destination) throw new Error("Missing downloads");
	await module.api.downloads?.validate(destination.revision);
	await module.api.sources.connector.save({
		generation: module.api.sources.connector.settings().generation,
		url: "http://jackett:9117",
		apiKey: "private-key",
		origin: "external",
		providers: ["site"],
	});
	const subscriptionsBefore = JSON.stringify(f.db.acquisition.subscriptions());
	const accepted = await app.inject({
		method: "POST",
		url: episodeUrl,
		headers: mutation,
		payload,
	});
	expect(accepted.statusCode).toBe(200);
	expect(accepted.json()).toEqual({
		accepted: true,
		intentId: payload.commandId,
		existing: false,
	});
	expect(
		(
			await app.inject({
				method: "POST",
				url: episodeUrl,
				headers: mutation,
				payload,
			})
		).json(),
	).toMatchObject({ intentId: payload.commandId, existing: true });
	expect(JSON.stringify(f.db.acquisition.subscriptions())).toBe(
		subscriptionsBefore,
	);
	const projection = await app.inject({
		url: `/api/acquisition/downloads?workKey=${key}`,
		headers: signed,
	});
	expect(projection.json().items[0]).toMatchObject({
		origin: "one-off",
		state: "discovering",
	});
	expect(projection.body).not.toMatch(
		/private-key|secret-password|sourceGeneration|profileFingerprint/,
	);

	expect(
		(
			await app.inject({
				method: "POST",
				url: "/api/acquisition/subscriptions/search",
				headers: mutation,
				payload: { workKey: key, revision: null, startEpisode: 1 },
			})
		).statusCode,
	).toBe(404);
});
