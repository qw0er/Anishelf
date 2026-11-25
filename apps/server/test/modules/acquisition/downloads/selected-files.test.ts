import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { ManifestPreview } from "../../../../src/modules/acquisition/manifest-preview.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import {
	type TorrentClient,
	TorrentError,
	type TorrentManifest,
} from "../../../../src/modules/acquisition/torrent-clients/public.js";
import {
	frierenSeasonPackFixture,
	loadReleaseCorpus,
} from "../../../support/anime-release-corpus.js";
import {
	cleanup,
	fixture,
	fixturePath,
	hash,
	key,
	logger,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();
afterEach(() => vi.restoreAllMocks());

const frieren = frierenSeasonPackFixture(await loadReleaseCorpus());
const paths = [
	"01.mkv",
	"03.mkv",
	"03.zh.ass",
	"04.mkv",
	"04.zh.ass",
	"NCOP.mkv",
];
const files = paths.map((name, index) => ({
	index,
	path: `Season 2/${name}`,
	sizeBytes: 100,
}));
const manifest = {
	hash,
	indexSource: "client",
	files,
} satisfies TorrentManifest;

async function setup() {
	let preview: ManifestPreview;
	const f = await fixture(
		true,
		false,
		{ preview: (input) => preview.preview(input) },
		frieren.mapReleaseFiles,
	);
	preview = new ManifestPreview(
		{
			connectionGeneration: () => "account-1",
			withClient: (_generation, operation) => operation(f.client),
		},
		frieren.mapReleaseFiles,
		logger,
	);
	cleanup.push(async () => preview.close());
	f.anime.target.mockResolvedValue(frieren.target);
	f.anime.assessReleaseTitle.mockImplementation(frieren.assessReleaseTitle);
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
		providers: ["first"],
	});
	vi.spyOn(JackettConnection.prototype, "search").mockResolvedValue({
		entries: [
			{
				id: "pack",
				observationId: "pack",
				title: frieren.title,
				hash,
				publishedAt: null,
				downloadUrl: null,
				download: { kind: "magnet", uri: `magnet:?xt=urn:btih:${hash}` },
				seeders: 10,
				seedersObservedAt: 1_000_000,
			},
		],
		coverage: { limited: false, reason: null, pages: 1, queries: 1 },
		outcome: "matches",
	});
	f.probe.mockResolvedValue({
		version: "5.2.0",
		incompleteDirectory: fixturePath("incomplete"),
		selectiveFiles: true,
	});
	const priorities = files.map(() => 0);
	const progress = files.map(() => 0);
	f.client.inspectMetadata = vi.fn(async () => manifest);
	vi.spyOn(f.client, "files").mockImplementation(async () =>
		files.map((file, i) => ({
			...file,
			progress: progress[i] ?? 0,
			priority: priorities[i] ?? 0,
			selected: (priorities[i] ?? 0) > 0,
		})),
	);
	const add = f.add.getMockImplementation();
	if (!add) throw new Error("Missing fixture add.");
	const receiveAdd: TorrentClient["add"] = async (input, signal) => {
		if (!input.fileSelection) throw new Error("Expected initial priorities.");
		priorities.splice(0, priorities.length, ...input.fileSelection.priorities);
		await add(input, signal);
		if (f.state.task)
			f.state.task = {
				...f.state.task,
				name: frieren.title,
				contentPath: join(input.savePath, "Season 2"),
			};
	};
	f.add.mockImplementation(receiveAdd);
	const receiveExpansion: NonNullable<TorrentClient["enableFiles"]> = async (
		_hash,
		added,
	) => {
		for (const index of added) priorities[index] = 1;
	};
	const enable = vi.fn(receiveExpansion);
	f.client.enableFiles = enable;
	const request = (episode: number) =>
		f.worker.requestEpisode({ workKey: key, episode, commandId: randomUUID() });
	const item = (episode: number) =>
		f.worker.activity(key).items.find((item) => item.episode === episode);
	const selection = () =>
		f.db.acquisitionDownloads.ownedFileSelection(hash, "account-1");
	const complete = async (...indices: number[]) => {
		for (const index of indices) progress[index] = 1;
		f.complete();
		await f.worker.tick();
	};
	return {
		f,
		priorities,
		enable,
		request,
		item,
		selection,
		complete,
		receiveAdd,
		receiveExpansion,
	};
}

