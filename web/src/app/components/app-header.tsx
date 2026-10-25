import {
	FolderOpen,
	History,
	Library,
	ListChecks,
	Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router";
import LanguageToggle from "../../shared/components/language-toggle.js";
import ThemeToggle from "../../shared/components/theme-toggle.js";
import { buttonStyles } from "../../shared/components/ui/button.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";

import { useCompactNavigation } from "../../shared/hooks/use-compact-navigation.js";

export default function AppHeader({ pending = false }: { pending?: boolean }) {
	const { t } = useTranslation();
	const navigationRef = useCompactNavigation();
	const { pathname } = useLocation();
	const entries = [
		{
			to: "/",
			label: t("app.library"),
			icon: Library,
			active: pathname === "/" || pathname.startsWith("/anime/"),
		},
		{
			to: "/directories/root",
			label: t("app.files"),
			icon: FolderOpen,
			active: pathname.startsWith("/directories/"),
		},
		{
			to: "/review",
			label: t("review.title"),
			icon: ListChecks,
			active: pathname === "/review",
		},
		{
			to: "/history",
			label: t("app.history"),
			icon: History,
			active: pathname === "/history",
		},
		{
			to: "/settings",
			label: t("app.settings"),
			icon: Settings,
			active: pathname === "/settings",
		},
	];
	return (
		<header className="border-b bg-card" inert={pending}>
			<div className="page-container app-header-container">
				<div className="flex min-w-0 items-center gap-3 py-2">
					<Link
						className="shrink-0 whitespace-nowrap text-lg font-semibold"
						to="/"
					>
						{t("app.name")}
					</Link>
					<nav
						ref={navigationRef}
						aria-label={t("app.primaryNavigation")}
						className="compact-navigation min-w-0 flex-1 overflow-x-auto p-1"
					>
						<div className="ml-auto flex w-max flex-nowrap items-center gap-1">
							{entries.map(({ to, label, icon: Icon, active }) => (
								<Tooltip key={to} content={label}>
									<NavLink
										to={to}
										end={to === "/"}
										aria-label={label}
										className={`${buttonStyles(active ? "secondary" : "ghost")} header-nav-link`}
									>
										<Icon
											size={16}
											aria-hidden="true"
											className="header-nav-icon"
										/>
										<span className="header-nav-label">{label}</span>
									</NavLink>
								</Tooltip>
							))}
							<LanguageToggle />
							<ThemeToggle />
						</div>
					</nav>
				</div>
			</div>
		</header>
	);
}
