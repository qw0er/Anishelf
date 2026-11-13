import { expect, test } from "vitest";
import {
	formatCommand,
	maskMediaUrl,
	substituteCommandArgs,
	validateCommandPlayer,
} from "../src/shared/player-command.js";

const media = {
	url: "https://example.test/api/media/file_123?access_token=secret&x=1",
	mimeType: "video/x-matroska",
};

test("validates command players and requires a URL placeholder", () => {
	expect(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["--", "{url}"],
		}),
	).toBeNull();
	expect(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["--no-terminal"],
		}),
	).toBe("externalPlayers.invalidCommand");
	expect(
		validateCommandPlayer({
			name: "",
			executable: "/usr/bin/mpv",
			args: ["{url}"],
		}),
	).toBe("externalPlayers.invalidCommand");
	expect(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["{unknown}", "{url}"],
		}),
	).toBe("externalPlayers.invalidCommand");
	expect(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["{url}\nnext"],
		}),
	).toBe("externalPlayers.invalidCommand");
});

test("substitutes URL, encoded URL and MIME type without recursive expansion", () => {
	const encoded = encodeURIComponent(media.url);
	expect(
		substituteCommandArgs(
			["--start=10", "{url}", "{urlEncoded}", "--type={mimeType}"],
			media,
		),
	).toEqual(["--start=10", media.url, encoded, "--type=video/x-matroska"]);
	expect(
		substituteCommandArgs(["{url}", "{mimeType}"], {
			url: "https://example.test/media",
			mimeType: "text/html",
		}),
	).toEqual(["https://example.test/media", "video/*"]);
	expect(() =>
		substituteCommandArgs(["{url}"], {
			url: "file:///etc/passwd",
			mimeType: "video/mp4",
		}),
	).toThrow();
});

test("masks access tokens and formats a display-only command", () => {
	const masked = maskMediaUrl(media.url);
	expect(masked).not.toContain("secret");
	expect(masked).toContain("access_token=***");
	expect(formatCommand("/usr/bin/mpv", ["--", media.url])).toBe(
		`/usr/bin/mpv -- "${media.url}"`,
	);
	expect(formatCommand("/usr/bin/mpv", ["{url}"])).toBe("/usr/bin/mpv {url}");
});
