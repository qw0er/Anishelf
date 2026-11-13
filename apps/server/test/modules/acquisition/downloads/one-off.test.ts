import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import { SourceError } from "../../../../src/modules/acquisition/sources/public.js";
import { TorrentError } from "../../../../src/modules/acquisition/torrent-clients/public.js";
import {
	fixture,
	hash,
	key,
	setupTestLifecycle,
	target,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();
afterEach(() => vi.restoreAllMocks());
const coverage = {
	limited: false,
	reason: null,
	pages: 1,
	queries: 1,
} as const;
function release(
	id = "release",
	title = "Frieren - 03 [1080p]",
	torrentHash = hash,
) {
	return {
		id,
		observationId: id,
		title,
		hash: torrentHash,
		publishedAt: null,
		downloadUrl: null,
		download: {
			kind: "magnet" as const,
			uri: `magnet:?xt=urn:btih:${torrentHash}`,
		},
		seeders: 10,
		seedersObservedAt: 1_000_000,
	};
}
async function setup(persistent = false) {
	const f = await fixture(persistent);
	f.db.acquisition.remove(
		key,
		f.db.acquisition.subscription(key)?.revision ?? "",
	);
	await f.configure();
	await f.sources.connector.save({
		generation: f.sources.connector.settings().generation,
		url: "http://jackett:9117",
		apiKey: "private-key",
		origin: "external",
		providers: ["first", "second"],
	});
	f.anime.assessReleaseTitle.mockImplementation((title) => ({
		episode: Number(/- (\d+)/.exec(title)?.[1] ?? 0),
		eligible: !title.includes("Wrong"),
		reasons: title.includes("Wrong") ? ["identity_unconfirmed"] : [],
		version: "1",
		attributes: {
			subtitleLanguages: [],
			subtitleFormats: [],
			resolutions: [title.includes("720p") ? 720 : 1080],
			videoCodecs: [],
			sources: [],
			releaseGroups: [],
			revision: 1,
		},
	}));
	const search = vi
		.spyOn(JackettConnection.prototype, "search")
		.mockImplementation(async (plan) => ({
			entries:
				plan.indexerId === "first"
					? [
							release("low", "Frieren - 03 [720p]", "b".repeat(40)),
							release("other", "Frieren - 04 [1080p]", "c".repeat(40)),
						]
					: [release(), release("duplicate")],
			coverage,
			outcome: "matches",
		}));
	return {
		f,
		search,
		input: { workKey: key, episode: 3, commandId: randomUUID() },
	};
}

test("single-episode acquisition searches every site, skips preference waiting and imports without any subscription", async () => {
	const { f, search, input } = await setup();
	const accepted = await f.worker.requestEpisode(input);
	expect(accepted).toMatchObject({ accepted: true, existing: false });
	expect(search).not.toHaveBeenCalled();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		origin: "one-off",
		state: "discovering",
	});
	await f.worker.tick();
	expect(search.mock.calls.map(([plan]) => plan.indexerId)).toEqual([
		"first",
		"second",
	]);
	expect(f.worker.activity(key).items[0]).toMatchObject({
		title: "Frieren - 03 [1080p]",
		state: "bound",
		progress: 0.25,
	});
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisition.subscription(key)).toBeNull();
	expect(f.db.acquisition.authorization(key)).toBeNull();
	f.complete();
	await f.worker.tick();
	expect(f.ingestion.ingest).toHaveBeenCalled();
	expect(f.worker.activity(key).items[0]?.state).toBe("available");
	expect(JSON.stringify(f.worker.activity(key))).not.toMatch(
		/private-key|magnet:|sourceGeneration|profileFingerprint/,
	);
});

