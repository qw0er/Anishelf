import { type Dock, Menu, type MenuItemConstructorOptions } from "electron";
import { type DesktopLocale, resolveDesktopLocale } from "./locale.js";
import {
	buildQuickNavigationItems,
	normalizeBadgeCount,
} from "./quick-navigation.js";

export type DockMenuTarget = Pick<Dock, "setMenu">;

export interface DesktopDockMenuOptions {
	dock: DockMenuTarget;
	locale: string;
	navigate(path: string): void;
}

/** Build the macOS Dock menu template for the current locale. */
export function buildDockMenuTemplate(options: {
	locale: string;
	navigate(path: string): void;
	pendingReviewCount?: number;
}): MenuItemConstructorOptions[] {
	return buildQuickNavigationItems(options);
}

/** Manages the native macOS Dock menu and refreshes it on locale or review-count changes. */
export class DesktopDockMenu {
	private readonly dock: DockMenuTarget;
	private readonly navigate: (path: string) => void;
	private locale: DesktopLocale;
	private pendingReviewCount = 0;
	private disposed = false;

	constructor(options: DesktopDockMenuOptions) {
		this.dock = options.dock;
		this.navigate = options.navigate;
		this.locale = resolveDesktopLocale(options.locale);
		this.apply();
		console.info("desktop.dock_menu_configured", { locale: this.locale });
	}

	setLanguage(language: string): void {
		if (this.disposed) return;
		const next = resolveDesktopLocale(language);
		if (next === this.locale) return;
		this.locale = next;
		this.apply();
		console.debug("desktop.dock_menu_language_updated", {
			locale: this.locale,
		});
	}

	setPendingReviewCount(count: number): void {
		if (this.disposed) return;
		const next = normalizeBadgeCount(count);
		if (next === this.pendingReviewCount) return;
		this.pendingReviewCount = next;
		this.apply();
		console.debug("desktop.dock_menu_review_count_updated", { count: next });
	}

	dispose(): void {
		this.disposed = true;
	}

	private apply(): void {
		try {
			this.dock.setMenu(
				Menu.buildFromTemplate(
					buildDockMenuTemplate({
						locale: this.locale,
						navigate: this.navigate,
						pendingReviewCount: this.pendingReviewCount,
					}),
				),
			);
		} catch (error) {
			console.warn("desktop.dock_menu_failed", { error });
		}
	}
}
