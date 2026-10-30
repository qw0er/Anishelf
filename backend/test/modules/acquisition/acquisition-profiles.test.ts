import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { ReleaseEvidence } from "../../../src/modules/acquisition/sources/public.js";
import { parseRss } from "../../../src/modules/acquisition/sources/rss/parser.js";
import type { Candidate } from "../../../src/modules/acquisition/subscriptions/domain/model.js";
import { matchesRelease } from "../../../src/modules/acquisition/subscriptions/domain/profile-matching.js";
import {
	type AcquisitionProfile,
	builtinAcquisitionProfiles,
} from "../../../src/modules/acquisition/subscriptions/domain/profiles.js";
import { selectCandidates } from "../../../src/modules/acquisition/subscriptions/domain/selection.js";
import {
	loadAcquisitionProfiles,
	parseAcquisitionProfiles,
} from "../../../src/modules/acquisition/subscriptions/infrastructure/profiles.js";
import { AnitomyIdentificationParser } from "../../../src/modules/anime/identification/infrastructure/parser.js";
import type { AcquisitionTarget } from "../../../src/modules/anime/public.js";
import { AnimeReleaseAssessment } from "../../../src/modules/anime/release-assessment/application.js";
import { fixtureAssociations } from "../../support/metadata-associations.js";

const target: AcquisitionTarget = {
	work: {
		reference: { id: "1" },
		snapshotId: "snapshot",
		titles: ["Frieren"],
		year: 2023,
		format: "TV",
		episodeCount: 28,
		season: null,
		part: null,
	},
	availableEpisodes: [],
	revision: "catalog",
};
const assessor = new AnimeReleaseAssessment(
	new AnitomyIdentificationParser(),
	{} as never,
	undefined,
	fixtureAssociations(),
);
const assessReleaseTitle = assessor.assessReleaseTitle.bind(assessor);
const entry = (
	id: string,
	suffix: string,
	seeders: number | null = null,
): ReleaseEvidence => ({
	id,
	observationId: id,
	title: `[G] Frieren - 03 ${suffix}`,
	publishedAt: 1,
	download: `download-${id}`,
	hash: null,
	seeders,
	seedersObservedAt: seeders === null ? null : 1000,
});
// Ranking tests use zero-wait policies; timing tests pass the actual built-ins.
const immediate = (profile: AcquisitionProfile): AcquisitionProfile => ({
	...profile,
	levels: profile.levels.map((level) => ({ ...level, acceptAfterMinutes: 0 })),
});
function select(
	entries: ReleaseEvidence[],
	profile = immediate(builtinAcquisitionProfiles[0]),
	now = 1000,
	history: Candidate[] = [],
	locked: string[] = [],
) {
	return selectCandidates({
		subscription: {
			workKey: "anilist:anime:1",
			feedId: "feed",
			startEpisode: 1,
			enabled: true,
			revision: "1",
		},
		feed: { entries },
		target,
		active: new Set(),
		downloadsUnknown: false,
		assessReleaseTitle,
		profile,
		now,
		history,
		locked: new Set(locked),
	});
}
const chosen = (candidates: Candidate[]) =>
	candidates
		.filter((candidate) => candidate.status === "selected")
		.map((candidate) => candidate.entryId);

test("the commented example validates; configuration rejects ambiguity and invalid rules", async () => {
	const example = await readFile(
		new URL(
			"../../../../docs/examples/acquisition-profiles-example.yaml",
			import.meta.url,
		),
		"utf8",
	);
	expect(parseAcquisitionProfiles(example)[0]?.id).toBe(
		"custom:chinese-efficient",
	);
	const valid = {
		version: 1,
		profiles: [{ ...builtinAcquisitionProfiles[0], id: "custom:test" }],
	};
	expect(parseAcquisitionProfiles(JSON.stringify(valid))).toHaveLength(1);
	for (const value of [
		{ ...valid, version: 2 },
		{ version: 1, profiles: [builtinAcquisitionProfiles[0]] },
		{ version: 1, profiles: [valid.profiles[0], valid.profiles[0]] },
		{ version: 1, profiles: [{ ...valid.profiles[0], typo: true }] },
		{
			version: 1,
			profiles: [
				{
					...valid.profiles[0],
					levels: [
						{ name: "bad", match: { resolutions: [] }, acceptAfterMinutes: 0 },
					],
				},
			],
		},
		{
			version: 1,
			profiles: [
				{
					...valid.profiles[0],
					levels: [
						{
							name: "bad",
							match: { anyOf: [{ typo: true }] },
							acceptAfterMinutes: 0,
						},
					],
				},
			],
		},
		{
			version: 1,
			profiles: [
				{
					...valid.profiles[0],
					levels: [
						{
							name: "bad",
							match: { unknownSeeders: "allow" },
							acceptAfterMinutes: 0,
						},
					],
				},
			],
		},
		{
			version: 1,
			profiles: [
				{
					...valid.profiles[0],
					levels: [
						{ name: "a", match: {}, acceptAfterMinutes: 60 },
						{ name: "b", match: {}, acceptAfterMinutes: 0 },
					],
				},
			],
		},
	])
		expect(() => parseAcquisitionProfiles(JSON.stringify(value))).toThrow();
	expect(() =>
		parseAcquisitionProfiles("version: 1\nversion: 1\nprofiles: []"),
	).toThrow();
	expect(() =>
		parseAcquisitionProfiles("version: 1\nprofiles: &x [*x]"),
	).toThrow();
});

