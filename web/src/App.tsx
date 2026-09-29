import { RefreshCw, ScanLine } from "lucide-react";
import { useEffect, useState } from "react";
import {
	Link,
	Outlet,
	useFetcher,
	useLoaderData,
	useLocation,
	useNavigation,
	useRevalidator,
} from "react-router";
import type { libraryLoader, scanAction } from "./routes/loaders.js";

export interface LibraryContext {
	playerVersion: number;
	reload(): void;
}

function App() {
	const { library, error: libraryError } =
		useLoaderData<typeof libraryLoader>();
	const scanFetcher = useFetcher<typeof scanAction>();
	const { revalidate, state: revalidationState } = useRevalidator();
	const navigation = useNavigation();
	const location = useLocation();
	const [playerVersion, setPlayerVersion] = useState(0);
	const scan = library?.scan;
	const scanning = scan?.status === "running";
	const scanPending = scanFetcher.state !== "idle";

	useEffect(() => {
		if (library?.scan?.status !== "running" || revalidationState !== "idle")
			return;
		const timer = setTimeout(() => void revalidate(), 1000);
		return () => clearTimeout(timer);
	}, [library, revalidationState, revalidate]);

	function reload() {
		setPlayerVersion((value) => value + 1);
		void revalidate();
	}

	return (
		<main className="space-y-4 p-4">
			<h1 className="text-2xl font-semibold">Anishelf</h1>
			<div className="flex gap-2">
				<scanFetcher.Form method="post" action="/">
					<button
						type="submit"
						className="inline-flex items-center gap-2 border px-3 py-1 disabled:opacity-50"
						disabled={scanPending || scanning || library?.ready === false}
					>
						<ScanLine size={16} aria-hidden="true" />
						{scanFetcher.state === "submitting"
							? "Starting scan…"
							: "Scan library"}
					</button>
				</scanFetcher.Form>
				<button
					type="button"
					className="inline-flex items-center gap-2 border px-3 py-1"
					disabled={revalidationState !== "idle"}
					onClick={reload}
				>
					<RefreshCw size={16} aria-hidden="true" /> Refresh
				</button>
			</div>
			<div role="status" aria-live="polite">
				{library && <p>Scan: {scan?.status ?? "not started"}</p>}
				{scan && (
					<p>
						Visited entries: {scan.visitedCount} · Video files:{" "}
						{scan.matchedCount}
					</p>
				)}
				{scan && scan.warnings.count > 0 && (
					<div>
						<p>Scan warnings: {scan.warnings.count}</p>
						<ul>
							{scan.warnings.messages.map((message) => (
								<li key={message}>{message}</li>
							))}
						</ul>
					</div>
				)}
				{library?.stale && <p>Showing the previous scan results.</p>}
				{revalidationState !== "idle" && <p>Refreshing…</p>}
			</div>
			{library?.error && <p role="alert">{library.error.message}</p>}
			{libraryError && <p role="alert">{libraryError}</p>}
			{scanFetcher.state === "idle" && scanFetcher.data?.error && (
				<p role="alert">{scanFetcher.data.error}</p>
			)}
			{navigation.state !== "idle" && (
				<div>
					<p role="status">
						{navigation.location.pathname.startsWith("/files/")
							? "Loading file…"
							: "Loading files…"}
					</p>
					<Link
						className="border px-3 py-1"
						to={`${location.pathname}${location.search}`}
					>
						Cancel navigation
					</Link>
				</div>
			)}
			<Outlet context={{ reload, playerVersion } satisfies LibraryContext} />
		</main>
	);
}

export default App;
