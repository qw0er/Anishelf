import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import { AniListError } from "../src/modules/anime/anilist/public.js";
import {
	createTrackingAccounts,
	createTrackingModule,
} from "../src/modules/anime/composition/tracking.js";
import type { TrackingAccountApplication } from "../src/modules/anime/tracking/application/account.js";
import { registerTrackingListRoutes } from "../src/modules/anime/tracking/http/lists.js";
import { registerTrackingRoutes } from "../src/modules/anime/tracking/http/tracking.js";
import { registerTrackingUpdateRoutes } from "../src/modules/anime/tracking/http/updates.js";
import { AniListAccountProvider } from "../src/modules/anime/tracking/infrastructure/account-provider.js";
import { TrackingCredentialFiles } from "../src/modules/anime/tracking/infrastructure/credentials.js";
import { aniListTracking } from "../src/modules/anime/tracking/infrastructure/provider-mapping.js";
import type {
	TrackingCredentials,
	TrackingStore,
} from "../src/modules/anime/tracking/ports.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";
import type { AniListClient } from "./anilist-fixture.js";
import {
	AniListAccountClient,
	createAniListTracking,
} from "./anilist-fixture.js";

interface AccountTestOptions {
	store: TrackingStore;
	credentials: TrackingCredentials;
	client: AniListClient;
	now?: () => number;
	logger?: Logger;
}
function createAccounts({
	client,
	...options
}: AccountTestOptions): TrackingAccountApplication {
	return createTrackingAccounts({
		descriptor: aniListTracking,
		...options,
		provider: new AniListAccountProvider(new AniListAccountClient(client)),
	});
}

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
	vi.restoreAllMocks();
});
async function setup(
	client: AniListClient = {
		request: async () => ({ Viewer: { id: 7, name: "First" } }),
	},
	logger?: Logger,
) {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-tracking-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const database = ApplicationDatabase.openMemory();
	cleanup.push(() => database.close());
	const app = await createTrackingModule({
		dataDir,
		store: database.tracking,
		listStore: database.trackingLists,
		operationStore: database.trackingOperations,
		...createAniListTracking(client),
		...(logger ? { logger } : {}),
	});
	cleanup.push(() => app.close());
	return { app, database, dataDir };
}
async function connect(
	app: import("../src/modules/anime/tracking/public.js").TrackingAccountsApi,
	session = "one",
	token = "fixture-first",
) {
	const preview = await app.preview(session, token);
	return app.confirm(session, preview.candidateId, preview.generation);
}

test("credentials survive restart, remain private and never enter SQLite or public responses", async () => {
	const { app, database, dataDir } = await setup();
	const initial = app.status();
	expect(initial.state).toBe("disconnected");
	const result = await connect(app);
	expect(result.account).toEqual({ id: "anilist:7", name: "First" });
	expect(result.generation).not.toBe(initial.generation);
	expect(JSON.stringify(result)).not.toContain("fixture-first");
	expect(JSON.stringify(database.tracking.get())).not.toContain(
		"fixture-first",
	);
	const file = (await readdir(join(dataDir, "tracking-credentials")))[0];
	expect(file).toBeTruthy();
	expect(
		(await stat(join(dataDir, "tracking-credentials", file ?? ""))).mode &
			0o777,
	).toBe(0o600);
	const restarted = await createTrackingModule({
		dataDir,
		store: database.tracking,
		listStore: database.trackingLists,
		operationStore: database.trackingOperations,
		...createAniListTracking({
			request: async () => ({ Viewer: { id: 7, name: "First" } }),
		}),
	});
	cleanup.push(() => restarted.close());
	expect(restarted.status().account?.id).toBe("anilist:7");
	expect((await restarted.check()).connectivity).toBe("available");
	await restarted.disconnect(restarted.status().generation);
	expect(await readdir(join(dataDir, "tracking-credentials"))).toEqual([]);
	expect(restarted.status().account).toBeNull();
});

