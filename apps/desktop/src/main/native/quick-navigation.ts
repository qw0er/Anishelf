import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import type { MenuItemConstructorOptions } from "electron";
import { type DesktopLocale, resolveDesktopLocale } from "./locale.js";

interface QuickNavigationCopy {
	library: string;
	history: string;
	offlineCache: string;
	review: string;
	subscriptions: string;
}

const copyByLocale: Record<DesktopLocale, QuickNavigationCopy> = {
	en: {
		library: "Library",
		history: "History",
		offlineCache: "Offline Cache",
		review: "Review",
		subscriptions: "Subscriptions",
	},
	"zh-CN": {
		library: "媒体库",
		history: "播放记录",
		offlineCache: "离线缓存",
		review: "审核",
		subscriptions: "订阅",
	},
};

/** Normalize a badge or review count to a non-negative integer. */
export function normalizeBadgeCount(count: number): number {
	if (!Number.isFinite(count) || count <= 0) return 0;
	return Math.trunc(count);
}

/** Build shared static navigation items for tray and Dock menus. */
export function buildQuickNavigationItems(options: {
	locale: string;
	navigate(path: string): void;
	pendingReviewCount?: number;
}): MenuItemConstructorOptions[] {
	const locale = resolveDesktopLocale(options.locale);
	const copy = copyByLocale[locale];
	const pending = normalizeBadgeCount(options.pendingReviewCount ?? 0);
	const reviewLabel = pending > 0 ? `${copy.review} (${pending})` : copy.review;

	return [
		{
			label: copy.library,
			click: () => options.navigate("/"),
		},
		{
			label: copy.history,
			click: () => options.navigate("/history"),
		},
		{
			label: copy.offlineCache,
			click: () => options.navigate(offlineCachePath),
		},
		{
			label: reviewLabel,
			click: () => options.navigate("/review"),
		},
		{
			label: copy.subscriptions,
			click: () => options.navigate("/subscriptions"),
		},
	];
}
