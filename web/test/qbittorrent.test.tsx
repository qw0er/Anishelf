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

test("saves a custom browser address and clearing restores the built-in proxy", async () => {
	let settings = {
		resourceRoots: ["/media"],
		qbittorrentWebUiUrl: null as string | null,
	};
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, payload) => {
			if (path === "/api/integrations/qbittorrent")
				return {
					url: settings.qbittorrentWebUiUrl ?? "/integrations/qbittorrent/",
					proxyConfigured: true,
				};
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
	expect(
		(
			await screen.findByRole("link", { name: "Open qBittorrent WebUI" })
		).getAttribute("href"),
	).toBe("/integrations/qbittorrent/");
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
	await waitFor(() =>
		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"/integrations/qbittorrent/",
		),
	);
});

test("shows actionable configuration when the default proxy has no upstream", async () => {
	vi.spyOn(api, "request").mockImplementation(async (path) =>
		path === "/api/settings"
			? { resourceRoots: [], qbittorrentWebUiUrl: null }
			: { url: "/integrations/qbittorrent/", proxyConfigured: false },
	);
	render(<QbittorrentSettings />);
	expect(await screen.findByText(/Set ANISHELF_QBITTORRENT_URL/)).toBeTruthy();
	expect(screen.queryByRole("link")).toBeNull();
});