test("replayed and concurrent clicks reserve one episode and reject command ID reuse for another episode", async () => {
	const { f, input } = await setup();
	const results = await Promise.all([
		f.worker.requestEpisode(input),
		f.worker.requestEpisode({ ...input, commandId: randomUUID() }),
		f.worker.requestEpisode(input),
	]);
	expect(new Set(results.map((result) => result.intentId)).size).toBe(1);
	expect(f.worker.activity(key).total).toBe(1);
	await expect(
		f.worker.requestEpisode({ ...input, episode: 4 }),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("accepted discovery survives restart and never acquires other episodes", async () => {
	const { f, input } = await setup(true);
	await f.worker.requestEpisode(input);
	await f.restart();
	await f.worker.tick();
	await f.worker.tick();
	expect(f.worker.activity(key).items.map((item) => item.episode)).toEqual([3]);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("empty discovery stops until explicit retry and can recover without a subscription", async () => {
	const { f, search, input } = await setup();
	search.mockResolvedValue({ entries: [], coverage, outcome: "no_match" });
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "blocked",
		error: "no_eligible_release",
		canRetryAcquisition: true,
	});
	f.advance();
	await f.worker.tick();
	expect(search).toHaveBeenCalledTimes(2);
	search.mockResolvedValue({
		entries: [release()],
		coverage,
		outcome: "matches",
	});
	const item = f.worker.activity(key).items[0];
	if (!item) throw new Error("Missing intent");
	f.worker.retry(item.id, item.revision, "retry", "acquisition");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("partial site failures still select matching evidence and retain diagnostics", async () => {
	const { f, search, input } = await setup();
	search.mockRejectedValueOnce(new SourceError("upstream_failure"));
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(
		f.db.acquisitionDownloads.intent(input.commandId)?.oneOff?.discovery,
	).toContainEqual({
		providerId: "first",
		code: "upstream_failure",
		limited: false,
	});
});

test("complete site failure is actionable and does not create a subscription", async () => {
	const { f, search, input } = await setup();
	search.mockRejectedValue(new SourceError("upstream_failure"));
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.error).toBe("discovery_unavailable");
	expect(f.add).not.toHaveBeenCalled();
});

test("changed settings stop a new submission and explicit retry adopts the current target", async () => {
	const { f, input } = await setup();
	await f.worker.requestEpisode(input);
	await f.configure();
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.error).toBe(
		"acquisition_configuration_changed",
	);
	expect(f.add).not.toHaveBeenCalled();
	const item = f.worker.activity(key).items[0];
	if (!item) throw new Error("Missing intent");
	f.worker.retry(item.id, item.revision, "retry", "acquisition");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("local files and active external episode tasks prevent duplicate downloads", async () => {
	const { f, input } = await setup();
	f.anime.target.mockResolvedValueOnce({ ...target, availableEpisodes: [3] });
	await expect(f.worker.requestEpisode(input)).rejects.toMatchObject({
		code: "ACQUISITION_CONFLICT",
	});
	await f.worker.requestEpisode(input);
	f.anime.target.mockResolvedValue({ ...target, availableEpisodes: [3] });
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.error).toBe("already_available");
	expect(f.add).not.toHaveBeenCalled();
});

test("unknown submissions reconcile without selecting another release or automatically re-adding", async () => {
	const { f, search, input } = await setup();
	f.add.mockImplementation(async () => {
		throw new TorrentError("unavailable", "unknown");
	});
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.state).toBe("unknown");
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(search).toHaveBeenCalledTimes(2);
});

test("single-episode requests retain hard subtitle requirements instead of falling back to an unwanted release", async () => {
	const { f, input } = await setup();
	f.setDefaultProfileId("builtin:chinese");
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.error).toBe("no_eligible_release");
	expect(f.add).not.toHaveBeenCalled();
});

test("settings changed during source discovery prevent a late external submission", async () => {
	const { f, search, input } = await setup();
	await f.worker.requestEpisode(input);
	search.mockImplementationOnce(async () => {
		f.setDefaultProfileId("builtin:chinese");
		return { entries: [release()], coverage, outcome: "matches" };
	});
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.error).toBe(
		"acquisition_configuration_changed",
	);
	expect(f.add).not.toHaveBeenCalled();
});

test("a matching external episode transfer blocks acquisition before a new add", async () => {
	const { f, input } = await setup();
	await f.worker.requestEpisode(input);
	await f.client.add(
		{
			source: { magnet: `magnet:?xt=urn:btih:${hash}` },
			savePath: "/external",
			ownerKey: "external",
		},
		new AbortController().signal,
	);
	f.add.mockClear();
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.error).toBe("episode_downloading");
	expect(f.add).not.toHaveBeenCalled();
});