test("real title extraction normalizes joint groups, Chinese subtitles, codecs, source and revision", () => {
	const attributes = assessReleaseTitle(
		"[桜都字幕组&LoliHouse] Frieren - 03v2 [WebRip 1920x1080 HEVC-10bit AAC][简繁日内封字幕]",
		target,
	).attributes;
	expect(attributes).toMatchObject({
		subtitleLanguages: ["zh-Hans", "zh-Hant", "ja"],
		subtitleFormats: ["soft"],
		resolutions: [1080],
		videoCodecs: ["hevc"],
		sources: ["web"],
		revision: 2,
	});
	expect(attributes?.releaseGroups).toEqual(
		expect.arrayContaining(["桜都字幕组", "LoliHouse"]),
	);
	expect(
		assessReleaseTitle("[G] Frieren - 03 [1080p][CHT]", target).attributes
			?.subtitleLanguages,
	).toEqual(["zh-Hant"]);
	expect(
		assessReleaseTitle("[G] Frieren - 03 [1080p][Japanese Dub]", target)
			.attributes?.subtitleLanguages,
	).toEqual([]);
	expect(
		matchesRelease(
			{
				releaseGroups: ["lolihouse"],
				includeKeywords: ["FRIEREN", "AAC"],
				excludeReleaseGroups: ["Other"],
			},
			attributes,
			"Frieren AAC",
			null,
		),
	).toBe(true);
	expect(
		matchesRelease({ subtitleLanguages: ["en"] }, attributes, "Frieren", null),
	).toBe(false);
});

test("1080p and 2160p share a level; counts only compare within the winning unlocked level", () => {
	const profile = immediate(builtinAcquisitionProfiles[1]);
	const entries = [
		entry("avc", "[1080p AVC]", 100),
		entry("hevc", "[2160p HEVC]", 2),
		entry("av1", "[1080p AV1]", 4),
	];
	expect(chosen(select(entries, profile))).toEqual(["av1"]);
	expect(
		chosen(select(entries, { ...profile, preferMoreSeeders: false })),
	).toEqual(["av1"]); // stable identity, no hidden resolution order
	expect(
		chosen(select([entry("a", "[2160p]"), entry("b", "[1080p]")])),
	).toEqual(["a"]);
});

test("unknown and stale seed counts stay distinct from reported zero", () => {
	const entries = [
		entry("zero", "[1080p]", 0),
		entry("unknown", "[1080p]"),
		entry("positive", "[1080p]", 2),
	];
	expect(chosen(select(entries))).toEqual(["positive"]);
	expect(chosen(select(entries.slice(0, 2)))).toEqual(["unknown"]);
	const profile = {
		...immediate(builtinAcquisitionProfiles[0]),
		requirements: { minSeeders: 1, unknownSeeders: "allow" },
	};
	expect(chosen(select(entries, profile, 3_601_001))).toEqual(["positive"]); // all old counts now unknown; stable ID decides
	expect(matchesRelease({ minSeeders: 1 }, undefined, "", null)).toBe(false);
	expect(
		matchesRelease(
			{ minSeeders: 1, unknownSeeders: "allow" },
			undefined,
			"",
			0,
		),
	).toBe(false);
});

