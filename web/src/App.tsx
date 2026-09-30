import { useEffect, useState } from "react";
import {
	Link,
	NavLink,
	Outlet,
	useFetcher,
	useLoaderData,
	useLocation,
	useNavigation,
	useRevalidator,
} from "react-router";
import type { LibraryResponse, SettingsResponse } from "./api/contracts.js";
import { buttonStyles } from "./components/ui/button.js";
import { Spinner } from "./components/ui/spinner.js";
import type { libraryLoader, scanAction } from "./routes/loaders.js";

export interface LibraryContext {
	playerVersion: number;
	reload(): void;
	settings: SettingsResponse | null;
	library: LibraryResponse | null;
	libraryError: string | null;
	scanning: boolean;
	scanPending: boolean;
	scanSubmitting: boolean;
	scanError: string | null;
	refreshing: boolean;
	startScan(): void;
}

function App() {
	const {
		library,
		settings,
		error: libraryError,
	} = useLoaderData<typeof libraryLoader>();
	const scanFetcher = useFetcher<typeof scanAction>();
	const { revalidate, state: revalidationState } = useRevalidator();
	const navigation = useNavigation();
	const location = useLocation();
	const [playerVersion, setPlayerVersion] = useState(0);
	const scanning = library?.scan?.status === "running";
	const scanSubmitting = scanFetcher.state === "submitting";
	const scanPending = scanFetcher.state !== "idle";
	const browsing =
		location.pathname === "/" || location.pathname.startsWith("/directories/");

	useEffect(() => {
		if (!scanning || revalidationState !== "idle") return;
		const timer = setTimeout(() => void revalidate(), 1000);
		return () => clearTimeout(timer);
	}, [revalidate, revalidationState, scanning]);

	function reload() {
		setPlayerVersion((value) => value + 1);
		void revalidate();
	}

	function startScan() {
		scanFetcher.submit(null, { method: "post", action: "/" });
	}

	return (
		<div className="min-h-screen bg-background">
			<header className="border-b bg-card">
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
			<main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
				{navigation.state !== "idle" && (
					<div className="flex flex-wrap items-center gap-3" role="status">
						<Spinner />
						<p>
							{navigation.location.pathname.startsWith("/files/")
								? "Loading file…"
								: "Loading files…"}
						</p>
						<Link
							className={buttonStyles("outline")}
							to={`${location.pathname}${location.search}`}
						>
							Cancel navigation
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
							scanError: scanFetcher.data?.error ?? null,
							refreshing: revalidationState !== "idle",
							startScan,
						} satisfies LibraryContext
					}
				/>
			</main>
		</div>
	);
}

export default App;
