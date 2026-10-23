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
import { resourceContext } from "../features/resources/public.js";
import { QueryScope } from "../shared/api/queries.js";
import { useSessionCheck } from "./auth/use-session-check.js";
import AppHeader from "./components/app-header.js";
import { NavigationPending } from "./components/navigation-pending.js";
import { useAppRuntimeState } from "./runtime/use-app-runtime.js";
export default function App() {
	const runtime = useAppRuntimeState();
	const navigation = useNavigation();
	const resources = resourceContext(runtime.settings, runtime.library);
	useSessionCheck();
	return (
		<QueryScope value={resources.scope}>
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
						key={resources.identity}
						enabled={resources.ready}
					/>
				</div>
			</PreparationProvider>
		</QueryScope>
	);
}