test("waiting survives re-evaluation and new candidates; a preferred release still respects its collection window", () => {
	const profile = builtinAcquisitionProfiles[1];
	const avc = entry("avc", "[1080p AVC]");
	const first = select([avc], profile);
	expect(chosen(first)).toEqual([]);
	expect(first[0]?.reasons).toContain("waiting_for_level");
	expect(
		chosen(select([avc], profile, 1000 + 180 * 60_000, structuredClone(first))),
	).toEqual(["avc"]);
	const later = select(
		[avc, entry("avc2", "[2160p AVC]")],
		profile,
		1000 + 179 * 60_000,
		first,
	);
	expect(
		later.every((candidate) => candidate.selection?.firstSeenAt === 1000),
	).toBe(true);
	expect(
		chosen(select([avc, entry("hevc", "[1080p HEVC]")], profile, 2000, first)),
	).toEqual([]);
	expect(
		chosen(
			select(
				[avc, entry("hevc", "[1080p HEVC]")],
				profile,
				1000 + 120 * 60_000,
				first,
			),
		),
	).toEqual(["hevc"]);
});

test("unreserved choices can improve, while reserved choices stay locked", () => {
	const profile = builtinAcquisitionProfiles[1];
	const avc = entry("avc", "[1080p AVC]");
	const first = select([avc], profile, 1000);
	const ready = select([avc], profile, 10_801_000, first);
	const entries = [avc, entry("hevc", "[1080p HEVC]")];
	expect(chosen(select(entries, profile, 10_901_000, ready))).toEqual(["hevc"]);
	expect(
		chosen(
			select(
				entries,
				profile,
				10_901_000,
				ready,
				ready.map((candidate) => candidate.id),
			),
		),
	).toEqual(["avc"]);
});

test("Chinese profile rejects unknown language, and anyOf branches preserve hard requirements", () => {
	expect(
		chosen(
			select([entry("unknown", "[1080p]")], builtinAcquisitionProfiles[2]),
		),
	).toEqual([]);
	const profile: AcquisitionProfile = {
		id: "custom:branches",
		name: "Branches",
		requirements: { subtitleLanguages: ["zh-Hans"] },
		levels: [
			{
				name: "Preferred",
				match: { anyOf: [{ videoCodecs: ["hevc"] }, { resolutions: [2160] }] },
				acceptAfterMinutes: 0,
			},
		],
	};
	expect(
		chosen(
			select(
				[entry("bad", "[2160p]"), entry("good", "[1080p HEVC][CHS]")],
				profile,
			),
		),
	).toEqual(["good"]);
});

test("RSS reads optional seeder extensions and Mikan nested publication dates", () => {
	const xml = (extra: string) =>
		`<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item><title>Frieren</title>${extra}<torrent xmlns="https://mikan.tangbai.cc/0.1/"><pubDate>2026-10-22T17:01:00+08:00</pubDate></torrent></item></channel></rss>`;
	expect(parseRss(xml("<nyaa:seeders>12</nyaa:seeders>"))[0]).toMatchObject({
		seeders: 12,
		publishedAt: Date.parse("2026-10-22T17:01:00+08:00"),
	});
	expect(
		parseRss(xml('<torznab:attr name="seeders" value="0"/>'))[0]?.seeders,
	).toBe(0);
	for (const raw of [
		"",
		"<nyaa:seeders>-1</nyaa:seeders>",
		"<nyaa:seeders>bad</nyaa:seeders>",
	])
		expect(parseRss(xml(raw))[0]?.seeders).toBeNull();
});

