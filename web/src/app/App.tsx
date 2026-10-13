import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Link,
	Outlet,
	ScrollRestoration,
	useLoaderData,
	useLocation,
	useNavigation,
	useRevalidator,
} from "react-router";
import {
	PreparationMonitor,
	PreparationProvider,
} from "../features/media/ui.js";
import {
	libraryQuery,
	startScan as startScanRequest,
} from "../features/resources/public.js";
import { settingsQuery } from "../features/settings/public.js";
import { QueryScope } from "../shared/api/queries.js";
import { buttonStyles } from "../shared/components/ui/button.js";
import { Spinner } from "../shared/components/ui/spinner.js";
import { toast } from "../shared/components/ui/toast.js";
import { useDelayedPending } from "../shared/hooks/use-delayed-pending.js";
import { getErrorTranslationKey } from "../shared/lib/error-translation.js";
import AppHeader from "./components/app-header.js";
import type { libraryLoader } from "./routes/loaders.js";
import "../shared/i18n.js";

import type { LibraryContext } from "../features/resources/public.js";

function App() {
	const { t } = useTranslation();
	const initial = useLoaderData<typeof libraryLoader>();
	const client = useQueryClient();
	const status = useQuery({
		...libraryQuery(),
		...(initial.library ? { initialData: initial.library } : {}),
	});
	const configuration = useQuery({
		...settingsQuery(),
		...(initial.settings ? { initialData: initial.settings } : {}),
	});
	const library = status.data ?? null;
	const settings = configuration.data ?? null;
	const libraryError =
		status.error || configuration.error
			? (getErrorTranslationKey(status.error ?? configuration.error) ??
				"errors.libraryStatus")
			: initial.error && !library
				? initial.error
				: null;
	const scanMutation = useMutation({
		mutationFn: () => startScanRequest(),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["library"] });
		},
		onError: (error) =>
			toast.add({
				id: "scan-start",
				type: "error",
				priority: "high",
				title: t(getErrorTranslationKey(error) ?? "errors.startScan"),
			}),
	});
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
			void client.invalidateQueries({ queryKey: ["directory"] });
			void client.invalidateQueries({ queryKey: ["history"] });
			void client.invalidateQueries({ queryKey: ["catalog"] });
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
	}, [library?.scan, t, client]);
	const scanSubmitting = scanMutation.isPending;
	const scanPending = scanMutation.isPending;
	const [manualRefreshing, setManualRefreshing] = useState(false);
	const refreshRequested = useRef(false);
	useEffect(() => {
		if (
			!refreshRequested.current ||
			manualRefreshing ||
			revalidationState !== "idle"
		)
			return;
		refreshRequested.current = false;
		if (libraryError)
			toast.add({
				id: "library-refresh",
				type: "error",
				priority: "high",
				title: t(libraryError),
			});
	}, [manualRefreshing, revalidationState, libraryError, t]);
	const showNavigation = useDelayedPending(
		navigation.state !== "idle",
		navigation.location?.key,
	);

	async function reload() {
		refreshRequested.current = true;
		toast.close("library-refresh");
		setManualRefreshing(true);
		setPlayerVersion((value) => value + 1);
		try {
			await client.invalidateQueries({
				predicate: (query) => query.queryKey[0] !== "playback-selection",
			});
			await revalidate();
		} finally {
			setManualRefreshing(false);
		}
	}

	function startScan() {
		toast.close("scan-start");
		scanMutation.mutate();
	}

	return (
		<QueryScope
			value={JSON.stringify([settings?.resourceRoot, library?.revision])}
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
					<PreparationMonitor />
				</div>
			</PreparationProvider>
		</QueryScope>
	);
}

export default App;
