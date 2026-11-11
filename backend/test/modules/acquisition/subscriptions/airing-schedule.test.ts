import { expect, test } from "vitest";
import {
	airingPolicy,
	scheduleAiring,
} from "../../../../src/modules/acquisition/subscriptions/domain/airing-schedule.js";
import type { AcquisitionTarget } from "../../../../src/modules/anime/public.js";

const now = Date.UTC(2026, 10, 1, 5, 30);
function target(
	status = "RELEASING",
	episode = 3,
	airingAt = now + 3600_000,
): AcquisitionTarget {
	return {
		searchTitles: [],
		work: {
			reference: { id: "1" },
			snapshotId: "meta",
			titles: [],
			year: null,
			format: null,
			episodeCount: 12,
			season: null,
			part: null,
		},
		availableEpisodes: [],
		revision: "r",
		airing: {
			status,
			nextEpisode: { episode, airingAt },
			fetchedAt: now,
			stale: false,
			refreshError: false,
		},
	};
}
test("future episodes wait through a fifteen-minute release allowance without early probes", () => {
	const value = scheduleAiring({ startEpisode: 3 }, target(), now, 0);
	expect(value).toMatchObject({
		reason: "waiting_for_episode",
		episode: 3,
		nextCheckAt: now + 3600_000 + airingPolicy.releaseDelayMs,
	});
	const delayed = scheduleAiring(
		{ startEpisode: 3, schedule: value },
		target(),
		now + 3600_000,
		0,
	);
	expect(delayed.reason).toBe("release_delay");
	const due = scheduleAiring(
		{ startEpisode: 3, schedule: delayed },
		target(),
		now + 3600_000 + airingPolicy.releaseDelayMs,
		now + 2 * 3600_000,
	);
	expect(due.reason).toBe("due");
	expect(due.nextCheckAt).toBeLessThanOrEqual(
		now + 3600_000 + airingPolicy.releaseDelayMs,
	);
});
test("fresh premiere status without a precise time only schedules metadata checks", () => {
	const value = target("NOT_YET_RELEASED", 1);
	if (!value.airing) throw Error();
	value.airing.nextEpisode = null;
	expect(scheduleAiring({ startEpisode: 1 }, value, now, 0)).toMatchObject({
		reason: "waiting_for_premiere",
		airingAt: null,
		nextCheckAt: null,
		metadataCheckAt: now + airingPolicy.metadataIntervalMs,
	});
});
test("backlogs and noncontiguous local coverage use the first missing accepted episode", () => {
	expect(scheduleAiring({ startEpisode: 2 }, target(), now, 42)).toMatchObject({
		reason: "backlog",
		episode: 2,
		nextCheckAt: 42,
	});
	const value = target("RELEASING", 4);
	value.availableEpisodes = [3, 5, 6];
	expect(scheduleAiring({ startEpisode: 3 }, value, now, 0)).toMatchObject({
		reason: "waiting_for_episode",
		episode: 4,
	});
	expect(scheduleAiring({ startEpisode: 8 }, value, now, 0)).toMatchObject({
		reason: "waiting_for_episode",
		episode: 8,
		airingAt: null,
		nextCheckAt: null,
	});
});
test.each([
	"stale",
	"error",
	"unknown",
	"invalid_episode",
	"invalid_time",
	"contradiction",
	"old",
	"missing",
])("%s information falls back rather than suppressing acquisition", (kind) => {
	const value = target();
	if (!value.airing) throw Error();
	if (kind === "stale") value.airing.stale = true;
	if (kind === "error") value.airing.refreshError = true;
	if (kind === "unknown") value.airing.status = null;
	if (kind === "invalid_episode")
		value.airing.nextEpisode = { episode: 99, airingAt: now + 3600_000 };
	if (kind === "invalid_time")
		value.airing.nextEpisode = { episode: 3, airingAt: NaN };
	if (kind === "contradiction") value.airing.status = "NOT_YET_RELEASED";
	if (kind === "old")
		value.airing.fetchedAt = now - airingPolicy.metadataIntervalMs;
	expect(
		scheduleAiring(
			{ startEpisode: 3 },
			kind === "missing" ? null : value,
			now,
			123,
		),
	).toMatchObject({ reason: "fallback", nextCheckAt: 123 });
});
test("a fresh next-episode rollover retains the known release allowance", () => {
	const previous = scheduleAiring({ startEpisode: 3 }, target(), now, 0);
	const value = target("RELEASING", 4, now + 7 * 86400_000);
	if (!value.airing) throw Error();
	value.airing.fetchedAt = now + 3600_000;
	expect(
		scheduleAiring(
			{ startEpisode: 3, schedule: previous },
			value,
			now + 3600_000,
			0,
		),
	).toMatchObject({
		reason: "release_delay",
		nextCheckAt: now + 3600_000 + airingPolicy.releaseDelayMs,
	});
});
test("absolute instants stay distinct across repeated local hours at the DST boundary", () => {
	const before = Date.UTC(2026, 10, 1, 5, 30),
		after = Date.UTC(2026, 10, 1, 6, 30);
	expect(
		scheduleAiring(
			{ startEpisode: 3 },
			target("RELEASING", 3, before),
			now - 3600_000,
			0,
		).reason,
	).toBe("fallback"); // future fetchedAt cannot be trusted
	for (const time of [before, after]) {
		const value = target("RELEASING", 3, time);
		if (!value.airing) throw Error();
		value.airing.fetchedAt = before - 3600_000;
		expect(
			scheduleAiring({ startEpisode: 3 }, value, before - 3600_000, 0)
				.nextCheckAt,
		).toBe(time + airingPolicy.releaseDelayMs);
	}
});

test("cache revalidation at airtime retains the known deadline, while a provider failure uses fallback", () => {
	const initial = scheduleAiring({ startEpisode: 3 }, target(), now, 0);
	const value = target();
	if (!value.airing) throw Error();
	value.airing.stale = true;
	value.airing.refreshing = true;
	const refreshing = scheduleAiring(
		{ startEpisode: 3, schedule: initial },
		value,
		now + 3600_000,
		0,
	);
	expect(refreshing).toMatchObject({
		reason: "release_delay",
		nextCheckAt: now + 4500_000,
		metadataFresh: false,
	});
	expect(
		scheduleAiring(
			{ startEpisode: 3, schedule: refreshing },
			value,
			now + 3630_000,
			0,
		).reason,
	).toBe("release_delay");
	value.airing.refreshError = true;
	expect(
		scheduleAiring(
			{ startEpisode: 3, schedule: refreshing },
			value,
			now + 3630_000,
			0,
		),
	).toMatchObject({ reason: "fallback", nextCheckAt: 0 });
});
test("a past next episode cannot prove a later accepted episode is still unaired", () => {
	expect(
		scheduleAiring(
			{ startEpisode: 5 },
			target("RELEASING", 3, now - 3600_000),
			now,
			0,
		).reason,
	).toBe("fallback");
});
