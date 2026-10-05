import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router";
import ThemeToggle from "./theme-toggle.js";
import { buttonStyles } from "./ui/button.js";

export default function AppHeader({ pending = false }: { pending?: boolean }) {
	const { t } = useTranslation();
	const { pathname } = useLocation();
	const browsing = pathname === "/" || pathname.startsWith("/directories/");
	return (
		<header className="border-b bg-card" inert={pending}>
			<div className="page-container flex flex-wrap items-center justify-between gap-4 py-3">
				<Link className="text-lg font-semibold" to="/">
					{t("app.name")}
				</Link>
				<nav aria-label={t("app.primaryNavigation")} className="action-row">
					<NavLink
						to="/"
						className={({ isActive }) =>
							buttonStyles(isActive && browsing ? "secondary" : "ghost")
						}
					>
						{t("app.library")}
					</NavLink>
					<NavLink
						to="/history"
						className={({ isActive }) =>
							buttonStyles(isActive ? "secondary" : "ghost")
						}
					>
						{t("app.history")}
					</NavLink>
					<NavLink
						to="/settings"
						className={({ isActive }) =>
							buttonStyles(isActive ? "secondary" : "ghost")
						}
					>
						{t("app.settings")}
					</NavLink>
					<NavLink
						to="/preparations"
						className={({ isActive }) =>
							buttonStyles(isActive ? "secondary" : "ghost")
						}
					>
						{t("preparation.title")}
					</NavLink>
					<ThemeToggle />
				</nav>
			</div>
		</header>
	);
}