test("persisted waiting and profile selection survive database/module restart and a 304 response", async () => {
	const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { default: pino } = await import("pino");
	const { ApplicationDatabase } = await import(
		"../../../src/app/bootstrap/database.js"
	);
	const { createAcquisitionModule } = await import(
		"../../../src/modules/acquisition/create.js"
	);
	const dir = await mkdtemp(join(tmpdir(), "anishelf-profile-restart-"));
	let database = ApplicationDatabase.open(dir);
	let now = 1000;
	let xml: string | null =
		'<rss version="2.0"><channel><item><title>[G] Frieren - 03 [1080p AVC]</title><enclosure type="application/x-bittorrent" url="https://example.org/episode.torrent"/></item></channel></rss>';
	await writeFile(
		join(dir, "acquisition-profiles.yaml"),
		"version: 1\nprofiles:\n  - id: custom:any\n    name: Any\n    levels:\n      - name: Any\n        match: {}\n        acceptAfterMinutes: 0\n",
	);
	const create = () =>
		createAcquisitionModule({
			dataDir: dir,
			store: database.acquisition,
			downloadStore: database.acquisitionDownloads,
			logger: pino({ level: "silent" }),
			anime: { target: async () => target, assessReleaseTitle },
			transport: {
				fetch: async () => ({ xml, etag: "etag", lastModified: null }),
				close: async () => {},
			},
			autoStart: false,
			now: () => now,
		});
	let module = await create();
	try {
		expect(
			module.api.subscriptions.profiles().profiles.map((profile) => profile.id),
		).toContain("custom:any");
		const stamp = {
			revision: "target",
			connectionGeneration: module.api.connection.settings().generation,
			scopeId: "root",
			path: "/downloads",
			validated: true,
			visibilityVerified: false,
		};
		database.acquisitionDownloads.saveDestination(stamp);
		const subscription = await module.api.subscriptions.save({
			workKey: "anilist:anime:1",
			source: { kind: "feed" as const, url: "https://example.org/rss" },
			startEpisode: 1,
			revision: null,
			profileId: "builtin:efficient",
			destinationRevision: stamp.revision,
			connectionGeneration: stamp.connectionGeneration,
		});
		const saved = await module.api.subscriptions.refresh(
			"anilist:anime:1",
			subscription.subscription?.revision ?? "",
		);
		expect(saved.candidates[0]?.reasons).toContain("waiting_for_level");
		await module.close();
		database.close();
		database = ApplicationDatabase.open(dir);
		now += 180 * 60_000;
		xml = null;
		module = await create();
		const refreshed = await module.api.subscriptions.refresh(
			"anilist:anime:1",
			saved.subscription?.revision ?? "",
		);
		expect(refreshed.subscription?.profileId).toBe("builtin:efficient");
		expect(refreshed.candidates[0]).toMatchObject({
			status: "selected",
			selection: { firstSeenAt: 1000, eligibleAt: 10_801_000 },
		});
	} finally {
		await module.close();
		database.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("same-group revisions resolve before deterministic publication ties", () => {
	const entries = [
		entry("v1", "[1080p AVC]"),
		{
			...entry("v2", "[1080p AVC]"),
			title: "[G] Frieren - 03v2 [1080p AVC]",
			publishedAt: 2,
		},
		{
			...entry("other", "[1080p AVC]"),
			title: "[Other] Frieren - 03 [1080p AVC]",
			publishedAt: 3,
		},
	];
	expect(chosen(select(entries))).toEqual(["v2"]);
	expect(chosen(select([...entries].reverse()))).toEqual(["v2"]);
	expect(
		select(entries).find((candidate) => candidate.entryId === "v1")?.reasons,
	).toContain("newer_revision_available");
	expect(
		assessReleaseTitle("[G] Frieren - 03 [4K HEVC]", target).attributes
			?.resolutions,
	).toEqual([2160]);
	expect(
		assessReleaseTitle("[简体字幕组] Frieren - 03 [1080p]", target).attributes
			?.subtitleLanguages,
	).toEqual([]);
});

test("built-in collection windows unlock at their declared thresholds", () => {
	const expected = [
		[60, 120],
		[120, 180, 240],
		[60, 120],
	];
	for (const [index, profile] of builtinAcquisitionProfiles.entries()) {
		expect(profile.levels.map((level) => level.acceptAfterMinutes)).toEqual(
			expected[index],
		);
		for (const [levelIndex, level] of profile.levels.entries()) {
			const suffix =
				levelIndex === profile.levels.length - 1
					? "[720p AVC][CHS]"
					: index === 1 && levelIndex === 0
						? "[1080p HEVC][CHS]"
						: "[1080p AVC][CHS]";
			const entries = [entry("episode", suffix)];
			const first = select(entries, profile, 1000);
			expect(chosen(first)).toEqual([]);
			const threshold = 1000 + level.acceptAfterMinutes * 60_000;
			expect(chosen(select(entries, profile, threshold - 1, first))).toEqual(
				[],
			);
			expect(chosen(select(entries, profile, threshold, first))).toEqual([
				"episode",
			]);
		}
	}
});

test("invalid custom acquisition profiles fall back to built-ins and report an issue", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-acquisition-"));
	try {
		await writeFile(
			join(directory, "acquisition-profiles.yaml"),
			"version: 2\nprofiles: []\n",
		);
		const loaded = await loadAcquisitionProfiles(directory);
		expect(loaded.profiles).toEqual([...builtinAcquisitionProfiles]);
		expect(loaded.issue).toMatchObject({
			file: "acquisition-profiles.yaml",
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
