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
import { SubscriptionDiscovery } from "../src/modules/acquisition/subscriptions/application/discovery.js";
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
	let defaultProfileId = config.profileId;
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
			now: () => clock,
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
			defaultProfileId: () => defaultProfileId,
			downloadTarget: () => destination,
			onRemoved: (key) => watching?.manualRemove(key),
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
				subscriptions.saveAtomically(input, commit);
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
		setDefaultProfile: (value: string) => {
			defaultProfileId = value;
		},
		advance: () => {
			clock += 3600000;
		},
	};
}

test("Watching only accepts the subscription default and fences default changes before confirmation and new creation", async () => {
	const f = await fixture();
	await expect(
		f.watching.preview("session", f.watching.status().revision, {
			...config,
			profileId: "custom:independent",
		}),
	).rejects.toThrow(/Preview and confirm/);
	const preview = await f.watching.preview(
		"session",
		f.watching.status().revision,
		config,
	);
	f.setDefaultProfile("custom:new-default");
	expect(() => f.watching.confirm("session", preview.id)).toThrow(
		/Preview and confirm/,
	);
	f.setDefaultProfile(config.profileId);
	await f.enable();
	await f.watching.tick();
	const existing = f.db.acquisition.subscription(workKey);
	f.setDefaultProfile("custom:new-default");
	f.snapshot.entries.push({
		workKey: "anilist:anime:2",
		title: "Another work",
		status: "watching",
		progress: 0,
	});
	f.snapshot.revision = "default-changed";
	expect(f.watching.status().reason).toBe("profile_changed");
	await f.watching.tick();
	expect(f.db.acquisition.subscription("anilist:anime:2")).toBeNull();
	expect(f.db.acquisition.subscription(workKey)).toEqual(existing);
});

test("default-off previews do not search; Watching creates an ordinary pending subscription", async () => {
	const f = await fixture();
	await f.watching.tick();
	expect(f.refresh).not.toHaveBeenCalled();
	const preview = await f.watching.preview("session", "unconfigured", config);
	expect(f.search).not.toHaveBeenCalled();
	expect(() => f.watching.confirm("other", preview.id)).toThrow();
	f.watching.confirm("session", preview.id);
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toMatchObject({
		feedId: null,
		startEpisode: 3,
		enabled: true,
		createdBy: "watching",
	});
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
	expect(f.search).not.toHaveBeenCalled();
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.authorization(workKey)).toMatchObject({
		startEpisode: 3,
		destinationRevision: "destination",
	});
});

test("empty discovery retains intent, freezes its creation scope, retries and survives reopen", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	f.search.mockResolvedValueOnce({
		entries: [],
		outcome: "no_match",
		coverage: { limited: false, reason: null, pages: 1, queries: 1 },
	});
	await f.subscriptions.resolvePending();
	expect(f.subscriptions.get(workKey).subscription).toMatchObject({
		sourceKind: "automatic",
		startEpisode: 3,
		error: "no_eligible_source",
	});
	required(f.snapshot.entries[0]).progress = 10;
	f.snapshot.revision = "new";
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)?.startEpisode).toBe(3);
	await f.watching.close();
	await f.subscriptions.close();
	await f.sources.runtime.close();
	f.db.close();
	const reopened = await f.open();
	expect(reopened.subscriptions.get(workKey).discovery?.attempts).toEqual([
		expect.objectContaining({ providerId: "nyaasi", outcome: "no_match" }),
	]);
	expect(
		reopened.subscriptions.get(workKey, 1, false).discovery,
	).toBeUndefined();
	f.advance();
	await reopened.subscriptions.resolvePending();
	expect(reopened.db.acquisition.authorization(workKey)?.startEpisode).toBe(3);
	const saved = reopened.db.acquisition.subscription(workKey);
	await reopened.watching.tick();
	await reopened.subscriptions.resolvePending();
	expect(reopened.db.acquisition.subscription(workKey)).toEqual(saved);
	expect(f.search).toHaveBeenCalledTimes(2);
});

test("Watching status, account changes and disable affect creation only; manual pause survives edits", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	const saved = required(f.db.acquisition.subscription(workKey));
	for (const status of ["paused", "completed", "dropped", "watching"]) {
		required(f.snapshot.entries[0]).status = status;
		f.snapshot.revision = status;
		await f.watching.tick();
		expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
			true,
		);
	}
	f.watching.disable(f.watching.status().revision);
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(true);
	f.snapshot.accountId = "different";
	f.snapshot.generation = "different";
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(true);
	const paused = await f.subscriptions.setEnabled(
		workKey,
		saved.revision,
		false,
	);
	const edited = await f.subscriptions.save({
		workKey,
		revision: paused.subscription?.revision ?? null,
		source: null,
		startEpisode: 2,
		profileId: config.profileId,
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	expect(edited.subscription?.enabled).toBe(false);
	expect(edited.subscription?.startEpisode).toBe(2);
});

test("manual automatic-source subscriptions save before discovery and share the same pipeline", async () => {
	const f = await fixture();
	const saved = await f.subscriptions.save({
		workKey,
		revision: null,
		source: { kind: "automatic" },
		startEpisode: 1,
		profileId: config.profileId,
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	expect(saved.subscription).toMatchObject({
		sourceKind: "automatic",
		feedId: null,
		startEpisode: 1,
	});
	expect(f.search).not.toHaveBeenCalled();
	await f.enable();
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)?.revision).toBe(
		saved.subscription?.revision,
	);
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.authorization(workKey)?.startEpisode).toBe(1);
});

