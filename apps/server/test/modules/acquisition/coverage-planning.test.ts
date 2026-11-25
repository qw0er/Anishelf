import { expect, test } from "vitest";
import { selectWithCoverage } from "../../../src/modules/acquisition/coverage-planning.js";
import type { ManifestPreviewCandidate } from "../../../src/modules/acquisition/manifest-preview.js";
import type { ReleaseEvidence } from "../../../src/modules/acquisition/sources/public.js";
import { builtinAcquisitionProfiles } from "../../../src/modules/acquisition/subscriptions/domain/profiles.js";
import type { AcquisitionTarget } from "../../../src/modules/anime/public.js";
import {
	frierenSeasonPackFixture,
	loadReleaseCorpus,
} from "../../support/anime-release-corpus.js";

const pack = frierenSeasonPackFixture(await loadReleaseCorpus());
const defaultTarget = {
	...pack.target,
	work: { ...pack.target.work, episodeCount: 6 },
};

function plan(options: {
	packs: string[][];
	singles?: number[];
	target?: AcquisitionTarget;
	start?: number;
	wait?: boolean;
	reserved?: number[];
	active?: string[];
	reusable?: boolean;
}) {
	const target = options.target ?? defaultTarget;
	const makeEntry = (
		id: string,
		title: string,
		hash: string,
	): ReleaseEvidence => ({
		id,
		observationId: id,
		title,
		hash,
		publishedAt: null,
		download: `reference-${id}`,
	});
	const packEntries = options.packs.map((_, index) =>
		makeEntry(
			`pack-${index}`,
			pack.title,
			(index + 10).toString(16).repeat(40),
		),
	);
	const singleEntries = (options.singles ?? []).map((episode) =>
		makeEntry(
			`single-${episode}`,
			`[SubsPlease] Sousou no Frieren S2 - ${String(episode).padStart(2, "0")} (1080p)`,
			(episode + 100).toString(16).padStart(40, "0"),
		),
	);
	const entries = [...packEntries, ...singleEntries];
	const publication = {
		snapshot: {
			id: "source",
			label: "source",
			revision: "test",
			entries,
			checkedAt: null,
			error: null,
			nextAttemptAt: 0,
		},
		commit: () => {},
	};
	const inspection: ManifestPreviewCandidate[] = packEntries.map((entry) => ({
		publication,
		entry,
	}));
	const previews = inspection.map(({ entry }, index) => {
		const files = (options.packs[index] ?? []).map((name, fileIndex) => ({
			index: fileIndex,
			path: `Season 2/${name}`,
			sizeBytes: 100,
		}));
		return {
			code: null,
			manifest: {
				hash: entry.hash ?? "",
				indexSource: "client" as const,
				files,
			},
			coverage: pack.mapReleaseFiles(entry.title, target, files),
			selectableEpisodes: [],
		};
	});
	const candidates = selectWithCoverage(
		{
			subscription: {
				workKey: "anilist:anime:1",
				startEpisode: options.start ?? 1,
			},
			profile: builtinAcquisitionProfiles[0],
			target,
			now: 1_000_000,
			feed: publication.snapshot,
			active: new Set(options.active),
			reservedEpisodes: new Set(options.reserved),
			downloadsUnknown: false,
			waitForLevels: options.wait ?? false,
			assessReleaseTitle: pack.assessReleaseTitle,
		},
		inspection,
		previews,
		() => Boolean(options.reusable),
	);
	return {
		candidates,
		selected: candidates
			.filter(({ status }) => status === "selected")
			.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
	};
}

const ordinaryFiles = [
	"01.mkv",
	"02.mkv",
	"03.mkv",
	"04.mkv",
	"05.mkv",
	"06.mkv",
];

test("a finished season prefers a complete pack and fills holes in a partial pack with singles", () => {
	const full = plan({ packs: [ordinaryFiles], singles: [1, 2, 3, 4, 5, 6] });
	expect(full.selected.map(({ entryId }) => entryId)).toEqual(
		Array(6).fill("pack-0"),
	);
	const partial = plan({
		packs: [["01.mkv", "02.mkv", "04.mkv", "05.mkv", "06.mkv", "NCOP.mkv"]],
		singles: [3],
	});
	expect(partial.selected.map(({ entryId }) => entryId)).toEqual([
		"pack-0",
		"pack-0",
		"single-3",
		"pack-0",
		"pack-0",
		"pack-0",
	]);
});

test("an airing work with unknown total fills confirmed gaps without adding available, reserved or earlier episodes", () => {
	const target = {
		...defaultTarget,
		work: { ...defaultTarget.work, episodeCount: null },
		availableEpisodes: [4],
		airing: {
			status: "RELEASING",
			nextEpisode: null,
			fetchedAt: 1_000_000,
			stale: false,
			refreshError: false,
		},
	};
	const { selected } = plan({
		packs: [ordinaryFiles],
		target,
		start: 3,
		reserved: [5],
	});
	expect(selected.map(({ episode }) => episode)).toEqual([3, 6]);
	expect(selected.every(({ selection }) => !selection?.file?.complete)).toBe(
		true,
	);
});

test("shared videos are indivisible and overlapping encodes maximize verified coverage", () => {
	const files = ["S02E01-E02.mkv", "S02E02-E04.mkv", "S02E03-E04.mkv"];
	const { selected } = plan({ packs: [files] });
	expect(
		selected.map(({ episode, selection }) => [
			episode,
			selection?.file?.videoIndex,
		]),
	).toEqual([
		[1, 0],
		[2, 0],
		[3, 2],
		[4, 2],
	]);
	expect(
		plan({ packs: [["S02E03-E04.mkv"]], start: 4, singles: [4] }).selected.map(
			({ entryId }) => entryId,
		),
	).toEqual(["single-4"]);
});

test("an ordinary single wins an equivalent one-episode choice and pack candidates wait under their own profile clock", () => {
	const target = { ...defaultTarget, availableEpisodes: [1, 2, 4, 5, 6] };
	expect(
		plan({ packs: [ordinaryFiles], target, singles: [3] }).selected.map(
			({ entryId }) => entryId,
		),
	).toEqual(["single-3"]);
	const waiting = plan({ packs: [ordinaryFiles], target, wait: true });
	expect(waiting.selected).toHaveLength(0);
	expect(
		waiting.candidates.find(({ episode }) => episode === 3)?.reasons,
	).toEqual(["waiting_for_level"]);
});

test("a foreign task leaves a fallback while an owned pack can cover the rest", () => {
	const active = ["a".repeat(40)];
	const options = { packs: [ordinaryFiles], singles: [3], active };
	expect(plan(options).selected.map(({ entryId }) => entryId)).toEqual([
		"single-3",
	]);
	expect(plan({ ...options, reusable: true }).selected).toHaveLength(6);
});