test("preview is bound to session, expires, and invalid replacement preserves the current account", async () => {
	let now = Date.now();
	const { app, database, dataDir } = await setup();
	await connect(app);
	const credentials = new TrackingCredentialFiles(dataDir);
	const tracking = createAccounts({
		store: database.tracking,
		credentials,
		now: () => now,
		client: {
			request: async (_q, _v, options) => {
				if (options.token === "invalid")
					throw new AniListError({
						code: "unauthorized",
						message: "withheld",
						retryAt: null,
					});
				return { Viewer: { id: 8, name: "Second" } };
			},
		},
	});
	cleanup.push(() => tracking.close());
	const preview = await tracking.preview("one", "second");
	await expect(
		tracking.confirm("two", preview.candidateId, preview.generation),
	).rejects.toMatchObject({ code: "TRACKING_CONFLICT" });
	now += 5 * 60_000;
	await expect(
		tracking.confirm("one", preview.candidateId, preview.generation),
	).rejects.toMatchObject({ code: "TRACKING_CONFLICT" });
	await expect(tracking.preview("one", "invalid")).rejects.toMatchObject({
		code: "TRACKING_AUTHORIZATION_REQUIRED",
	});
	expect(tracking.status().account?.id).toBe("anilist:7");
});

test("disconnect fences an in-flight preview and a stale confirmation", async () => {
	let resolve: (value: unknown) => void = () => {};
	const { app } = await setup({
		request: () =>
			new Promise((done) => {
				resolve = done;
			}),
	});
	const generation = app.status().generation;
	const preview = app.preview("one", "fixture-token");
	const rejected = expect(preview).rejects.toMatchObject({
		code: "TRACKING_CONFLICT",
	});
	await app.disconnect(generation);
	resolve({ Viewer: { id: 7, name: "First" } });
	await rejected;
	expect(app.status().account).toBeNull();
	await expect(app.disconnect(generation)).rejects.toMatchObject({
		code: "TRACKING_CONFLICT",
	});
});

test("old account checks cannot replace a new account; invalid credentials require reconnect", async () => {
	let delayed: ((value: unknown) => void) | undefined;
	let mode = "first";
	const client: AniListClient = {
		request: async (_q, _v, options) => {
			if (mode === "delay" && options.token === "fixture-first")
				return new Promise((resolve) => {
					delayed = resolve;
				});
			if (mode === "unauthorized")
				throw new AniListError({
					code: "unauthorized",
					message: "secret omitted",
					retryAt: null,
				});
			return {
				Viewer:
					options.token === "second"
						? { id: 8, name: "Second" }
						: { id: 7, name: "First" },
			};
		},
	};
	const { app } = await setup(client);
	await connect(app);
	mode = "delay";
	const checking = app.check();
	const rejected = expect(checking).rejects.toMatchObject({
		code: "TRACKING_CONFLICT",
	});
	await vi.waitFor(() => expect(delayed).toBeTypeOf("function"));
	const preview = await app.preview("one", "second");
	await app.confirm("one", preview.candidateId, preview.generation);
	delayed?.({ Viewer: { id: 7, name: "First" } });
	await rejected;
	expect(app.status().account?.id).toBe("anilist:8");
	mode = "unauthorized";
	await expect(app.check()).rejects.toMatchObject({
		code: "TRACKING_AUTHORIZATION_REQUIRED",
	});
	expect(app.status().state).toBe("authorization-required");
});

test("missing/mismatched credential fails closed on startup; unreferenced files are removed", async () => {
	const { app, database, dataDir } = await setup();
	await connect(app);
	const id = database.tracking.get()?.credentialId;
	const file = join(dataDir, "tracking-credentials", `${id}.json`);
	await writeFile(
		file,
		JSON.stringify({
			generation: "wrong",
			accountId: "anilist:7",
			token: "fixture-token",
		}),
	);
	const restarted = await createTrackingModule({
		dataDir,
		store: database.tracking,
		listStore: database.trackingLists,
		operationStore: database.trackingOperations,
		...createAniListTracking({
			request: async () => {
				throw new Error("Must not query an invalid credential");
			},
		}),
	});
	cleanup.push(() => restarted.close());
	expect(restarted.status().state).toBe("authorization-required");
	await expect(restarted.check()).rejects.toMatchObject({
		code: "TRACKING_AUTHORIZATION_REQUIRED",
	});
});

