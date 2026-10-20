// @vitest-environment happy-dom
import { rssConstraints } from "@anishelf/backend/contracts/defaults";
import { afterEach, expect, test, vi } from "vitest";
import { RssSettings } from "../src/features/acquisition/rss-settings.js";
import * as api from "../src/shared/api/client.js";
import { queryClient } from "../src/shared/api/query-client.js";
import { toast } from "../src/shared/components/ui/toast.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});

test("shows the RSS default and saves drafts only on explicit Save", async () => {
	let settings: {
		resourceRoots: string[];
		rssRefreshIntervalMinutes?: number;
	} = { resourceRoots: [] };
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (_path, method, _options, payload) => {
			if (method === "PUT")
				settings = {
					...settings,
					...(payload as { rssRefreshIntervalMinutes: number }),
				};
			return settings;
		});
	const notice = vi.spyOn(toast, "add").mockReturnValue("rss-settings-save");
	const view = render(<RssSettings />);
	const input = await screen.findByRole("spinbutton", {
		name: "Refresh interval (minutes)",
	});
	expect((input as HTMLInputElement).value).toBe(
		String(rssConstraints.defaultRefreshIntervalMinutes),
	);
	fireEvent.change(input, { target: { value: "60" } });
	expect(request.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(
		0,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(request.mock.calls.filter((call) => call[1] === "PUT")).toEqual([
			["/api/settings", "PUT", undefined, { rssRefreshIntervalMinutes: 60 }],
		]),
	);
	await waitFor(() =>
		expect(notice).toHaveBeenCalledWith(
			expect.objectContaining({ type: "success" }),
		),
	);
	view.unmount();
	render(<RssSettings />);
	expect(
		((await screen.findByRole("spinbutton")) as HTMLInputElement).value,
	).toBe("60");
});

test("failed RSS saves retain the draft and allow retry", async () => {
	vi.spyOn(api, "request").mockImplementation(async (_path, method) => {
		if (method === "PUT") throw new Error("unavailable");
		return { resourceRoots: [], rssRefreshIntervalMinutes: 45 };
	});
	const notice = vi.spyOn(toast, "add").mockReturnValue("rss-settings-save");
	render(<RssSettings />);
	const input = await screen.findByRole("spinbutton");
	fireEvent.change(input, { target: { value: "60" } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(notice).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		),
	);
	expect((input as HTMLInputElement).value).toBe("60");
	expect(
		screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
	).toBe(false);
});
