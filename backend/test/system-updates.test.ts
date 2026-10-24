import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import type { BuildInfo } from "../src/contracts/http.js";
import { UpdateChecker } from "../src/modules/system/updates/application.js";

const current: BuildInfo = {
	version: "1.9.0",
	commit: "abc",
	channel: "stable",
	builtAt: null,
};
const logger = pino({ enabled: false });
const release = (version = "v1.10.0") =>
	Response.json({ tag_name: version, draft: false, prerelease: false });
afterEach(() => vi.useRealTimers());

test("compares semantic versions and deduplicates concurrent and cached checks", async () => {
	const fetcher = vi.fn<typeof fetch>().mockResolvedValue(release());
	const checker = new UpdateChecker(current, logger, fetcher);
	const [one, two] = await Promise.all([checker.check(), checker.check()]);
	expect(one.status).toBe("available");
	expect(two).toEqual(one);
	expect(await checker.check()).toEqual(one);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test.each([
	["v1.9.0", "current"],
	["v1.8.0", "ahead"],
])("reports %s as %s", async (version, status) => {
	const checker = new UpdateChecker(
		current,
		logger,
		vi.fn<typeof fetch>().mockResolvedValue(release(version)),
	);
	expect((await checker.check()).status).toBe(status);
});

test.each(["development", "testing", "prerelease"] as const)(
	"does not compare %s builds as stable",
	async (channel) => {
		const checker = new UpdateChecker(
			{ ...current, channel },
			logger,
			vi.fn<typeof fetch>().mockResolvedValue(release()),
		);
		expect((await checker.check()).status).toBe("uncomparable");
	},
);

test("distinguishes no release from upstream failure and backs off failures", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(null, { status: 404 }))
		.mockResolvedValue(new Response(null, { status: 403 }));
	const checker = new UpdateChecker(current, logger, fetcher);
	expect(await checker.check()).toMatchObject({
		status: "no-release",
		latest: null,
	});
	vi.useFakeTimers();
	vi.advanceTimersByTime(300_001);
	await expect(checker.check()).rejects.toThrow("403");
	await expect(checker.check()).rejects.toThrow("temporarily unavailable");
	expect(fetcher).toHaveBeenCalledTimes(2);
	vi.advanceTimersByTime(30_001);
	await expect(checker.check()).rejects.toThrow("403");
	expect(fetcher).toHaveBeenCalledTimes(3);
});

test.each([
	{ tag_name: "bad", draft: false, prerelease: false },
	{ tag_name: "v2.0.0-beta.1", draft: false, prerelease: true },
	{ tag_name: "v2.0.0", draft: true, prerelease: false },
])("rejects malformed or non-public stable releases", async (value) => {
	const checker = new UpdateChecker(
		current,
		logger,
		vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)),
	);
	await expect(checker.check()).rejects.toThrow("Invalid stable release");
});
