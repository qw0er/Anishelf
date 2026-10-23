import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import { createSourcesModule } from "../src/modules/acquisition/sources/create.js";
import { JackettConnection } from "../src/modules/acquisition/sources/jackett/connection.js";
import { SubscriptionsApplication } from "../src/modules/acquisition/subscriptions/application/application.js";
import { WatchingApplication } from "../src/modules/acquisition/watching/application/application.js";
import { registerWatchingRoutes } from "../src/modules/acquisition/watching/http/routes.js";
import type { WatchingSnapshot } from "../src/modules/acquisition/watching/public.js";
import type { AcquisitionTarget } from "../src/modules/anime/public.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});
function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Missing fixture value");
	return value;
}
const workKey = "anilist:anime:1";
const config = { backlog: "progress" as const, profileId: "custom:instant" };
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-watching-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	let clock = 1000000;
	const snapshot: WatchingSnapshot = {
		accountId: "tracking-account",
		generation: "tracking-generation",
		revision: "snapshot-one",
		complete: true,
		fresh: true,
		refreshAllowed: true,
		retryAt: null,
		entries: [{ workKey, title: "Frieren", status: "watching", progress: 2 }],
	};
	const logger = pino({ level: "silent" });
	const search = vi
		.spyOn(JackettConnection.prototype, "search")
		.mockImplementation(async () => ({
			entries: [
				{
					id: "entry",
					observationId: "entry",
					title: "Frieren - 03",
					publishedAt: null,
					downloadUrl: null,
					hash: "a".repeat(40),
					download: {
						kind: "magnet",
						uri: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
					},
				},
			],
			outcome: "matches",
			coverage: { limited: false, reason: null, pages: 1, queries: 1 },
		}));
	const target: AcquisitionTarget = {
		work: {
			reference: { provider: "anilist", mediaType: "anime", id: "1" },
			snapshotId: "metadata",
			titles: ["Frieren"],
			year: 2023,
			format: "TV",
			episodeCount: 28,
			season: null,
			part: null,
		},
		availableEpisodes: [],
		revision: "target",
	};
	let fingerprint = "profile-one";
	const destination = {
		revision: "destination",
		connectionGeneration: "downloader",
		validated: true,
		path: "/downloads",
	};
	const refresh = vi.fn(async () => structuredClone(snapshot));
	async function open() {
		const db = ApplicationDatabase.open(directory);
		cleanup.push(() => db.close());
		const sources = await createSourcesModule({
			dataDir: directory,
			store: db.acquisition,
			logger,
			now: () => clock,
		});
		cleanup.push(() => sources.runtime.close());
		if (!sources.api.connector.settings().ready)
			await sources.api.connector.save({
				generation: sources.api.connector.settings().generation,
				url: "http://jackett:9117",
				apiKey: "private-key",
				origin: "external",
				providers: ["nyaasi"],
			});
		let watching: WatchingApplication;
		const subscriptions = new SubscriptionsApplication({
			store: db.acquisition,
			sources: sources.api,
			anime: {
				target: async () => target,
				assessReleaseTitle: () => ({
					episode: 3,
					eligible: true,
					reasons: [],
					version: "v1",
				}),
			},
			downloads: async () => [],
			logger,
			profiles: [
				{
					id: config.profileId,
					name: "Instant",
					levels: [{ name: "Any", match: {}, acceptAfterMinutes: 0 }],
				},
			],
			defaultProfileId: () => config.profileId,
			downloadTarget: () => destination,
			management: {
				enabled: (sub) => watching?.enabled(sub) ?? sub.enabled,
				status: (key) => watching?.management(key) ?? null,
				saved: (key) => watching?.manualSave(key),
				removed: (key) => watching?.manualRemove(key),
				toggled: (key, enabled, revision) =>
					watching?.manualToggle(key, enabled, revision),
			},
		});
		cleanup.push(() => subscriptions.close());
		watching = new WatchingApplication({
			store: db.acquisition.watching,
			hasCapacity: () => subscriptions.hasCapacity(),
			transaction: (operation) => db.acquisition.transaction(operation),
			tracking: { snapshot: () => structuredClone(snapshot), refresh },
			sources: sources.api,
			subscriptions,
			subscription: (key) => db.acquisition.subscription(key),
			admit: (input, commit) => {
				subscriptions.admitManaged(input, commit);
			},
			target: () => destination,
			profileFingerprint: () => fingerprint,
			logger,
			now: () => clock,
		});
		cleanup.push(() => watching.close());
		return { db, sources, subscriptions, watching };
	}
	const f = await open();
	const enable = async () => {
		const preview = await f.watching.preview(
			"session",
			f.watching.status().revision,
			config,
		);
		f.watching.confirm("session", preview.id);
		return preview;
	};
	return {
		...f,
		directory,
		logger,
		snapshot,
		search,
		refresh,
		open,
		enable,
		destination,
		setFingerprint: (value: string) => {
			fingerprint = value;
		},
		advance: () => {
			clock += 3600000;
		},
	};
}

