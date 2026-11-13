import assert from "node:assert/strict";
import test from "node:test";
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
	assert.equal(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["--", "{url}"],
		}),
		null,
	);
	assert.equal(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["--no-terminal"],
		}),
		"externalPlayers.invalidCommand",
	);
	assert.equal(
		validateCommandPlayer({
			name: "",
			executable: "/usr/bin/mpv",
			args: ["{url}"],
		}),
		"externalPlayers.invalidCommand",
	);
	assert.equal(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["{unknown}", "{url}"],
		}),
		"externalPlayers.invalidCommand",
	);
	assert.equal(
		validateCommandPlayer({
			name: "mpv",
			executable: "/usr/bin/mpv",
			args: ["{url}\nnext"],
		}),
		"externalPlayers.invalidCommand",
	);
});

test("substitutes URL, encoded URL and MIME type without recursive expansion", () => {
	const encoded = encodeURIComponent(media.url);
	assert.deepEqual(
		substituteCommandArgs(
			["--start=10", "{url}", "{urlEncoded}", "--type={mimeType}"],
			media,
		),
		["--start=10", media.url, encoded, "--type=video/x-matroska"],
	);
	assert.deepEqual(
		substituteCommandArgs(["{url}", "{mimeType}"], {
			url: "https://example.test/media",
			mimeType: "text/html",
		}),
		["https://example.test/media", "video/*"],
	);
	assert.throws(() =>
		substituteCommandArgs(["{url}"], {
			url: "file:///etc/passwd",
			mimeType: "video/mp4",
		}),
	);
});

test("masks access tokens and formats a display-only command", () => {
	const masked = maskMediaUrl(media.url);
	assert.ok(!masked.includes("secret"));
	assert.ok(masked.includes("access_token=***"));
	assert.equal(
		formatCommand("/usr/bin/mpv", ["--", media.url]),
		`/usr/bin/mpv -- "${media.url}"`,
	);
	assert.equal(formatCommand("/usr/bin/mpv", ["{url}"]), "/usr/bin/mpv {url}");
});
