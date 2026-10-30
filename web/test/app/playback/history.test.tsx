// @vitest-environment happy-dom

import { expect, test } from "vitest";
import { fireEvent, screen } from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { fetcher, file, json } from "../support/state.js";

setupAppTest();

test("history displays saved progress and opens the player with its directory context", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/history")
			return Promise.resolve(
				json({
					availability: "checked",
					items: [
						{
							file: file.file,
							progress: {
								positionMs: 40000,
								durationMs: 100000,
								lastViewedAtMs: 1000,
								generation: 1,
								lastSequence: 1,
							},
						},
					],
				}),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/history");
	await screen.findByRole("heading", { name: "Playback history" });
	expect(screen.getByText("0:40 / 1:40")).toBeTruthy();
	fireEvent.click(screen.getByRole("link", { name: "Resume: Episode 01.mp4" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.getByTestId("location").textContent).toContain(
		"/files/file-1?directory=season-1",
	);
});

test.each(["checked", "unknown"])(
	"history explains its %s empty state",
	async (availability) => {
		const implementation = fetcher.getMockImplementation();
		fetcher.mockImplementation((input, init) => {
			if (String(input) === "/api/history")
				return Promise.resolve(json({ availability, items: [] }));
			if (!implementation) throw new Error("Missing mock");
			return implementation(input, init);
		});
		renderApp("/history");
		await screen.findByText(
			availability === "unknown"
				? "Scan your library to check which watched files are available."
				: "No playback history yet. Watch a file from your library to see it here.",
		);
	},
);