test("automation is disabled by default; session-bound previews do not authorize or search", async () => {
	const f = await fixture();
	await f.watching.tick();
	expect(f.refresh).not.toHaveBeenCalled();
	expect(f.search).not.toHaveBeenCalled();
	const preview = await f.watching.preview("session", "unconfigured", config);
	expect(preview.works[0]?.startEpisode).toBe(3);
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
	expect(f.search).not.toHaveBeenCalled();
	expect(() => f.watching.confirm("other-session", preview.id)).toThrow();
	f.watching.confirm("session", preview.id);
	await f.watching.tick();
	expect(f.db.acquisition.authorization(workKey)).toMatchObject({
		startEpisode: 3,
		destinationRevision: "destination",
		connectionGeneration: "downloader",
	});
	expect(f.subscriptions.get(workKey).automation).toMatchObject({
		managed: true,
		reason: "managed",
	});
	expect(f.subscriptions.get(workKey).subscription?.enabled).toBe(true);
});

test("reconciliation is idempotent, freezes starting scope and survives reopen", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	const sub = f.db.acquisition.subscription(workKey);
	required(f.snapshot.entries[0]).progress = 10;
	f.snapshot.revision = "snapshot-two";
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toEqual(sub);
	expect(f.search).toHaveBeenCalledTimes(1);
	await f.watching.close();
	await f.subscriptions.close();
	await f.sources.runtime.close();
	f.db.close();
	const reopened = await f.open();
	await reopened.watching.tick();
	expect(reopened.db.acquisition.subscription(workKey)).toEqual(sub);
	expect(reopened.watching.status().enabled).toBe(true);
	expect(f.search).toHaveBeenCalledTimes(1);
});

test("tracking statuses suspend only managed acquisition and manual pauses survive returning to Watching", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	required(f.snapshot.entries[0]).status = "paused";
	f.snapshot.revision = "two";
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	required(f.snapshot.entries[0]).status = "watching";
	f.snapshot.revision = "three";
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(true);
	const sub = required(f.db.acquisition.subscription(workKey));
	await f.subscriptions.setEnabled(workKey, sub.revision, false);
	required(f.snapshot.entries[0]).status = "completed";
	await f.watching.tick();
	required(f.snapshot.entries[0]).status = "watching";
	await f.watching.tick();
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	expect(f.watching.status().works[0]?.paused).toBe(true);
});

test("outages, partial snapshots, removals and account changes never erase subscriptions or inherit permission", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	const sub = f.db.acquisition.subscription(workKey);
	for (const changes of [
		{ fresh: false },
		{ fresh: true, complete: false },
		{ complete: true, accountId: "different-account" },
	]) {
		Object.assign(f.snapshot, changes);
		await f.watching.tick();
		expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
			false,
		);
		expect(f.db.acquisition.subscription(workKey)).toEqual(sub);
	}
	Object.assign(f.snapshot, {
		accountId: "tracking-account",
		fresh: true,
		complete: true,
		revision: "removed",
		entries: [],
	});
	await f.watching.tick();
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	expect(f.db.acquisition.subscription(workKey)).toEqual(sub);
});

test("removing a managed subscription records a durable exclusion; only explicit inclusion allows recreation", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	const revision = required(f.db.acquisition.subscription(workKey)).revision;
	await f.subscriptions.remove(workKey, revision);
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
	expect(f.watching.status().works[0]?.excluded).toBe(true);
	const row = required(f.watching.status().works[0]);
	f.watching.override({
		accountId: required(f.snapshot.accountId),
		trackingGeneration: f.snapshot.generation,
		workKey,
		revision: row.revision,
		excluded: false,
		paused: false,
	});
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).not.toBeNull();
});