test("explicit retry of an uncertain submission reconciles and reuses the same publication and owner identity", async () => {
	const { f, search, input } = await setup();
	const add = f.add.getMockImplementation();
	if (!add) throw new Error("Missing add fixture");
	f.add.mockImplementationOnce(async () => {
		throw new TorrentError("unavailable", "unknown");
	});
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	const item = f.worker.activity(key).items[0];
	if (!item) throw new Error("Missing intent");
	f.worker.retry(item.id, item.revision, "explicit", "acquisition");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(2);
	expect(f.add.mock.calls.map(([request]) => request.ownerKey)).toEqual([
		input.commandId,
		input.commandId,
	]);
	expect(search).toHaveBeenCalledTimes(2);
	expect(f.worker.activity(key).items[0]?.state).toBe("bound");
});

test("configuration changes during torrent preparation stop further automatic attempts", async () => {
	const { f, input } = await setup();
	await f.worker.requestEpisode(input);
	vi.spyOn(f.reader, "read").mockImplementation(async () => {
		f.setDefaultProfileId("builtin:chinese");
		throw new Error("Source configuration changed");
	});
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "blocked",
		error: "acquisition_configuration_changed",
	});
	f.advance();
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
});

test("shutdown cancels discovery waiting without losing the accepted episode request", async () => {
	const { f, search, input } = await setup(true);
	let releaseSearch:
		| ((value: Awaited<ReturnType<JackettConnection["search"]>>) => void)
		| undefined;
	search.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				releaseSearch = resolve;
			}),
	);
	await f.worker.requestEpisode(input);
	const tick = f.worker.tick();
	await vi.waitFor(() => expect(releaseSearch).toBeTypeOf("function"));
	await f.worker.close();
	expect(f.worker.activity.bind(f.worker, key)).toThrow();
	expect(f.db.acquisitionDownloads.intent(input.commandId)?.state).toBe(
		"discovering",
	);
	if (!releaseSearch) throw new Error("Missing pending search");
	releaseSearch({ entries: [release()], coverage, outcome: "matches" });
	await tick;
	await f.restart();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("repeated recovery cannot replace an uncertain publication after source settings expire", async () => {
	const { f, search, input } = await setup();
	f.add.mockImplementationOnce(async () => {
		throw new TorrentError("unavailable", "unknown");
	});
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	const source = f.db.acquisitionDownloads.intent(input.commandId)?.source;
	await f.sources.connector.save({
		generation: f.sources.connector.settings().generation,
		url: "http://jackett:9117",
		apiKey: "new-key",
		origin: "external",
		providers: ["first", "second"],
	});
	for (const commandId of ["retry-one", "retry-two"]) {
		const item = f.worker.activity(key).items[0];
		if (!item) throw new Error("Missing intent");
		f.worker.retry(item.id, item.revision, commandId, "acquisition");
		await f.worker.tick();
	}
	expect(search).toHaveBeenCalledTimes(2);
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.intent(input.commandId)).toMatchObject({
		source,
		oneOff: { uncertainSubmission: true },
	});
});

test("one-off downloads use all four prepared multilingual queries", async () => {
	const { f, search, input } = await setup();
	const selected = ["Romaji", "English", "原名", "中文名"];
	f.anime.target.mockResolvedValue({
		...target,
		searchTitles: selected,
		work: {
			...target.work,
			titles: ["Unrelated alias", ...target.work.titles],
		},
	});
	await f.worker.requestEpisode(input);
	await f.worker.tick();
	expect(search.mock.calls.length).toBeGreaterThan(0);
	for (const [plan] of search.mock.calls) expect(plan.titles).toEqual(selected);
});