test("HTTP routes require the Anishelf session and CSRF, bind previews to sessions, and withhold tokens", async () => {
	const { app: tracking, database, dataDir } = await setup();
	let logs = "";
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				logs += line;
			},
		},
	);
	const auth = await createAuthenticationModule({
		logger,
		dataDir,
		secure: false,
		store: database.authentication,
		sources: { version: async () => "one" },
	});
	const http = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		policy: builtinPolicy,
		configure: auth.registerHttp,
		registrations: [
			(scope) => {
				registerTrackingRoutes(scope, tracking);
				registerTrackingListRoutes(scope, tracking);
				registerTrackingUpdateRoutes(scope, tracking);
			},
		],
		closeDependencies: async () => {},
	});
	cleanup.push(() => http.close());
	expect(
		(
			await http.inject({
				url: "/api/tracking/account",
				headers: { host: "127.0.0.1:3000" },
			})
		).statusCode,
	).toBe(401);

	for (const url of [
		"/api/tracking/entries/anilist%3Aanime%3A1",
		"/api/tracking/operations",
	]) {
		expect(
			(await http.inject({ url, headers: { host: "127.0.0.1:3000" } }))
				.statusCode,
		).toBe(401);
	}
	const headers = { host: "127.0.0.1:3000" };
	async function login() {
		const session = await http.inject({ url: "/api/auth/session", headers });
		const cookie = session.cookies
			.map((value) => `${value.name}=${encodeURIComponent(value.value)}`)
			.join("; ");
		const response = await http.inject({
			url: "/api/auth/login",
			method: "POST",
			headers: { ...headers, cookie, "x-csrf-token": session.json().csrfToken },
			payload: { password: auth.initialPassword },
		});
		return {
			...headers,
			cookie: response.cookies
				.map((value) => `${value.name}=${encodeURIComponent(value.value)}`)
				.join("; "),
			"x-csrf-token": response.json().csrfToken as string,
		};
	}
	const one = await login();
	const two = await login();
	expect(
		(
			await http.inject({
				url: "/api/tracking/account/preview",
				method: "POST",
				headers: { host: one.host, cookie: one.cookie },
				payload: { credential: "fixture-token" },
			})
		).statusCode,
	).toBe(403);
	const preview = await http.inject({
		url: "/api/tracking/account/preview",
		method: "POST",
		headers: one,
		payload: { credential: "fixture-token" },
	});
	expect(preview.statusCode).toBe(200);
	expect(preview.body).not.toContain("fixture-token");
	const body = preview.json();
	const payload = {
		candidateId: body.candidateId,
		generation: body.generation,
	};
	expect(
		(
			await http.inject({
				url: "/api/tracking/account/confirm",
				method: "POST",
				headers: two,
				payload,
			})
		).statusCode,
	).toBe(409);
	const confirmed = await http.inject({
		url: "/api/tracking/account/confirm",
		method: "POST",
		headers: one,
		payload,
	});
	expect(confirmed.statusCode).toBe(200);
	expect(confirmed.body).not.toContain("fixture-token");
	expect(logs).not.toContain("fixture-token");
	expect(confirmed.headers["cache-control"]).toBe("no-store");
	const status = confirmed.json();
	const updateUrl = "/api/tracking/entries/anilist%3Aanime%3A1/updates";
	const updatePayload = {
		commandId: randomUUID(),
		generation: status.generation,
		revision: null,
		baseline: null,
		desired: { progress: 0, status: "watching" },
	};
	expect(
		(
			await http.inject({
				url: updateUrl,
				method: "POST",
				headers: { host: one.host, cookie: one.cookie },
				payload: updatePayload,
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await http.inject({
				url: updateUrl,
				method: "POST",
				headers: one,
				payload: { ...updatePayload, desired: {} },
			})
		).statusCode,
	).toBe(400);
	expect(
		(
			await http.inject({
				url: updateUrl,
				method: "POST",
				headers: one,
				payload: { ...updatePayload, desired: { progress: -1 } },
			})
		).statusCode,
	).toBe(400);
	const accepted = await http.inject({
		url: updateUrl,
		method: "POST",
		headers: one,
		payload: updatePayload,
	});
	expect(accepted.statusCode).toBe(200);
	expect(accepted.json().state).toBe("pending");
	expect(accepted.json()).not.toHaveProperty("attempt");
	expect(accepted.headers["cache-control"]).toBe("no-store");
	expect(
		(
			await http.inject({
				url: updateUrl,
				method: "POST",
				headers: one,
				payload: updatePayload,
			})
		).statusCode,
	).toBe(200);
	const operations = await http.inject({
		url: `/api/tracking/operations?generation=${status.generation}`,
		headers: one,
	});
	expect(operations.statusCode).toBe(200);
	expect(operations.body).not.toContain("fixture-token");
	expect(operations.json()[0]).not.toHaveProperty("attempt");

	const cached = await http.inject({
		url: "/api/tracking/entries/anilist%3Aanime%3A1",
		headers: one,
	});
	expect(cached.statusCode).toBe(200);
	expect(cached.headers["cache-control"]).toBe("no-store");
	expect(cached.body).not.toContain("fixture-token");
	expect(
		(
			await http.inject({
				url: "/api/tracking/refresh",
				method: "POST",
				headers: { host: one.host, cookie: one.cookie },
				payload: {},
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await http.inject({
				url: `/api/tracking/entries/anilist%3Aanime%3A1?generation=${body.generation}`,
				headers: one,
			})
		).statusCode,
	).toBe(409);

	expect(
		(
			await http.inject({
				url: "/api/tracking/account",
				method: "DELETE",
				headers: one,
				payload: { generation: status.generation },
			})
		).statusCode,
	).toBe(200);
});

test("account lifecycle diagnostics record safe outcomes without tokens, sessions, names or provider errors", async () => {
	let output = "";
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				output += line;
			},
		},
	);
	let invalid = false;
	const { app } = await setup(
		{
			request: async () => {
				if (invalid)
					throw new AniListError({
						code: "unauthorized",
						message: "raw-provider-token-sentinel",
						retryAt: null,
					});
				return { Viewer: { id: 7, name: "private-account-name-sentinel" } };
			},
		},
		logger,
	);
	const preview = await app.preview(
		"private-session-sentinel",
		"private-token-sentinel",
	);
	await app.confirm(
		"private-session-sentinel",
		preview.candidateId,
		preview.generation,
	);
	await app.check();
	invalid = true;
	await expect(app.check()).rejects.toMatchObject({
		code: "TRACKING_AUTHORIZATION_REQUIRED",
	});
	await expect(
		app.confirm(
			"private-session-sentinel",
			preview.candidateId,
			preview.generation,
		),
	).rejects.toMatchObject({ code: "TRACKING_CONFLICT" });
	await app.disconnect(app.status().generation);
	const records = output
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(records).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "tracking.operation_started",
				operation: "preview",
				level: 20,
			}),
			expect.objectContaining({
				event: "tracking.account_previewed",
				accountId: "anilist:7",
				level: 30,
			}),
			expect.objectContaining({
				event: "tracking.operation_succeeded",
				operation: "confirm",
			}),
			expect.objectContaining({
				event: "tracking.connection_checked",
				level: 20,
			}),
			expect.objectContaining({
				event: "tracking.authorization_required",
				phase: "check",
				level: 40,
			}),
			expect.objectContaining({
				event: "tracking.operation_failed",
				operation: "check",
				code: "TRACKING_AUTHORIZATION_REQUIRED",
			}),
			expect.objectContaining({
				event: "tracking.operation_rejected",
				operation: "confirm",
				code: "TRACKING_CONFLICT",
				level: 20,
			}),
			expect.objectContaining({
				event: "tracking.account_disconnected",
				level: 30,
			}),
		]),
	);
	for (const secret of [
		"private-session-sentinel",
		"private-token-sentinel",
		"private-account-name-sentinel",
		"raw-provider-token-sentinel",
		preview.candidateId,
	])
		expect(output).not.toContain(secret);
});