test("global disable stops new managed eligibility immediately while preserving manual subscriptions", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	f.watching.disable(f.watching.status().revision);
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	const sub = required(f.db.acquisition.subscription(workKey));
	await f.subscriptions.save({
		workKey,
		revision: sub.revision,
		startEpisode: 3,
		source: null,
		profileId: config.profileId,
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(true);
	expect(f.watching.status().works[0]?.managed).toBe(false);
});

test("source, profile and destination changes invalidate accepted grants and stale previews", async () => {
	const f = await fixture();
	const preview = await f.enable();
	await f.watching.tick();
	f.setFingerprint("new-policy");
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	expect(f.watching.status().reason).toBe("profile_changed");
	f.setFingerprint("profile-one");
	f.destination.revision = "changed";
	expect(f.watching.status().reason).toBe("destination_changed");
	f.destination.revision = "destination";
	await f.sources.api.connector.clear(
		f.sources.api.connector.settings().generation,
	);
	expect(f.watching.status().reason).toBe("source_changed");
	expect(() => f.watching.confirm("session", preview.id)).toThrow();
});

test("late discovery cannot admit a work after disable or manual exclusion", async () => {
	const f = await fixture();
	await f.enable();
	let release: (() => void) | undefined;
	f.search.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return {
			entries: [],
			outcome: "no_match",
			coverage: { limited: false, reason: null, pages: 1, queries: 1 },
		};
	});
	const pending = f.watching.tick();
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	f.watching.disable(f.watching.status().revision);
	release?.();
	await pending;
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
});

test("existing manual subscriptions are never adopted and changed preview scope must be reviewed again", async () => {
	const f = await fixture();
	const preview = await f.watching.preview("session", "unconfigured", config);
	await f.subscriptions.save({
		workKey,
		revision: null,
		startEpisode: 1,
		source: { kind: "feed", url: "https://example.org/feed" },
		target: null,
	});
	expect(() => f.watching.confirm("session", preview.id)).toThrow();
	const before = f.db.acquisition.subscription(workKey);
	await f.enable();
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toEqual(before);
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
	expect(f.search).not.toHaveBeenCalled();
});

test("unresolved discovery follows current progress until admission, then freezes it", async () => {
	const f = await fixture();
	await f.enable();
	f.search.mockResolvedValueOnce({
		entries: [],
		outcome: "no_match",
		coverage: { limited: false, reason: null, pages: 1, queries: 1 },
	});
	await f.watching.tick();
	expect(f.watching.status().works[0]?.startEpisode).toBeNull();
	required(f.snapshot.entries[0]).progress = 1;
	f.snapshot.revision = "advanced";
	f.advance();
	await f.watching.tick();
	expect(f.db.acquisition.authorization(workKey)?.startEpisode).toBe(2);
	required(f.snapshot.entries[0]).progress = 0;
	f.snapshot.revision = "later";
	await f.watching.tick();
	expect(f.db.acquisition.authorization(workKey)?.startEpisode).toBe(2);
});

test.each([-1, 1.5, 10000, Number.MAX_SAFE_INTEGER])(
	"invalid progress %s never authorizes an invented episode",
	async (progress) => {
		const f = await fixture();
		required(f.snapshot.entries[0]).progress = progress;
		const preview = await f.enable();
		expect(preview.works[0]).toMatchObject({
			startEpisode: null,
			reason: "invalid_progress",
		});
		await f.watching.tick();
		expect(f.search).not.toHaveBeenCalled();
		expect(f.db.acquisition.authorization(workKey)).toBeNull();
		expect(f.watching.status().works[0]?.reason).toBe("invalid_progress");
	},
);

test("new account cannot adopt another account's managed subscription", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	const before = f.db.acquisition.subscription(workKey);
	f.snapshot.accountId = "second-account";
	f.snapshot.generation = "second-generation";
	f.snapshot.revision = "second-snapshot";
	const preview = await f.enable();
	expect(preview.works[0]?.reason).toBe("different_account_owner");
	await f.watching.tick();
	expect(f.watching.status().works[0]?.reason).toBe("different_account_owner");
	expect(f.db.acquisition.subscription(workKey)).toEqual(before);
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
});

test.each([true, false])(
	"source renewal retains the pin only if still accepted: %s",
	async (retained) => {
		const f = await fixture();
		await f.enable();
		await f.watching.tick();
		const before = required(f.db.acquisition.subscription(workKey));
		const settings = f.sources.api.connector.settings();
		await f.sources.api.connector.save({
			generation: settings.generation,
			url: "http://new-jackett:9117",
			apiKey: "new-private-key",
			origin: "external",
			providers: retained ? ["nyaasi"] : ["other"],
		});
		expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
			false,
		);
		await f.enable();
		await f.watching.tick();
		if (retained) {
			expect(f.db.acquisition.subscription(workKey)?.sourceInput).toMatchObject(
				{
					kind: "search",
					providerId: "nyaasi",
					connectionRevision: f.sources.api.connector.settings().generation,
				},
			);
			expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
				true,
			);
		} else {
			expect(f.db.acquisition.subscription(workKey)).toEqual(before);
			expect(f.watching.status().works[0]?.reason).toBe(
				"source_reselection_required",
			);
			expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
				false,
			);
		}
		expect(f.search).toHaveBeenCalledTimes(1);
	},
);