test("unsubscribe suppresses automatic recreation; explicit inclusion allows a new subscription", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.remove(
		workKey,
		required(f.db.acquisition.subscription(workKey)).revision,
	);
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
	const row = required(f.watching.status().works[0]);
	expect(row.excluded).toBe(true);
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

test.each(["destination", "source"])(
	"pending discovery cannot inherit changed %s configuration",
	async (change) => {
		const f = await fixture();
		await f.enable();
		await f.watching.tick();
		if (change === "destination") f.destination.revision = "changed";
		else
			await f.sources.api.connector.clear(
				f.sources.api.connector.settings().generation,
			);
		await f.subscriptions.resolvePending();
		expect(f.db.acquisition.authorization(workKey)).toBeNull();
		expect(f.subscriptions.get(workKey).subscription?.error).toBe(
			"authorization_required",
		);
		expect(f.search).not.toHaveBeenCalled();
	},
);

test.each(["remove", "edit", "pause"])(
	"late discovery cannot bind after user %s",
	async (action) => {
		const f = await fixture();
		await f.enable();
		await f.watching.tick();
		let release: (() => void) | undefined;
		const implementation = required(f.search.getMockImplementation());
		f.search.mockImplementationOnce(async (...args) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return implementation(...args);
		});
		const pending = f.subscriptions.resolvePending();
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		const sub = required(f.db.acquisition.subscription(workKey));
		if (action === "remove")
			await f.subscriptions.remove(workKey, sub.revision);
		else if (action === "pause")
			await f.subscriptions.setEnabled(workKey, sub.revision, false);
		else
			await f.subscriptions.save({
				workKey,
				revision: sub.revision,
				source: { kind: "feed", url: "https://example.org/new" },
				startEpisode: 1,
				target: null,
			});
		release?.();
		await pending;
		expect(f.db.acquisition.authorization(workKey)).toBeNull();
		if (action === "remove")
			expect(f.db.acquisition.subscription(workKey)).toBeNull();
		else
			expect(
				f.db.acquisition.subscription(workKey)?.sourceInput?.kind,
			).not.toBe("search");
	},
);

test("failed authorization rolls back source binding while keeping pending intent", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	vi.spyOn(f.db.acquisition, "authorize").mockImplementationOnce(() => {
		throw Error("injected failure");
	});
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.subscription(workKey)).toMatchObject({
		feedId: null,
		lastError: "discovery_unavailable",
		startEpisode: 3,
	});
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
});

test("invalid progress does not starve eligible work or fabricate a starting episode", async () => {
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
	expect(f.db.acquisition.subscription(workKey)?.startEpisode).toBe(3);
	expect(f.db.acquisition.subscriptions()).toHaveLength(1);
});

test("stale, expired and changed-account activation scopes cannot create subscriptions", async () => {
	const f = await fixture();
	const preview = await f.watching.preview("session", "unconfigured", config);
	f.advance();
	expect(() => f.watching.confirm("session", preview.id)).toThrow();
	await f.enable();
	f.snapshot.accountId = "other";
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
});

test("capacity and Tracking backoff are respected without discovery", async () => {
	const f = await fixture();
	await f.enable();
	const capacity = vi
		.spyOn(f.subscriptions, "hasCapacity")
		.mockReturnValue(false);
	await f.watching.tick();
	expect(f.watching.status().works[0]?.reason).toBe("subscription_limit");
	capacity.mockReturnValue(true);
	f.snapshot.fresh = false;
	f.snapshot.refreshAllowed = false;
	f.refresh.mockClear();
	await f.watching.tick();
	expect(f.refresh).not.toHaveBeenCalled();
	f.snapshot.fresh = true;
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).not.toBeNull();
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

test("manual refresh reevaluates cached discovery and refetches only after expiry", async () => {
	const f = await fixture();
	const discover = vi.spyOn(SubscriptionDiscovery.prototype, "search");
	await f.enable();
	await f.watching.tick();
	f.search.mockResolvedValueOnce({
		entries: [],
		outcome: "no_match",
		coverage: { limited: true, reason: "item_limit", pages: 1, queries: 1 },
	});
	await f.subscriptions.resolvePending();
	expect(discover).toHaveBeenCalledTimes(1);
	expect(f.subscriptions.get(workKey).discovery?.attempts[0]).toMatchObject({
		outcome: "no_match",
		limited: true,
	});
	await f.subscriptions.resolvePending();
	expect(discover).toHaveBeenCalledTimes(1);
	const revision = required(f.db.acquisition.subscription(workKey)).revision;
	await f.subscriptions.refresh(workKey, revision);
	expect(discover).toHaveBeenCalledTimes(2);
	expect(f.subscriptions.get(workKey).discovery?.attempts[0]).toMatchObject({
		outcome: "no_match",
	});
	expect(f.search).toHaveBeenCalledTimes(1);
	f.advance();
	await f.subscriptions.refresh(workKey, revision);
	expect(f.search).toHaveBeenCalledTimes(2);
	expect(f.subscriptions.get(workKey).discovery?.attempts[0]).toMatchObject({
		outcome: "matched",
	});
	expect(f.db.acquisition.authorization(workKey)).not.toBeNull();
});
