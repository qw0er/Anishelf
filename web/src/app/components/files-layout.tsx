import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useOutletContext } from "react-router";
import { PreparedMediaPage } from "../../features/media/ui.js";
import { buttonStyles } from "../../shared/components/ui/button.js";

import type { AppRuntime } from "../runtime/context.js";

export function FilesLayout() {
	const runtime = useOutletContext<AppRuntime>();
	const { t } = useTranslation();
	const { pathname } = useLocation();
	return (
		<div className="space-y-5">
			<nav aria-label={t("app.files")} className="flex flex-wrap gap-2">
				{(
					[
						[
							"/directories/root",
							"preparedMedia.originals",
							pathname.startsWith("/directories/"),
						],
						[
							"/prepared-media",
							"preparedMedia.title",
							pathname === "/prepared-media",
						],
					] as const
				).map(([path, label, active]) => (
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
