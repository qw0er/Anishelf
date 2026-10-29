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
	] as const;
	return (
		<header className="app-shell-header" inert={pending}>
			<div className="app-brand-row">
				<Link className="app-brand" to="/">
					<Library size={22} aria-hidden="true" />
					<span>{t("app.name")}</span>
				</Link>
				<div className="app-preferences">
					<LanguageToggle />
					<ThemeToggle />
				</div>
			</div>
			<nav
				ref={navigationRef}
				aria-label={t("app.primaryNavigation")}
				className="compact-navigation app-navigation"
			>
				<div className="app-navigation-items">
					{[entries[0], entries[3], entries[1], entries[2], entries[4]].map(
						({ to, label, icon: Icon, active }, index) => (
							<Tooltip key={to} content={label}>
								<NavLink
									to={to}
									end={to === "/"}
									aria-label={label}
									aria-current={active ? "page" : undefined}
									className={`${buttonStyles("ghost")} header-nav-link app-nav-item ${active ? "app-nav-active" : ""} ${index === 2 ? "app-nav-management" : ""} ${index === 4 ? "app-nav-settings" : ""}`}
								>
									<Icon
										size={18}
										aria-hidden="true"
										className="header-nav-icon"
									/>
									<span className="header-nav-label">{label}</span>
								</NavLink>
							</Tooltip>
						),
					)}
				</div>
			</nav>
		</header>
	);
}
