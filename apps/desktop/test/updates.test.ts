import { expect, test, vi } from "vitest";
import { DesktopUpdateChecker } from "../src/main/native/updates.js";

const release = {
	tag_name: "v2.0.0",
	draft: false,
	prerelease: false,
	assets: [
		"anishelf-desktop-2.0.0-x86_64.AppImage",
		"anishelf-desktop-2.0.0-amd64.deb",
		"anishelf-desktop-2.0.0-x86_64.rpm",
		"anishelf-desktop-2.0.0-x64.exe",
		"anishelf-desktop-2.0.0-arm64.dmg",
	].map((name) => ({ name, state: "uploaded" })),
};

test.each([
	{ platform: "linux", arch: "x64", formats: ["AppImage", "deb", "rpm"] },
	{ platform: "win32", arch: "x64", formats: ["exe"] },
	{ platform: "darwin", arch: "arm64", formats: ["dmg"] },
] as const)(
	"finds the published $platform $arch installers",
	async ({ platform, arch, formats }) => {
		const checker = new DesktopUpdateChecker(
			{ platform, arch, version: "1.7.0", stable: true },
			async () => Response.json(release),
		);
		const result = await checker.check();
		expect(result.status).toBe("available");
		expect(result.downloads?.map(({ name }) => name)).toEqual(formats);
		for (const download of result.downloads ?? []) {
			expect(download.url).toContain(
				"https://github.com/qw0er/Anishelf/releases/download/v2.0.0/anishelf-desktop-2.0.0-",
			);
		}
	},
);

test.each([
	{ version: "1.7.0", stable: true, status: "no-package" },
	{ version: "2.0.0", stable: true, status: "current" },
	{ version: "3.0.0", stable: true, status: "ahead" },
	{ version: "1.7.0", stable: false, status: "uncomparable" },
])(
	"returns $status with no download link",
	async ({ version, stable, status }) => {
		const checker = new DesktopUpdateChecker(
			{ platform: "linux", arch: "arm64", version, stable },
			async () => Response.json(release),
		);
		expect(await checker.check()).toMatchObject({ status });
		expect(await checker.check()).not.toHaveProperty("downloads");
	},
);

test("shares an in-flight check and allows retry after a network error", async () => {
	const fetchRelease = vi
		.fn()
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValueOnce(new Response(null, { status: 404 }));
	const checker = new DesktopUpdateChecker(
		{ platform: "linux", arch: "x64", version: "1.7.0", stable: true },
		fetchRelease,
	);
	const pending = checker.check();
	expect(checker.check()).toBe(pending);
	await expect(pending).rejects.toThrow("offline");
	expect(await checker.check()).toMatchObject({
		status: "no-release",
		latest: null,
	});
	expect(fetchRelease).toHaveBeenCalledTimes(2);
});
