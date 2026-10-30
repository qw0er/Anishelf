import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { AniListError } from "../../../../src/modules/anime/anilist/public.js";
import { TrackingUpdates } from "../../../../src/modules/anime/tracking/application/updates.js";
import { TrackingProviderError } from "../../../../src/modules/anime/tracking/domain/list.js";
import type { TrackingStatus } from "../../../../src/modules/anime/tracking/domain/model.js";
import type {
	TrackingRemoteState,
	TrackingUpdate,
} from "../../../../src/modules/anime/tracking/domain/operation.js";
import { aniListTracking } from "../../../../src/modules/anime/tracking/infrastructure/provider-mapping.js";
import type { TrackingUpdateProvider } from "../../../../src/modules/anime/tracking/ports.js";
import type { AniListClient } from "../../../support/anilist-fixture.js";
import { AniListUpdatesClient } from "../../../support/anilist-fixture.js";

const disposals: (() => unknown)[] = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0).reverse()) await dispose();
});
const initial: TrackingRemoteState = {
	id: "anilist:10",
	progress: 3,
	status: "watching",
	updatedAt: 100,
};
async function fixture(persistent = false) {
	const dir = persistent
		? await mkdtemp(join(tmpdir(), "anishelf-updates-"))
		: "";
	if (persistent)
		disposals.push(() => rm(dir, { recursive: true, force: true }));
	let database = persistent
		? ApplicationDatabase.open(dir)
		: ApplicationDatabase.openMemory();
	disposals.push(() => database.close());
	let remote: TrackingRemoteState | null = { ...initial };
	let now = 1000;
	const status: TrackingStatus = {
		provider: aniListTracking,
		account: { id: "anilist:7", name: "Fixture" },
		generation: randomUUID(),
		state: "connected",
		connectivity: "available",
		checkedAt: null,
	};
	let accountController = new AbortController();
	const access = {
		status: () => status,
		assertCurrent: (generation: string) => {
			if (generation !== status.generation) throw new Error("Stale account");
		},
		acquire: async () => ({
			accountId: status.account?.id ?? "",
			generation: status.generation,
			credential: "secret",
			signal: accountController.signal,
		}),
		authorizationFailed: () => {
			status.state = "authorization-required";
		},
	};
	const get = vi.fn(async () => (remote ? { ...remote } : null));
	const save = vi.fn<TrackingUpdateProvider["save"]>(
		async (_lease, _media, _id, desired) => {
			remote = { ...(remote ?? initial), ...desired, updatedAt: now };
			return { ...remote };
		},
	);
	const confirmed = vi.fn();
	const construct = () =>
		new TrackingUpdates({
			access,
			provider: { get, save },
			store: database.trackingOperations,
			now: () => now,
			random: () => 0,
			confirmed,
		});
	let worker = construct();
	disposals.push(() => worker.close());
	const input = (
		desired: TrackingUpdate["desired"],
		revision: number | null = null,
	): TrackingUpdate => ({
		generation: status.generation,
		revision,
		baseline: { ...initial },
		desired,
	});
	const operation = () => database.trackingOperations.list("anilist:7")[0];
	return {
		get,
		store: database.trackingOperations,
		save,
		confirmed,
		status,
		input,
		operation,
		get worker() {
			return worker;
		},
		setRemote(value: TrackingRemoteState | null) {
			remote = value;
		},
		advance() {
			now += 1_000_000;
		},
		switchAccount(id: string) {
			accountController.abort();
			accountController = new AbortController();
			status.account = { id, name: "Other" };
			status.generation = randomUUID();
		},
		async restart() {
			if (!persistent)
				throw new Error("Restart requires a persistent fixture.");
			await worker.close();
			database.close();
			database = ApplicationDatabase.open(dir);
			worker = construct();
			await worker.flush();
		},
	};
}
test("persists before dispatch, permits backward correction and only sends intended fields", async () => {
	const f = await fixture();
	f.worker.update("anilist:anime:1", f.input({ progress: 1 }));
	expect(f.operation()?.state).toBe("pending");
	expect(f.save).not.toHaveBeenCalled();
	await f.worker.flush();
	expect(f.operation()?.state).toBe("succeeded");
	expect(f.save.mock.calls[0]?.[3]).toEqual({ progress: 1 });
	expect(f.operation()?.remote?.progress).toBe(1);
});
test("coalesces unsent progress and status without losing explicit correction", async () => {
	const f = await fixture();
	const first = f.worker.update("anilist:anime:1", f.input({ progress: 8 }));
	f.worker.update(
		"anilist:anime:1",
		f.input({ progress: 2, status: "paused" }, first.revision),
	);
	await f.worker.flush();
	expect(f.save).toHaveBeenCalledTimes(1);
	expect(f.save.mock.calls[0]?.[3]).toEqual({ progress: 2, status: "paused" });
});
test("offline failure survives real database restart and reconciles before delivery", async () => {
	const f = await fixture(true);
	f.get.mockRejectedValueOnce(new TrackingProviderError("unavailable", null));
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await f.worker.flush();
	expect(f.operation()?.state).toBe("failed");
	f.advance();
	await f.restart();
	expect(f.operation()?.state).toBe("succeeded");
	expect(f.get).toHaveBeenCalledTimes(2);
});
test("lost successful mutation response is reconciled after restart without duplicate write", async () => {
	const f = await fixture(true);
	f.save.mockImplementationOnce(async () => {
		f.setRemote({ ...initial, progress: 4 });
		throw new TrackingProviderError("unavailable", null);
	});
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await f.worker.flush();
	expect(f.operation()?.attempt?.desired).toEqual({ progress: 4 });
	f.advance();
	await f.restart();
	expect(f.operation()?.state).toBe("succeeded");
	expect(f.save).toHaveBeenCalledTimes(1);
});
test("remote edits conflict, refresh does not discard intent, and explicit local resolution uses a fresh baseline", async () => {
	const f = await fixture();
	f.setRemote({ ...initial, progress: 6 });
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await f.worker.flush();
	expect(f.operation()?.state).toBe("conflict");
	expect(f.save).not.toHaveBeenCalled();
	const op = f.operation();
	if (!op) throw Error("missing");
	await f.worker.resolveOperation(
		op.id,
		{ generation: f.status.generation, revision: op.revision },
		false,
	);
	await f.worker.flush();
	expect(f.operation()?.state).toBe("succeeded");
	expect(f.operation()?.remote?.progress).toBe(4);
});
test("keeping remote value cancels intent and stale revisions cannot overwrite it", async () => {
	const f = await fixture();
	f.setRemote({ ...initial, progress: 6 });
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await f.worker.flush();
	const op = f.operation();
	if (!op) throw Error("missing");
	await f.worker.resolveOperation(
		op.id,
		{ generation: f.status.generation, revision: op.revision },
		true,
	);
	expect(f.operation()?.state).toBe("cancelled");
	expect(f.save).not.toHaveBeenCalled();
	expect(() =>
		f.worker.update("anilist:anime:1", f.input({ progress: 2 }, op.revision)),
	).toThrow();
});
test("unrelated remote status edits do not conflict with progress-only intent", async () => {
	const f = await fixture();
	f.setRemote({ ...initial, status: "paused" });
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await f.worker.flush();
	expect(f.operation()?.state).toBe("succeeded");
	expect(f.operation()?.remote?.status).toBe("paused");
});
test("an in-flight immutable attempt cannot clear a newer manual correction", async () => {
	const f = await fixture();
	let finish: (() => void) | undefined;
	f.save.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			finish = resolve;
		});
		f.setRemote({ ...initial, progress: 4 });
		return { ...initial, progress: 4 };
	});
	const first = f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
	f.worker.update("anilist:anime:1", f.input({ progress: 1 }, first.revision));
	finish?.();
	await f.worker.flush();

	expect(f.operation()?.remote?.progress).toBe(1);
	expect(f.operation()?.state).toBe("succeeded");
});
test("account switch fences late responses and never delivers previous account work", async () => {
	const f = await fixture();
	let finish: (() => void) | undefined;
	f.get.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			finish = resolve;
		});
		return initial;
	});
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await vi.waitFor(() => expect(f.get).toHaveBeenCalled());
	f.switchAccount("anilist:8");
	finish?.();
	await f.worker.flush();
	await f.worker.flush();
	expect(f.save).not.toHaveBeenCalled();
	expect(f.worker.operations(f.status.generation)).toEqual([]);
});
test("authorization errors pause submission; reconnect resumes the same account only", async () => {
	const f = await fixture();
	f.get.mockRejectedValueOnce(new TrackingProviderError("unauthorized", null));
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await f.worker.flush();
	expect(f.status.state).toBe("authorization-required");
	expect(f.operation()?.state).toBe("authorization-required");
	await f.worker.flush();
	expect(f.get).toHaveBeenCalledTimes(1);
	f.status.state = "connected";
	f.status.generation = randomUUID();
	await f.worker.flush();
	expect(f.operation()?.state).toBe("succeeded");
});
test("new entries require an explicit status and deleted entries conflict", async () => {
	const f = await fixture();
	expect(() =>
		f.worker.update("anilist:anime:1", {
			...f.input({ progress: 0 }),
			baseline: null,
		}),
	).toThrow();
	f.setRemote(null);
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	await f.worker.flush();
	expect(f.operation()?.state).toBe("conflict");
});
const rawState = {
	...initial,
	id: 10,
	status: "CURRENT",
	userId: 7,
	mediaId: 1,
	media: { type: "ANIME" },
};
test("protocol updates existing entry by ID and omits unrelated fields", async () => {
	const request = vi.fn<AniListClient["request"]>(async () => ({
		SaveMediaListEntry: rawState,
	}));
	await new AniListUpdatesClient({ request }).save(
		7,
		1,
		10,
		{ progress: 1 },
		"secret",
		new AbortController().signal,
	);
	expect(request.mock.calls[0]?.[1]).toEqual({ id: 10, progress: 1 });
});
test("protocol treats not-found as absent but rejects account/media/type mismatches", async () => {
	const signal = new AbortController().signal;
	const missing = new AniListUpdatesClient({
		request: async () => {
			throw new AniListError({
				code: "not-found",
				message: "none",
				retryAt: null,
			});
		},
	});
	expect(await missing.get(7, 1, "secret", signal)).toBeNull();
	for (const raw of [
		{ ...rawState, userId: 8 },
		{ ...rawState, mediaId: 2 },
		{ ...rawState, media: { type: "MANGA" } },
	]) {
		await expect(
			new AniListUpdatesClient({
				request: async () => ({ MediaList: raw }),
			}).get(7, 1, "secret", signal),
		).rejects.toBeInstanceOf(AniListError);
	}
});

