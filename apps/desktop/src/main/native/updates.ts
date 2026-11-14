import { compare, valid } from "semver";
import type { DesktopUpdateCheck } from "../../ipc/desktop.js";

const repository = "qw0er/Anishelf";
const releasesUrl = `https://github.com/${repository}/releases`;

interface DesktopBuild {
	version: string;
	stable: boolean;
	platform: NodeJS.Platform;
	arch: string;
}

type FetchRelease = (url: string, options: RequestInit) => Promise<Response>;

function packageNames(build: DesktopBuild, version: string) {
	const prefix = `anishelf-desktop-${version}-`;
	const { arch, platform } = build;
	if (platform === "win32") return [`${prefix}${arch}.exe`];
	if (platform === "darwin")
		return [`${prefix}${arch}.dmg`, `${prefix}universal.dmg`];
	if (platform !== "linux") return [];

	// electron-builder expands the architecture using each package format's spelling.
	const linuxNames: Record<string, [string, string, string]> = {
		x64: ["x86_64", "amd64", "x86_64"],
		arm64: ["arm64", "arm64", "aarch64"],
		ia32: ["i386", "i386", "i686"],
		arm: ["armv7l", "armv7l", "armv7l"],
	};
	const names = linuxNames[arch];
	if (!names) return [];
	const [appImageArch, debArch, rpmArch] = names;
	return [
		`${prefix}${appImageArch}.AppImage`,
		`${prefix}${debArch}.deb`,
		`${prefix}${rpmArch}.rpm`,
	];
}

function uploadedAssetName(asset: unknown): string | undefined {
	if (
		asset &&
		typeof asset === "object" &&
		"state" in asset &&
		asset.state === "uploaded" &&
		"name" in asset &&
		typeof asset.name === "string"
	)
		return asset.name;
}

export class DesktopUpdateChecker {
	private pending: Promise<DesktopUpdateCheck> | undefined;

	constructor(
		private readonly build: DesktopBuild,
		private readonly fetchRelease: FetchRelease,
	) {}

	check(): Promise<DesktopUpdateCheck> {
		this.pending ??= this.load()
			.then((result) => {
				console.info("desktop.update_checked", {
					status: result.status,
					version: result.latest?.version,
				});
				return result;
			})
			.catch((error: unknown) => {
				console.warn("desktop.update_check_failed", { error });
				throw error;
			})
			.finally(() => {
				this.pending = undefined;
			});
		return this.pending;
	}

	private async load(): Promise<DesktopUpdateCheck> {
		const response = await this.fetchRelease(
			`https://api.github.com/repos/${repository}/releases/latest`,
			{
				headers: { Accept: "application/vnd.github+json" },
				credentials: "omit",
				redirect: "error",
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!response.ok) {
			await response.body?.cancel();
			if (response.status === 404)
				return {
					status: "no-release",
					checkedAt: new Date().toISOString(),
					latest: null,
				};
			throw new Error(`GitHub returned HTTP ${response.status}.`);
		}
		const release: unknown = await response.json();
		if (
			!release ||
			typeof release !== "object" ||
			!("tag_name" in release) ||
			typeof release.tag_name !== "string" ||
			!valid(release.tag_name) ||
			!("draft" in release) ||
			release.draft !== false ||
			!("prerelease" in release) ||
			release.prerelease !== false ||
			!("assets" in release) ||
			!Array.isArray(release.assets)
		)
			throw new Error("Invalid stable release response.");

		const tag = encodeURIComponent(release.tag_name);
		const result = {
			checkedAt: new Date().toISOString(),
			latest: { version: release.tag_name, url: `${releasesUrl}/tag/${tag}` },
		};
		if (!this.build.stable || !valid(this.build.version))
			return { ...result, status: "uncomparable" };

		const comparison = compare(release.tag_name, this.build.version);
		if (comparison === 0) return { ...result, status: "current" };
		if (comparison < 0) return { ...result, status: "ahead" };

		const assets = new Set(release.assets.map(uploadedAssetName));
		const matching = packageNames(
			this.build,
			release.tag_name.replace(/^v/, ""),
		).filter((name) => assets.has(name));
		const downloads = (
			this.build.platform === "darwin" ? matching.slice(0, 1) : matching
		).map((name) => ({
			name: name.slice(name.lastIndexOf(".") + 1),
			url: `${releasesUrl}/download/${tag}/${encodeURIComponent(name)}`,
		}));
		return downloads.length > 0
			? { ...result, status: "available", downloads }
			: { ...result, status: "no-package" };
	}
}
