import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
	createDesktopLoginItem,
	type DesktopLoginItemOptions,
	LAUNCH_AT_LOGIN_FLAG,
} from "../src/main/native/login-item.js";

const directories: string[] = [];

function setup(overrides: Partial<DesktopLoginItemOptions> = {}) {
	const appDataDir = mkdtempSync(join(tmpdir(), "anishelf-login-item-"));
	directories.push(appDataDir);
	return {
		entryPath: join(appDataDir, "autostart", "app.anishelf.desktop.desktop"),
		options: {
			platform: "linux",
			packaged: true,
			appDataDir,
			executablePath: "/opt/Anishelf/anishelf-desktop",
			native: {
				getOpenAtLogin: vi.fn(() => false),
				setOpenAtLogin: vi.fn(),
			},
			...overrides,
		} satisfies DesktopLoginItemOptions,
	};
}

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

test("writes and removes the Linux autostart entry", () => {
	const { entryPath, options } = setup();
	const item = createDesktopLoginItem(options);
	expect(item.state()).toEqual({ supported: true, enabled: false });

	item.setEnabled(true);
	expect(item.state()).toEqual({ supported: true, enabled: true });
	const entry = readFileSync(entryPath, "utf8");
	expect(entry).toContain("[Desktop Entry]");
	expect(entry).toContain(
		`Exec="/opt/Anishelf/anishelf-desktop" "${LAUNCH_AT_LOGIN_FLAG}"`,
	);
	expect(entry).toContain("X-GNOME-Autostart-enabled=true");

	item.setEnabled(false);
	expect(existsSync(entryPath)).toBe(false);
	expect(item.state()).toEqual({ supported: true, enabled: false });
});

test("uses the AppImage path and escapes desktop entry arguments", () => {
	const executablePath = "/tmp/.mount_anishelf/anishelf-desktop";
	const { entryPath, options } = setup({
		executablePath,
		appImagePath: "/home/me/Apps/Anishelf 1.7.0.AppImage",
	});
	createDesktopLoginItem(options).setEnabled(true);
	expect(readFileSync(entryPath, "utf8")).toContain(
		`Exec="/home/me/Apps/Anishelf 1.7.0.AppImage" "${LAUNCH_AT_LOGIN_FLAG}"`,
	);

	const escaped = createDesktopLoginItem({
		...options,
		executablePath: '/opt/Ani$helf`"100%',
		appImagePath: undefined,
	});
	escaped.setEnabled(true);
	expect(readFileSync(entryPath, "utf8")).toContain(
		'Exec="/opt/Ani\\$helf\\`\\"100%%" "--launch-at-login"',
	);
});

test("treats an autostart entry disabled by the desktop as disabled", () => {
	const { entryPath, options } = setup();
	const item = createDesktopLoginItem(options);
	item.setEnabled(true);
	const entry = readFileSync(entryPath, "utf8");

	writeFileSync(
		entryPath,
		entry.replace(
			"X-GNOME-Autostart-enabled=true",
			"X-GNOME-Autostart-enabled=false",
		),
	);
	expect(item.state()).toEqual({ supported: true, enabled: false });

	writeFileSync(entryPath, `${entry}Hidden=true\n`);
	expect(item.state()).toEqual({ supported: true, enabled: false });
});

test("uses the native login item on Windows and macOS", () => {
	for (const platform of ["win32", "darwin"] as const) {
		const getOpenAtLogin = vi.fn(() => false);
		let enabled = false;
		const setOpenAtLogin = vi.fn((value: boolean) => {
			enabled = value;
		});
		const item = createDesktopLoginItem({
			...setup().options,
			platform,
			native: {
				getOpenAtLogin: () => getOpenAtLogin() || enabled,
				setOpenAtLogin,
			},
		});
		expect(item.state()).toEqual({ supported: true, enabled: false });
		item.setEnabled(true);
		expect(setOpenAtLogin).toHaveBeenCalledWith(true);
		expect(item.state()).toEqual({ supported: true, enabled: true });
		item.setEnabled(false);
		expect(setOpenAtLogin).toHaveBeenLastCalledWith(false);
	}
});

test("reports packageless and unknown platforms as unsupported", () => {
	for (const options of [
		{ ...setup().options, packaged: false },
		{ ...setup().options, platform: "freebsd" as NodeJS.Platform },
	]) {
		const item = createDesktopLoginItem(options);
		expect(item.state()).toEqual({ supported: false, enabled: false });
		expect(() => item.setEnabled(true)).toThrow(
			"Launch at login is unavailable.",
		);
	}
});

test("rejects malformed preferences", () => {
	const item = createDesktopLoginItem(setup().options);
	expect(() => item.setEnabled("yes")).toThrow("Expected a login preference.");
});
