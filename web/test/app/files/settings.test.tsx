// @vitest-environment happy-dom

import { preparationConstraints } from "@anishelf/backend/contracts/defaults";
import { expect, test } from "vitest";
import {
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { openFile, renderApp } from "../support/render-app.js";
import { appFixture, fetcher, json } from "../support/state.js";

setupAppTest();

test("first-run setup saves the server directory and shows the automatic scan", async () => {
	appFixture.settings = { resourceRoots: [] };
	appFixture.library = {
		...appFixture.library,
		ready: false,
		scan: null,
		error: {
			code: "RESOURCE_ROOT_NOT_CONFIGURED",
			message: "Set a resource directory to start using the library.",
		},
	};
	renderApp();
	expect(
		(
			(await screen.findByRole("button", {
				name: "Scan library",
			})) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.click(
		within(
			screen.getByRole("navigation", { name: "Primary navigation" }),
		).getByRole("link", { name: "Settings" }),
	);
	const input = (await screen.findByLabelText(
		"New resource directory path",
	)) as HTMLInputElement;
	expect(input.value).toBe("");
	fireEvent.change(input, { target: { value: "/media/中文 videos" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByRole("button", { name: "Scan library" });
	expect(screen.getByTestId("location").textContent).toBe("/directories/root");
	expect(
		screen.queryByText("Set a resource directory to start using the library."),
	).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		fetcher.mock.calls.some(
			([path, init]) =>
				path === "/api/settings" &&
				init?.method === "PUT" &&
				init.body ===
					JSON.stringify({
						resourceRoots: ["/media/中文 videos"],
						transcodeCacheBudgetGiB:
							preparationConstraints.defaultCacheBudgetGiB,
					}),
		),
	).toBe(true);
	expect(
		fetcher.mock.calls.some(([path]) => path === "/api/library/scan"),
	).toBe(false);
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Scan library" })
				.getAttribute("aria-busy"),
		).toBe("true"),
	);
	fireEvent.click(screen.getByRole("link", { name: "Settings" }));
	expect(
		(
			screen.getByRole("button", {
				name: "Save directories",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

test("settings sections are deep-linked and keep inactive panels mounted", async () => {
	renderApp("/settings?section=downloads");
	const nav = await screen.findByRole("navigation", {
		name: "Settings sections",
	});
	const draft = await waitFor(() => {
		const input = document.getElementById(
			"source-api-url",
		) as HTMLInputElement | null;
		expect(input).toBeTruthy();
		return input as HTMLInputElement;
	});
	fireEvent.change(draft, { target: { value: "http://draft:9117/" } });
	const downloads = within(nav).getByRole("link", { name: "Downloads" });
	expect(downloads.getAttribute("aria-current")).toBe("page");
	expect(await screen.findByText("Jackett sources")).toBeTruthy();
	expect(within(nav).queryByRole("link", { name: "Sources" })).toBeNull();
	expect(
		document.querySelector('[data-settings-section="library"]')?.className,
	).toContain("hidden");

	fireEvent.click(within(nav).getByRole("link", { name: "Library" }));
	await waitFor(() =>
		expect(document.getElementById("source-api-url")).toBe(draft),
	);
	expect(draft.value).toBe("http://draft:9117/");

	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/settings?section=library",
		),
	);
	expect(
		document.querySelector('[data-settings-section="library"]')?.className,
	).not.toContain("hidden");
	expect(
		document.querySelector('[data-settings-section="downloads"]')?.className,
	).toContain("hidden");
});

test("saving a new directory returns from the player and unloads old media", async () => {
	renderApp();
	await openFile();
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.queryByRole("button", { name: "Scan library" })).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Settings" }));
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/root",
		),
	);
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	expect(video.getAttribute("src")).toBeNull();
	expect(screen.queryByRole("link", { name: "Season 1" })).toBeNull();
	expect(
		screen
			.getByRole("button", { name: "Scan library" })
			.getAttribute("aria-busy"),
	).toBe("true");
});

test("a failed settings save retains the draft list and supports a retry", async () => {
	const implementation = fetcher.getMockImplementation();
	let rejectSave = true;
	fetcher.mockImplementation((input, init) => {
		if (input === "/api/settings" && init?.method === "PUT" && rejectSave)
			return Promise.resolve(
				json(
					{
						error: {
							code: "CONFIG_WRITE_FAILED",
							message: "Settings could not be saved.",
							requestId: "settings-error",
						},
					},
					500,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/settings");
	const input = (await screen.findByLabelText(
		"New resource directory path",
	)) as HTMLInputElement;
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByText("Settings could not be saved.", {
		selector: "[data-slot=toast-title]",
	});
	expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Delete /new/media" }),
	).toBeTruthy();
	expect(screen.getByTestId("location").textContent).toBe("/settings");
	// The error toast appears before the fetcher returns to idle. Wait until
	// the form is usable so disabled controls are included in the retry.
	await waitFor(() => {
		expect(input.disabled).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Save directories",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});
	rejectSave = false;
	fireEvent.click(screen.getByRole("button", { name: "Save directories" }));
	await screen.findByRole("button", { name: "Scan library" });
	expect(
		fetcher.mock.calls.filter(
			([path, init]) => path === "/api/settings" && init?.method === "PUT",
		),
	).toHaveLength(2);
	expect(appFixture.settings.resourceRoots).toEqual(["/new/media"]);
	await screen.findByText("Settings saved.");
	await waitFor(() =>
		expect(
			screen.queryByText("Settings could not be saved.", {
				selector: "[data-slot=toast-title]",
			}),
		).toBeNull(),
	);
});

test("settings expose shared cache budget constraints", async () => {
	renderApp("/settings");
	const budget = await screen.findByLabelText<HTMLInputElement>(
		"Transcode cache budget (GiB)",
	);
	expect(budget.min).toBe("1");
});

test("settings save the edited directory list", async () => {
	renderApp("/settings");
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	fireEvent.change(input, { target: { value: "/disk-a/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	fireEvent.change(input, { target: { value: "/disk-b/中文 videos" } });
	fireEvent.keyDown(input, { key: "Enter" });
	expect(
		within(
			screen.getByRole("list", { name: "Resource directory paths" }),
		).getAllByRole("listitem"),
	).toHaveLength(2);
	expect(
		fetcher.mock.calls.some(
			([path, init]) => path === "/api/settings" && init?.method === "PUT",
		),
	).toBe(false);
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await waitFor(() =>
		expect(appFixture.settings.resourceRoots).toEqual([
			"/disk-a/media",
			"/disk-b/中文 videos",
		]),
	);
	await screen.findByRole("button", { name: "Scan library" });
	expect(screen.getByTestId("location").textContent).toBe("/directories/root");
});

test("duplicate paths stay editable without sending a settings request", async () => {
	renderApp("/settings");
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.change(input, { target: { value: "/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	await screen.findByText("This directory is already in the list.");
	expect(
		fetcher.mock.calls.some(
			([path, init]) => path === "/api/settings" && init?.method === "PUT",
		),
	).toBe(false);
	expect((input as HTMLInputElement).value).toBe("/media");
	expect(
		within(
			screen.getByRole("list", { name: "Resource directory paths" }),
		).getAllByRole("listitem"),
	).toHaveLength(1);
});

test("clearing the path list saves setup mode", async () => {
	renderApp("/settings");
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	await screen.findByText("No resource directories added.");
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await waitFor(() => expect(appFixture.settings.resourceRoots).toEqual([]));
	await screen.findByRole("button", { name: "Scan library" });
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});
