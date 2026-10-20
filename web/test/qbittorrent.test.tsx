// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { QbittorrentSettings } from "../src/features/acquisition/webui-settings.js";
import * as api from "../src/shared/api/client.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("saves a direct browser address and clearing hides the link", async () => {
	let settings = {
		resourceRoots: ["/media"],
		qbittorrentWebUiUrl: null as string | null,
	};
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (_path, method, _options, payload) => {
			if (method === "PUT") {
				const url =
					(
						payload as { qbittorrentWebUiUrl: string }
					).qbittorrentWebUiUrl.trim() || null;
				settings = {
					...settings,
					qbittorrentWebUiUrl: url,
				};
			}
			return settings;
		});
	render(<QbittorrentSettings />);
	await screen.findByText("Save a WebUI URL to open qBittorrent.");
	expect(screen.queryByRole("link")).toBeNull();
	const input = screen.getByLabelText("WebUI URL");
	fireEvent.change(input, {
		target: { value: "https://downloads.example.com/" },
	});
	expect(request.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(
		0,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"https://downloads.example.com/",
		),
	);
	expect(screen.getByRole("link").getAttribute("rel")).toBe(
		"noopener noreferrer",
	);
	expect(request.mock.calls.filter((call) => call[1] === "PUT")).toEqual([
		[
			"/api/settings",
			"PUT",
			undefined,
			{ qbittorrentWebUiUrl: "https://downloads.example.com/" },
		],
	]);
	fireEvent.change(input, { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
	expect(request.mock.calls.every((call) => call[0] === "/api/settings")).toBe(
		true,
	);
});

test("shows configuration guidance when no WebUI URL is saved", async () => {
	vi.spyOn(api, "request").mockResolvedValue({ resourceRoots: [] });
	render(<QbittorrentSettings />);
	expect(
		await screen.findByText("Save a WebUI URL to open qBittorrent."),
	).toBeTruthy();
	expect(screen.queryByRole("link")).toBeNull();
});