test("transient attempts stop automatically after five failures and allow explicit retry", async () => {
	const f = await fixture();
	f.get.mockRejectedValue(new TrackingProviderError("rate-limited", 50_000));
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }));
	for (let i = 0; i < 5; i++) {
		await f.worker.flush();
		f.advance();
	}
	expect(f.operation()?.attempts).toBe(5);
	expect(f.operation()?.retryAt).toBeNull();
	await f.worker.flush();
	expect(f.get).toHaveBeenCalledTimes(5);
	const op = f.operation();
	if (!op) throw Error("missing");
	f.get.mockResolvedValue(initial);
	f.worker.retryOperation(op.id, {
		generation: f.status.generation,
		revision: op.revision,
	});
	await f.worker.flush();
	expect(f.operation()?.state).toBe("succeeded");
});
test("new anime entries validate the target and send explicit initial status", async () => {
	const request = vi.fn<AniListClient["request"]>(async (query) =>
		query.includes("TrackingTarget")
			? { Media: { id: 1, type: "ANIME" } }
			: { SaveMediaListEntry: rawState },
	);
	await new AniListUpdatesClient({ request }).save(
		7,
		1,
		null,
		{ status: "PLANNING" },
		"secret",
		new AbortController().signal,
	);
	expect(request.mock.calls[1]?.[1]).toEqual({
		mediaId: 1,
		status: "PLANNING",
	});
	const invalid = vi.fn<AniListClient["request"]>(async () => ({
		Media: { id: 1, type: "MANGA" },
	}));
	await expect(
		new AniListUpdatesClient({ request: invalid }).save(
			7,
			1,
			null,
			{ status: "CURRENT" },
			"secret",
			new AbortController().signal,
		),
	).rejects.toBeInstanceOf(AniListError);
	expect(invalid).toHaveBeenCalledTimes(1);
});

