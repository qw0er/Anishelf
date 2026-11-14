import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { DesktopLoginItemState } from "../../ipc/desktop.js";

export const LAUNCH_AT_LOGIN_FLAG = "--launch-at-login";

const linuxAutostartFile = "app.anishelf.desktop.desktop";

interface NativeLoginItem {
	getOpenAtLogin(): boolean;
	setOpenAtLogin(enabled: boolean): void;
}

export interface DesktopLoginItemOptions {
	platform: NodeJS.Platform;
	packaged: boolean;
	appDataDir: string;
	executablePath: string;
	appImagePath?: string | undefined;
	native: NativeLoginItem;
}

export interface DesktopLoginItem {
	state(): DesktopLoginItemState;
	setEnabled(value: unknown): void;
}

export function createDesktopLoginItem(
	options: DesktopLoginItemOptions,
): DesktopLoginItem {
	if (!options.packaged) return unsupportedLoginItem();
	if (options.platform === "linux") return createLinuxLoginItem(options);
	if (options.platform === "darwin" || options.platform === "win32")
		return createNativeLoginItem(options);
	return unsupportedLoginItem();
}

function unsupportedLoginItem(): DesktopLoginItem {
	return {
		state: () => ({ supported: false, enabled: false }),
		setEnabled: () => {
			throw new Error("Launch at login is unavailable.");
		},
	};
}

function createNativeLoginItem(
	options: DesktopLoginItemOptions,
): DesktopLoginItem {
	return {
		state: () => ({
			supported: true,
			enabled: options.native.getOpenAtLogin(),
		}),
		setEnabled(value) {
			if (typeof value !== "boolean")
				throw new Error("Expected a login preference.");
			options.native.setOpenAtLogin(value);
			console.info("desktop.login_item_preference_saved", { enabled: value });
		},
	};
}

function createLinuxLoginItem(
	options: DesktopLoginItemOptions,
): DesktopLoginItem {
	const path = join(options.appDataDir, "autostart", linuxAutostartFile);
	return {
		state: () => ({
			supported: true,
			enabled: isLinuxAutostartEnabled(path),
		}),
		setEnabled(value) {
			if (typeof value !== "boolean")
				throw new Error("Expected a login preference.");
			if (value)
				writeLinuxAutostart(
					path,
					buildAutostartEntry(loginExecutable(options), [LAUNCH_AT_LOGIN_FLAG]),
				);
			else removeLinuxAutostart(path);
			console.info("desktop.login_item_preference_saved", { enabled: value });
		},
	};
}

function loginExecutable(options: DesktopLoginItemOptions): string {
	const appImage = options.appImagePath?.trim();
	return appImage && isAbsolute(appImage) ? appImage : options.executablePath;
}

function buildAutostartEntry(
	executable: string,
	args: readonly string[],
): string {
	const command = [executable, ...args]
		.map(quoteDesktopEntryArgument)
		.join(" ");
	return [
		"[Desktop Entry]",
		"Type=Application",
		"Version=1.0",
		"Name=Anishelf",
		"Comment=Start Anishelf when you sign in",
		`Exec=${command}`,
		"Terminal=false",
		"Hidden=false",
		"X-GNOME-Autostart-enabled=true",
		"",
	].join("\n");
}

function quoteDesktopEntryArgument(value: string): string {
	if (/[\r\n]/.test(value))
		throw new Error("Login item paths cannot contain line breaks.");
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/`/g, "\\`")
		.replace(/\$/g, "\\$")
		.replace(/%/g, "%%");
	return `"${escaped}"`;
}

function isLinuxAutostartEnabled(path: string): boolean {
	let content: string;
	try {
		content = readFileSync(path, "utf8");
	} catch (error) {
		if (missingFile(error)) return false;
		throw new Error("Could not read the login item.", { cause: error });
	}
	return !isDisabledAutostartEntry(content);
}

function isDisabledAutostartEntry(content: string): boolean {
	for (const line of content.split(/\r?\n/)) {
		const match =
			/^\s*(Hidden|X-GNOME-Autostart-enabled)\s*=\s*(\S+)\s*$/i.exec(line);
		if (!match) continue;
		const key = match[1]?.toLowerCase();
		const value = match[2]?.toLowerCase();
		if (key === "hidden" && value === "true") return true;
		if (key === "x-gnome-autostart-enabled" && value === "false") return true;
	}
	return false;
}

function writeLinuxAutostart(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, content, { mode: 0o644, flag: "wx" });
		renameSync(temporary, path);
	} finally {
		try {
			rmSync(temporary, { force: true });
		} catch {
			console.warn("desktop.login_item_cleanup_failed");
		}
	}
}

function removeLinuxAutostart(path: string): void {
	if (!existsSync(path)) return;
	rmSync(path, { force: true });
}

function missingFile(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