test("failed persistence and previously silent credential cleanup emit safe diagnostics", async () => {
	let output = "";
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				output += line;
			},
		},
	);
	const { database, dataDir } = await setup();
	const credentials = new TrackingCredentialFiles(dataDir);
	const removal = vi
		.spyOn(credentials, "remove")
		.mockRejectedValue(new Error("private-credential-path-sentinel"));
	const service = createAccounts({
		store: database.tracking,
		credentials,
		logger,
		client: { request: async () => ({ Viewer: { id: 7, name: "First" } }) },
	});
	cleanup.push(() => service.close());
	const preview = await service.preview("one", "private-token-sentinel");
	const saving = vi
		.spyOn(database.tracking, "save")
		.mockImplementationOnce(() => {
			throw new Error("raw-sql-parameters-sentinel");
		});
	await expect(
		service.confirm("one", preview.candidateId, preview.generation),
	).rejects.toMatchObject({ code: "TRACKING_UNAVAILABLE" });
	saving.mockRestore();
	removal.mockRestore();
	expect(output).toContain('"event":"tracking.persistence_failed"');
	expect(output).toContain('"event":"tracking.credential_cleanup_failed"');
	expect(output).toContain('"phase":"rollback"');
	expect(output).not.toContain("private-credential-path-sentinel");
	expect(output).not.toContain("raw-sql-parameters-sentinel");
	expect(output).not.toContain("private-token-sentinel");
});

