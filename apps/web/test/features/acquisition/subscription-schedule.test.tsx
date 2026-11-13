// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import {
	formatAiringTime,
	SubscriptionSchedule,
} from "../../../src/features/acquisition/subscription-schedule.js";
import { subscriptionStatus } from "../../../src/features/acquisition/subscription-status.js";
import type { SubscriptionView } from "../../../src/shared/api/contracts.js";
import "../../../src/shared/i18n.js";

afterEach(cleanup);
const instant = Date.UTC(2026, 10, 1, 5, 30);
const schedule = {
	reason: "waiting_for_episode" as const,
	episode: 3,
	airingAt: instant,
	nextCheckAt: instant + 900_000,
	metadataCheckAt: instant,
	metadataFetchedAt: instant - 3600_000,
	metadataFresh: true,
	assessedAt: instant,
	lastAttemptAt: null,
	wakeAt: null,
};
test("absolute airing instants display an explicit browser or selected IANA time zone", () => {
	expect(formatAiringTime(instant, "en", "Asia/Tokyo")).toContain("Asia/Tokyo");
	expect(formatAiringTime(instant, "en", "UTC")).not.toBe(
		formatAiringTime(instant, "en", "Asia/Tokyo"),
	);
	const first = formatAiringTime(instant, "en", "America/New_York"),
		second = formatAiringTime(instant + 3600_000, "en", "America/New_York");
	expect(first).toContain("EDT");
	expect(second).toContain("EST");
});
test("date-only premiere information shows metadata checks without inventing an airing time", () => {
	render(
		<SubscriptionSchedule
			schedule={{
				...schedule,
				reason: "waiting_for_premiere",
				airingAt: null,
				nextCheckAt: null,
			}}
		/>,
	);
	expect(screen.getByText("Waiting for premiere")).toBeTruthy();
	expect(screen.queryByText(/Scheduled airing:/)).toBeNull();
	expect(screen.getByText(/Next airing information check:/)).toBeTruthy();
});
test("waiting is neutral, manual checks remain available, and failures take precedence", () => {
	const sub = {
		workKey: "anilist:anime:1",
		revision: "r",
		feedId: null,
		startEpisode: 3,
		enabled: true,
		management: "manual",
		runState: "active",
		source: "Automatic",
		sourceKind: "automatic",
		checkedAt: null,
		nextAttemptAt: 0,
		error: null,
		schedule,
	} satisfies NonNullable<SubscriptionView["subscription"]>;
	expect(subscriptionStatus(sub)).toMatchObject({
		label: "Waiting for episode 3 to air",
		tone: "neutral",
		needsAttention: false,
	});
	expect(subscriptionStatus({ ...sub, enabled: false }).label).not.toBe(
		"Waiting for episode 3 to air",
	);
	expect(subscriptionStatus({ ...sub, error: "fetch_failed" })).toMatchObject({
		needsAttention: true,
		tone: "warning",
	});
});
