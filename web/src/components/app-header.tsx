import { Link, NavLink, useLocation } from "react-router";
import { buttonStyles } from "./ui/button.js";

export default function AppHeader({ pending = false }: { pending?: boolean }) {
	const { pathname } = useLocation();
	const browsing = pathname === "/" || pathname.startsWith("/directories/");
	return (
		<header className="border-b bg-card" inert={pending}>
			<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
				<Link className="text-lg font-semibold" to="/">
					Anishelf
				</Link>
				<nav
					aria-label="Primary navigation"
					className="flex items-center gap-1"
				>
					<NavLink
						to="/"
						className={({ isActive }) =>
							buttonStyles(isActive && browsing ? "secondary" : "ghost")
						}
					>
						Library
					</NavLink>
					<NavLink
						to="/settings"
						className={({ isActive }) =>
							buttonStyles(isActive ? "secondary" : "ghost")
						}
					>
						Settings
					</NavLink>
				</nav>
			</div>
		</header>
	);
}