test("a superseded preview cannot overwrite the latest candidate for the same session", async () => {
	let finish: ((value: unknown) => void) | undefined;
	const { app } = await setup({
		request: async (_query, _variables, options) =>
			options.token === "older"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: { Viewer: { id: 8, name: "Latest" } },
	});
	const older = app.preview("one", "older");
	const rejected = expect(older).rejects.toMatchObject({
		code: "TRACKING_CONFLICT",
	});
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	const latest = await app.preview("one", "latest");
	finish?.({ Viewer: { id: 7, name: "Older" } });
	await rejected;
	expect(
		(await app.confirm("one", latest.candidateId, latest.generation)).account
			?.id,
	).toBe("anilist:8");
});

test("an older check cannot publish after a newer check for the same connection", async () => {
	let finish: ((value: unknown) => void) | undefined;
	let checks = 0;
	const { app } = await setup({
		request: async () => {
			checks++;
			if (checks === 2)
				return new Promise((resolve) => {
					finish = resolve;
				});
			return { Viewer: { id: 7, name: checks === 1 ? "Initial" : "Latest" } };
		},
	});
	await connect(app);
	const older = app.check();
	const rejected = expect(older).rejects.toMatchObject({
		code: "TRACKING_CONFLICT",
	});
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	await app.check();
	finish?.({ Viewer: { id: 7, name: "Older" } });
	await rejected;
	expect(app.status().account?.name).toBe("Latest");
	expect(app.status().connectivity).toBe("available");
});

test("shutdown waits for in-flight credential publication and rolls it back", async () => {
	const { database, dataDir } = await setup();
	const credentials = new TrackingCredentialFiles(dataDir);
	const write = credentials.write.bind(credentials);
	let finish: (() => void) | undefined;
	vi.spyOn(credentials, "write").mockImplementation(
		async (connection, token) => {
			await write(connection, token);
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
	);
	const app = createAccounts({
		store: database.tracking,
		credentials,
		client: { request: async () => ({ Viewer: { id: 7, name: "Fixture" } }) },
	});
	cleanup.push(() => app.close());
	const preview = await app.preview("one", "fixture");
	const pending = app.confirm("one", preview.candidateId, preview.generation);
	const rejected = expect(pending).rejects.toMatchObject({
		code: "TRACKING_UNAVAILABLE",
	});
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	let stopped = false;
	const stopping = app.close().then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(stopped).toBe(false);
	finish?.();
	await rejected;
	await stopping;
	expect(database.tracking.get()?.account).toBeNull();
	expect(await readdir(join(dataDir, "tracking-credentials"))).toEqual([]);
});
