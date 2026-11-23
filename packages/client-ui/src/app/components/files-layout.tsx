import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useOutletContext } from "react-router";
import { PreparedMediaPage } from "../../features/media/ui.js";
import { buttonStyles } from "../../shared/components/ui/button.js";

import type { AppRuntime } from "../runtime/context.js";

export function FilesNavigation({
	offlineCache = false,
}: {
	offlineCache?: boolean;
}) {
	const { t } = useTranslation();
	const { pathname } = useLocation();
	const links = [
		{
			path: "/directories/root",
			label: "preparedMedia.originals",
			active: pathname.startsWith("/directories/"),
		},
		{
			path: "/prepared-media",
			label: "preparedMedia.title",
			active: pathname === "/prepared-media",
		},
	];
	if (offlineCache)
		links.push({
			path: offlineCachePath,
			label: "offlineCache.title",
			active:
				pathname === offlineCachePath ||
				pathname.startsWith(`${offlineCachePath}/`),
		});
	return (
		<nav aria-label={t("app.files")} className="flex flex-wrap gap-2">
			{links.map(({ path, label, active }) => (
				<Link
					key={path}
					to={path}
					aria-current={active ? "page" : undefined}
					className={`${buttonStyles("ghost")} ${active ? "bg-accent text-accent-foreground" : ""}`}
				>
					{t(label)}
				</Link>
			))}
		</nav>
	);
}

export function FilesLayout({
	offlineCache = false,
}: {
	offlineCache?: boolean;
}) {
	const runtime = useOutletContext<AppRuntime>();
	return (
		<div className="space-y-5">
			<FilesNavigation offlineCache={offlineCache} />
			<Outlet context={runtime} />
		</div>
	);
}

export function PreparedMediaRoute() {
	const client = useQueryClient();
	return (
		<PreparedMediaPage
			onDeleted={() => {
				void client.invalidateQueries({ queryKey: ["playback-assets"] });
				void client.invalidateQueries({ queryKey: ["compatibility"] });
			}}
		/>
	);
}
