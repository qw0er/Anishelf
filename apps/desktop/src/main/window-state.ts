import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserWindow, screen } from "electron";

interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface WindowState {
	bounds: Bounds;
	maximized: boolean;
	fullscreen: boolean;
}

const defaultSize = { width: 1280, height: 800 };

function parseWindowState(value: unknown): WindowState | null {
	if (!value || typeof value !== "object") return null;
	const state = value as Record<string, unknown>;
	if (!state.bounds || typeof state.bounds !== "object") return null;
	const bounds = state.bounds as Record<string, unknown>;
	const { x, y, width, height } = bounds;
	if (
		typeof x !== "number" ||
		typeof y !== "number" ||
		typeof width !== "number" ||
		typeof height !== "number" ||
		![x, y, width, height].every(Number.isSafeInteger) ||
		width < 320 ||
		height < 240 ||
		width > 32768 ||
		height > 32768 ||
		typeof state.maximized !== "boolean" ||
		typeof state.fullscreen !== "boolean"
	)
		return null;
	return {
		bounds: { x, y, width, height },
		maximized: state.maximized,
		fullscreen: state.fullscreen,
	};
}

export class WindowStateStore {
	private readonly path: string;

	constructor(profile: string) {
		this.path = join(profile, "window-state.json");
	}

	read(): WindowState | null {
		try {
			const state = parseWindowState(
				JSON.parse(readFileSync(this.path, "utf8")),
			);
			if (!state) console.warn("desktop.window_state_invalid");
			return state;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				console.warn("desktop.window_state_read_failed");
			return null;
		}
	}

	windowOptions(state: WindowState | null): Partial<Bounds> {
		if (!state) return defaultSize;
		const { bounds } = state;
		const visible = screen.getAllDisplays().some(({ workArea }) => {
			const width =
				Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
				Math.max(bounds.x, workArea.x);
			const titleHeight =
				Math.min(bounds.y + 32, workArea.y + workArea.height) -
				Math.max(bounds.y, workArea.y);
			return width >= 64 && titleHeight >= 32;
		});
		if (visible) return bounds;
		console.info("desktop.window_state_offscreen");
		return { width: bounds.width, height: bounds.height };
	}

	manage(window: BrowserWindow, state: WindowState | null): void {
		if (state?.maximized) window.maximize();
		if (state?.fullscreen) window.setFullScreen(true);
		window.on("close", () => {
			const next: WindowState = {
				bounds: window.getNormalBounds(),
				maximized: window.isMaximized(),
				fullscreen: window.isFullScreen(),
			};
			const temporary = `${this.path}.${randomUUID()}.tmp`;
			try {
				writeFileSync(temporary, `${JSON.stringify(next)}\n`, {
					mode: 0o600,
					flag: "wx",
				});
				renameSync(temporary, this.path);
				console.info("desktop.window_state_saved", {
					maximized: next.maximized,
					fullscreen: next.fullscreen,
				});
			} catch {
				console.warn("desktop.window_state_save_failed");
			} finally {
				try {
					rmSync(temporary, { force: true });
				} catch {
					console.warn("desktop.window_state_cleanup_failed");
				}
			}
		});
	}
}