test("expired and stale previews and stale override revisions are rejected", async () => {
	const f = await fixture();
	const preview = await f.watching.preview("session", "unconfigured", config);
	f.advance();
	expect(() => f.watching.confirm("session", preview.id)).toThrow();
	const next = await f.watching.preview("session", "unconfigured", config);
	f.snapshot.revision = "different-content";
	expect(() => f.watching.confirm("session", next.id)).toThrow();
	await f.enable();
	await f.watching.tick();
	const row = required(f.watching.status().works[0]);
	const input = {
		accountId: required(f.snapshot.accountId),
		trackingGeneration: f.snapshot.generation,
		workKey,
		revision: row.revision,
		excluded: true,
		paused: false,
	};
	f.watching.override(input);
	expect(() => f.watching.override(input)).toThrow();
});

test("Tracking backoff and non-retryable failures do not refresh on every tick; shutdown drains without waiting for a shared refresh", async () => {
	const f = await fixture();
	await f.enable();
	f.refresh.mockClear();
	f.snapshot.fresh = false;
	f.snapshot.refreshAllowed = false;
	await f.watching.tick();
	await f.watching.tick();
	expect(f.refresh).not.toHaveBeenCalled();
	f.snapshot.refreshAllowed = true;
	f.snapshot.retryAt = Number.MAX_SAFE_INTEGER;
	await f.watching.tick();
	expect(f.refresh).not.toHaveBeenCalled();
	f.snapshot.retryAt = null;
	let resolve: ((snapshot: WatchingSnapshot) => void) | undefined;
	f.refresh.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const tick = f.watching.tick();
	await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
	await f.watching.close();
	await tick;
	resolve?.(f.snapshot);
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
});

test("permission failure rolls back subscription and ownership together", async () => {
	const f = await fixture();
	await f.enable();
	vi.spyOn(f.db.acquisition, "authorize").mockImplementationOnce(() => {
		throw new Error("injected write failure");
	});
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
	expect(f.watching.status().works[0]).toMatchObject({
		managed: false,
		startEpisode: null,
		reason: "discovery_unavailable",
	});
});

test("old tombstones do not exhaust the current Watching override limit", async () => {
	const f = await fixture();
	for (let i = 2; i <= 502; i++)
		f.db.acquisition.watching.saveMember({
			accountId: required(f.snapshot.accountId),
			workKey: `anilist:anime:${i}`,
			title: "Old",
			revision: String(i),
			excluded: true,
			paused: false,
			subscriptionRevision: null,
			grantId: null,
			startEpisode: null,
			reason: "excluded",
			retryAt: 0,
		});
	f.watching.override({
		accountId: required(f.snapshot.accountId),
		trackingGeneration: f.snapshot.generation,
		workKey,
		revision: null,
		excluded: true,
		paused: false,
	});
	expect(
		f.db.acquisition.watching.member(required(f.snapshot.accountId), workKey)
			?.excluded,
	).toBe(true);
});

test("Watching HTTP routes require login, CSRF and the preview's actual session", async () => {
	const f = await fixture();
	const auth = await createAuthenticationModule({
		logger: f.logger,
		dataDir: f.directory,
		store: f.db.authentication,
		secure: false,
		sources: { version: async () => "one" },
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: f.logger,
		policy: builtinPolicy,
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

test("invalid progress does not consume the bounded admission batch or starve eligible work", async () => {
	const f = await fixture();
	f.snapshot.entries = [
		...Array.from({ length: 5 }, (_, i) => ({
			workKey: `anilist:anime:${i + 2}`,
			title: "Invalid",
			status: "watching",
			progress: 10000,
		})),
		...f.snapshot.entries,
	];
	await f.enable();
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).not.toBeNull();
	expect(f.search).toHaveBeenCalledTimes(1);
});

test("more than 500 current Watching entries blocks admission and preview without discarding state", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	const before = f.db.acquisition.subscription(workKey);
	f.snapshot.entries = Array.from({ length: 501 }, (_, i) => ({
		workKey: `anilist:anime:${i + 1}`,
		title: "Work",
		status: "watching",
		progress: 0,
	}));
	f.snapshot.revision = "overflow";
	expect(f.watching.status().reason).toBe("work_limit");
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	await f.watching.tick();
	await expect(f.enable()).rejects.toThrow("at most 500");
	expect(f.db.acquisition.subscription(workKey)).toEqual(before);
});

test("subscription capacity is actionable without searching and resumes after capacity is freed", async () => {
	const f = await fixture();
	const capacity = vi
		.spyOn(f.subscriptions, "hasCapacity")
		.mockReturnValue(false);
	await f.enable();
	await f.watching.tick();
	expect(f.watching.status().works[0]?.reason).toBe("subscription_limit");
	expect(f.search).not.toHaveBeenCalled();
	capacity.mockReturnValue(true);
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).not.toBeNull();
});