test("a definite invalid request can be corrected without replaying the rejected payload", async () => {
	const f = await fixture();
	f.save.mockRejectedValueOnce(
		new TrackingProviderError("invalid-request", null),
	);
	const first = f.worker.update("anilist:anime:1", f.input({ progress: 9999 }));
	await f.worker.flush();
	expect(f.operation()?.attempt).toBeNull();
	f.worker.update("anilist:anime:1", f.input({ progress: 4 }, first.revision));
	await f.worker.flush();
	expect(f.operation()?.state).toBe("succeeded");
	expect(f.save.mock.calls[1]?.[3]).toEqual({ progress: 4 });
});

test("worker sleeps when idle and arms only the next failed-operation deadline", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	try {
		await f.worker.flush();
		const reads = vi.spyOn(f.store, "list");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(reads).not.toHaveBeenCalled();
		f.get.mockRejectedValueOnce(new TrackingProviderError("unavailable", null));
		f.worker.update("anilist:anime:1", f.input({ progress: 8 }));
		await f.worker.flush();
		expect(f.operation()?.state).toBe("failed");
		expect(f.get).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1999);
		expect(f.get).toHaveBeenCalledTimes(1);
		f.advance();
		await vi.advanceTimersByTimeAsync(1);
		expect(f.operation()?.state).toBe("succeeded");
		reads.mockClear();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(reads).not.toHaveBeenCalled();
	} finally {
		await f.worker.close();
		vi.useRealTimers();
	}
});

test("reconnection wakes retained authorization-required operations without polling", async () => {
	const f = await fixture();
	f.get.mockRejectedValueOnce(new TrackingProviderError("unauthorized", null));
	f.worker.update("anilist:anime:1", f.input({ progress: 8 }));
	await f.worker.flush();
	expect(f.operation()?.state).toBe("authorization-required");
	f.status.state = "connected";
	f.worker.connectionChanged();
	await f.worker.flush();
	expect(f.operation()?.state).toBe("succeeded");
});
