// @vitest-environment happy-dom

import { expect, test } from "vitest";
import { queryClient } from "../../../src/shared/api/query-client.js";
import { act, screen } from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { playbackTitleFixture } from "../support/playback.js";
import { renderApp } from "../support/render-app.js";
import { fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

test.each([
	["/files/file-1", "Local Frieren — Episode 1, Episode 2"],
	["/files/file-1?anime=work-1&episode=episode-2", "Local Frieren — Episode 2"],
])(
	"matched playback titles use work and mapped numbering: %s",
	async (path, title) => {
		const fallback = fetcher.getMockImplementation();
		fetcher.mockImplementation(async (input, init) =>
			String(input) === "/api/catalog/sources/file-1"
				? json(playbackTitleFixture())
				: requiredFetch(fallback)(input, init),
		);
		renderApp(path);
		await screen.findByRole("heading", { name: title });
		await screen.findByLabelText(`Video: ${title}`);
	},
);

test("late title corrections update the existing video without restarting playback", async () => {
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	await act(async () => {
		queryClient.setQueriesData(
			{
				queryKey: ["catalog"],
				predicate: (query) => query.queryKey[2] === "source",
			},
			playbackTitleFixture(),
		);
	});
	await screen.findByRole("heading", {
		name: "Local Frieren — Episode 1, Episode 2",
	});
	expect(
		screen.getByLabelText("Video: Local Frieren — Episode 1, Episode 2"),
	).toBe(video);
});

test.each(["version-old", "unavailable"])(
	"unmatched or stale catalog data preserves filename: %s",
	async (status) => {
		const fallback = requiredFetch(fetcher.getMockImplementation());
		fetcher.mockImplementation(async (input, init) => {
			if (String(input) !== "/api/catalog/sources/file-1")
				return fallback(input, init);
			return status === "unavailable"
				? json(
						{ error: { code: "CATALOG_UNAVAILABLE", message: "Offline" } },
						503,
					)
				: json({ ...playbackTitleFixture(), sourceVersion: status });
		});
		renderApp("/files/file-1");
		await screen.findByLabelText("Video: Episode 01.mp4");
		expect(
			screen.getByRole("heading", { name: "Episode 01.mp4" }),
		).toBeTruthy();
	},
);