test("requests E03 then extends its completed task for E04 and their respective sidecars", async () => {
	const { f, request, item, selection, priorities, enable, complete } =
		await setup();
	const first = await request(3);
	await f.worker.tick();
	expect(item(3)).toMatchObject({ state: "bound" });
	expect(priorities).toEqual([0, 1, 1, 0, 0, 0]);
	const transferId = selection()?.id;
	expect(transferId).toBeTruthy();
	await complete(1, 2);
	expect(item(3)).toMatchObject({ state: "available" });
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);

	const second = await request(4);
	await f.worker.tick();
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(enable).toHaveBeenCalledExactlyOnceWith(
		hash,
		[3, 4],
		expect.any(AbortSignal),
	);
	expect(priorities).toEqual([0, 1, 1, 1, 1, 0]);
	expect(selection()).toMatchObject({ id: transferId, pending: null });
	expect(selection()?.observed?.map(({ priority }) => priority)).toEqual(
		priorities,
	);
	for (const request of [first, second])
		expect(f.db.acquisitionDownloads.intent(request.intentId)?.transferId).toBe(
			transferId,
		);
	await complete(3, 4);
	expect(item(3)).toMatchObject({ state: "available" });
	expect(item(4)).toMatchObject({ state: "available" });
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(2);
});

test.each(["add", "expand"] as const)(
	"lost %s response is reconciled across restart without a duplicate submission",
	async (kind) => {
		const {
			f,
			request,
			item,
			selection,
			priorities,
			enable,
			receiveAdd,
			receiveExpansion,
		} = await setup();
		const episode = kind === "add" ? 3 : 4;
		if (kind === "add") {
			f.add.mockImplementationOnce(async (...args) => {
				await receiveAdd(...args);
				throw new TorrentError("timeout", "unknown");
			});
		} else {
			await request(3);
			await f.worker.tick();
			enable.mockImplementationOnce(async (...args) => {
				await receiveExpansion(...args);
				throw new TorrentError("timeout", "unknown");
			});
		}
		const accepted = await request(episode);
		await f.worker.tick();
		expect(item(episode)).toMatchObject({ state: "unknown" });
		expect(selection()?.pending).toMatchObject({
			kind,
			requestId: accepted.intentId,
			sentAt: expect.any(Number),
		});
		await f.restart();
		f.advance();
		await f.worker.tick();
		expect(item(episode)).toMatchObject({ state: "bound" });
		expect(selection()?.pending).toBeNull();
		expect(selection()?.observed?.map(({ priority }) => priority)).toEqual(
			priorities,
		);
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(enable).toHaveBeenCalledTimes(kind === "expand" ? 1 : 0);
	},
);

