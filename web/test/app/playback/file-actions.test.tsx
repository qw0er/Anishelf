// @vitest-environment happy-dom

import { expect, test, vi } from "vitest";
import { fireEvent, screen } from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { fetcher } from "../support/state.js";

setupAppTest();

test("file rows offer a dropdown menu for copying without opening playback", async () => {
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp();
	await screen.findByRole("link", { name: "Season 1" });
	expect(screen.queryByRole("button", { name: "Copy media link" })).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Season 1" }));
	await screen.findByRole("button", {
		name: "This browser reports support for this file.",
	});
	const trigger = await screen.findByRole("button", { name: "File actions" });
	fireEvent.click(trigger);
	const button = await screen.findByRole("menuitem", {
		name: "Copy media link",
	});
	expect(button.closest("a")).toBeNull();
	fireEvent.click(button);
	await screen.findByText(/Link copied/);
	expect(copy).toHaveBeenCalledWith(
		`${window.location.origin}/api/media/file-1?access_token=test-token`,
	);
	expect(screen.getByTestId("location").textContent).toBe(
		"/directories/season-1",
	);
	expect(
		fetcher.mock.calls.some(([url]) => url === "/api/playback/sessions"),
	).toBe(false);
});

test("file menu preserves manual copy fallback after closing", async () => {
	vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
		new Error("Clipboard unavailable"),
	);
	renderApp("/directories/season-1");
	fireEvent.click(await screen.findByRole("button", { name: "File actions" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Copy media link" }),
	);
	const field = await screen.findByRole("textbox", { name: "Media link" });
	expect((field as HTMLInputElement).value).toBe(
		`${window.location.origin}/api/media/file-1?access_token=test-token`,
	);
	expect(screen.queryByRole("menu")).toBeNull();
});
