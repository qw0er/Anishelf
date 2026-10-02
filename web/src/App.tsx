import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Link,
	Outlet,
	useFetcher,
	useLoaderData,
	useLocation,
	useNavigation,
	useRevalidator,
} from "react-router";
import type {
	ClientConfigResponse,
	LibraryResponse,
	SettingsResponse,
} from "./api/contracts.js";
import AppHeader from "./components/app-header.js";
import { buttonStyles } from "./components/ui/button.js";
import { Spinner } from "./components/ui/spinner.js";
import { toast } from "./components/ui/toast.js";
import { useDelayedPending } from "./hooks/use-delayed-pending.js";
import type { libraryLoader, scanAction } from "./routes/loaders.js";
import "./i18n.js";
import { interactionPolicy } from "./lib/interaction-policy.js";

export interface LibraryContext {
	clientConfig: ClientConfigResponse;
	playerVersion: number;
	reload(): void;
	settings: SettingsResponse | null;
	library: LibraryResponse | null;
	libraryError: string | null;
	scanning: boolean;
	scanPending: boolean;
	scanSubmitting: boolean;
	refreshing: boolean;
	startScan(): void;
}

function App() {
	const { t } = useTranslation();
	const {
		library,
		clientConfig,
		settings,
		error: libraryError,
	} = useLoaderData<typeof libraryLoader>();
	const scanFetcher = useFetcher<typeof scanAction>();
	const { revalidate, state: revalidationState } = useRevalidator();
	const navigation = useNavigation();
	const location = useLocation();
	const [playerVersion, setPlayerVersion] = useState(0);
	const scanning = library?.scan?.status === "running";
	const lastScan = useRef(library?.scan);
	useEffect(() => {
		const scan = library?.scan;
		if (!scan) return;
		const previous = lastScan.current;
		lastScan.current = scan;
		if (previous?.id === scan.id && previous.status === scan.status) return;
		const id = `scan-result:${scan.id}`;
		if (scan.status === "completed") {
			if (scan.warnings.count > 0)
				toast.add({
					type: "warning",
					title: t("scan.completedWithWarnings", {
						count: scan.warnings.count,
					}),
					id,
				});
			else toast.add({ type: "success", title: t("scan.completed"), id });
		} else if (scan.status === "failed") {
			toast.add({
				type: "error",
				priority: "high",
				title: t(`errors.api.${scan.error.code}`),
				id,
			});
		}
	}, [library?.scan, t]);
	const scanSubmitting = scanFetcher.state === "submitting";
	const scanPending = scanFetcher.state !== "idle";
	const [manualRefreshing, setManualRefreshing] = useState(false);
	const showNavigation = useDelayedPending(
		navigation.state !== "idle",
		navigation.location?.key,
	);

	useEffect(() => {
		if (
			library?.scan?.status !== "running" ||
			manualRefreshing ||
			revalidationState !== "idle"
		)
			return;
		const timer = setTimeout(
			() => void revalidate(),
			interactionPolicy.scanPollIntervalMs,
		);
		return () => clearTimeout(timer);
	}, [library, revalidate, revalidationState, manualRefreshing]);

	async function reload() {
		setManualRefreshing(true);
		setPlayerVersion((value) => value + 1);
		try {
			await revalidate();
		} finally {
			setManualRefreshing(false);
		}
	}

	function startScan() {
		scanFetcher.submit(null, { method: "post", action: "/" });
	}

	return (
		<div className="min-h-screen bg-background">
			<AppHeader />
			<main
				className="page-container page-content"
				aria-busy={navigation.state !== "idle"}
			>
				{showNavigation && navigation.location && (
					<div
						className="action-row fixed right-4 bottom-4 z-50 max-w-[calc(100%-2rem)] rounded-md border bg-card p-4 text-sm shadow-sm"
						role="status"
					>
						<Spinner />
						<p>
							{navigation.location.pathname.startsWith("/files/")
								? t("navigation.loadingFile")
								: t("navigation.loadingFiles")}
						</p>
						<Link
							className={buttonStyles("outline")}
							to={`${location.pathname}${location.search}`}
						>
							{t("navigation.cancel")}
						</Link>
					</div>
				)}
				<Outlet
					context={
						{
							reload,
							playerVersion,
							settings,
							clientConfig,
							library,
							libraryError,
							scanning,
							scanPending,
							scanSubmitting,
							refreshing: manualRefreshing,
							startScan,
						} satisfies LibraryContext
					}
				/>
			</main>
		</div>
	);
}

export default App;