test("a lost add with no identifiable task stays uncertain across restart", async () => {
	const { f, request, item, selection } = await setup();
	f.add.mockRejectedValueOnce(new TorrentError("timeout", "unknown"));
	await request(3);
	await f.worker.tick();
	await f.restart();
	f.advance();
	await f.worker.tick();
	expect(item(3)).toMatchObject({
		state: "unknown",
		error: "submission_unconfirmed",
	});
	expect(selection()?.pending).toMatchObject({
		kind: "add",
		sentAt: expect.any(Number),
	});
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("a lost expansion is retried only after reading the same original priorities", async () => {
	const { f, request, item, enable, priorities } = await setup();
	await request(3);
	await f.worker.tick();
	enable.mockRejectedValueOnce(new TorrentError("timeout", "unknown"));
	await request(4);
	await f.worker.tick();
	expect(item(4)).toMatchObject({ state: "unknown" });
	expect(priorities).toEqual([0, 1, 1, 0, 0, 0]);
	await f.restart();
	await f.worker.tick();
	expect(enable).toHaveBeenCalledTimes(1);
	f.advance();
	await f.worker.tick();
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(priorities).toEqual([0, 1, 1, 1, 1, 0]);
	expect(enable.mock.calls.map(([, indices]) => indices)).toEqual([
		[3, 4],
		[3, 4],
	]);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("confirmed removal releases a completed transfer while preserving its imported episode", async () => {
	const { f, request, item, selection, priorities, enable, complete } =
		await setup();
	await request(3);
	await f.worker.tick();
	await complete(1, 2);
	const previous = selection()?.id;
	expect(previous).toBeTruthy();
	f.state.task = null;
	await request(4);
	await f.worker.tick();
	expect(item(3)).toMatchObject({ state: "available" });
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(selection()?.id).not.toBe(previous);
	expect(f.add).toHaveBeenCalledTimes(2);
	expect(enable).not.toHaveBeenCalled();
	expect(priorities).toEqual([0, 0, 0, 1, 1, 0]);
});

test("competing episode commands serialize and duplicate claims join", async () => {
	const { f, request, item, selection, enable, priorities } = await setup();
	const [first, second, duplicate] = await Promise.all([
		request(3),
		request(4),
		request(4),
	]);
	expect(duplicate.intentId).toBe(second.intentId);
	expect(first.intentId).not.toBe(second.intentId);
	for (let index = 0; index < 3; index++) {
		await f.worker.tick();
		f.advance();
	}
	expect(item(3)).toMatchObject({ state: "bound" });
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(selection()?.pending).toBeNull();
	expect(priorities).toEqual([0, 1, 1, 1, 1, 0]);
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(enable).toHaveBeenCalledTimes(1);
});

test("a same-hash task with a foreign owner is left untouched", async () => {
	const { f, request, item, selection, enable, receiveAdd, priorities } =
		await setup();
	await receiveAdd({
		source: { magnet: `magnet:?xt=urn:btih:${hash}` },
		savePath: fixturePath("downloads"),
		ownerKey: "external",
		fileSelection: { hash, priorities: [1, 0, 0, 0, 0, 0] },
	});
	await request(3);
	await f.worker.tick();
	expect(item(3)).toMatchObject({
		state: "blocked",
		error: "external_task_conflict",
	});
	expect(selection()).toBeNull();
	expect(f.add).not.toHaveBeenCalled();
	expect(enable).not.toHaveBeenCalled();
	expect(priorities).toEqual([1, 0, 0, 0, 0, 0]);
});

test.each(["destination", "authorization", "priorities"] as const)(
	"expansion preserves E03 when %s changes before the write",
	async (change) => {
		const { f, request, item, selection, enable, priorities, complete } =
			await setup();
		await request(3);
		await f.worker.tick();
		await complete(1, 2);
		await request(4);
		const probe = f.probe.getMockImplementation();
		if (!probe) throw new Error("Missing fixture probe.");
		f.probe
			.mockImplementationOnce(probe)
			.mockImplementationOnce(async (...args) => {
				if (change === "destination") {
					await f.worker.saveDestination({
						revision: f.db.acquisitionDownloads.destination()?.revision ?? null,
						scopeId: "root",
						path: fixturePath("other"),
					});
				} else if (change === "authorization") {
					f.setDefaultProfileId("changed");
				} else {
					priorities[0] = 1;
				}
				return probe(...args);
			});
		await f.worker.tick();
		expect(item(3)).toMatchObject({ state: "available" });
		expect(item(4)).toMatchObject({
			state: "blocked",
			error:
				change === "priorities"
					? "file_selection_changed"
					: "acquisition_configuration_changed",
		});
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(enable).not.toHaveBeenCalled();
		expect(selection()?.pending).toBeNull();
		expect(priorities).toEqual([
			change === "priorities" ? 1 : 0,
			1,
			1,
			0,
			0,
			0,
		]);
	},
);

test("a client without initial priority support cannot submit a pack", async () => {
	const { f, request, item, selection, enable } = await setup();
	f.probe.mockResolvedValue({
		version: "5.0.5",
		incompleteDirectory: fixturePath("incomplete"),
	});
	await request(3);
	await f.worker.tick();
	expect(item(3)).toMatchObject({
		state: "blocked",
		error: "metadata_unsupported",
	});
	expect(selection()).toBeNull();
	expect(f.add).not.toHaveBeenCalled();
	expect(enable).not.toHaveBeenCalled();
});
