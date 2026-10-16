import { useEffect } from "react";
import { loadAuthSession } from "../shared/api/client.js";
import "../shared/i18n.js";
import { Outlet, ScrollRestoration, useNavigation } from "react-router";
import {
	IdentificationStatus,
	TrackingOperationMonitor,
} from "../features/anime/ui.js";
import {
	PreparationMonitor,
	PreparationProvider,
} from "../features/media/ui.js";
import { QueryScope } from "../shared/api/queries.js";
import AppHeader from "./components/app-header.js";
import { NavigationPending } from "./components/navigation-pending.js";
import { useAppRuntimeState } from "./runtime/use-app-runtime.js";
export default function App() {
	const runtime = useAppRuntimeState();
	const navigation = useNavigation();
	useEffect(() => {
		let active = true;
		const check = () => {
			void loadAuthSession()
				.then((session) => {
					if (active && !session.authenticated)
						window.dispatchEvent(new Event("anishelf:auth-required"));
				})
				.catch(() => {});
		};
		const timer = window.setInterval(check, 60_000);
		window.addEventListener("focus", check);
		return () => {
			active = false;
			window.clearInterval(timer);
			window.removeEventListener("focus", check);
		};
	}, []);
	return (
		<QueryScope
			value={JSON.stringify([
				runtime.settings?.resourceRoot,
				runtime.library?.revision,
			])}
		>
			<PreparationProvider>
				<div className="min-h-screen bg-background">
					<AppHeader />
					<ScrollRestoration
						getKey={(location) => `${location.pathname}${location.search}`}
					/>
					<main
						className="page-container page-content"
						aria-busy={navigation.state !== "idle"}
					>
						<NavigationPending />
						<Outlet context={runtime} />
					</main>
					<PreparationMonitor />
					<TrackingOperationMonitor />
					<IdentificationStatus
						key={runtime.settings?.resourceRoot ?? "unconfigured"}
						enabled={Boolean(
							runtime.settings?.resourceRoot && runtime.library?.ready,
						)}
					/>
				</div>
			</PreparationProvider>
		</QueryScope>
	);
}
