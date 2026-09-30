import {
	Link,
	type RouteObject,
	useLoaderData,
	useOutletContext,
	useSearchParams,
} from "react-router";
import App, { type LibraryContext } from "../App.js";
import FilePlayer from "../components/file-player.js";
import LibraryBrowser from "../components/library-browser.js";
import ResourceSettings from "../components/resource-settings.js";
import { buttonStyles } from "../components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import RouteError from "./errors.js";
import {
	directoryLoader,
	fileLoader,
	libraryLoader,
	scanAction,
	settingsAction,
} from "./loaders.js";

function DirectoryPage() {
	const listing = useLoaderData<typeof directoryLoader>();
	const scan = useOutletContext<LibraryContext>();
	return <LibraryBrowser listing={listing} scan={scan} />;
}

function PlayerPage() {
	const data = useLoaderData<typeof fileLoader>();
	const { reload, playerVersion } = useOutletContext<LibraryContext>();
	const [searchParams] = useSearchParams();
	return (
		<FilePlayer
			key={`${data.file.id}:${playerVersion}`}
			data={data}
			returnDirectoryId={searchParams.get("directory")}
			onRetry={reload}
		/>
	);
}

function SettingsPage() {
	const { settings, scanning, scanPending } =
		useOutletContext<LibraryContext>();
	return settings ? (
		<ResourceSettings
			key={settings.resourceRoot}
			settings={settings}
			disabled={scanning || scanPending}
		/>
	) : (
		<section role="alert">
			Settings could not be loaded. Try refreshing the page.
		</section>
	);
}

function LibraryLoading() {
	return (
		<main
			className="mx-auto max-w-6xl space-y-6 px-4 py-6"
			role="status"
			aria-label="Loading library"
		>
			<Card>
				<CardHeader className="gap-4 sm:grid-cols-[1fr_auto]">
					<div className="space-y-2">
						<CardTitle>Library scan</CardTitle>
						<Skeleton className="h-4 w-40" />
					</div>
					<div className="flex gap-2">
						<Skeleton className="h-9 w-32" />
						<Skeleton className="h-9 w-24" />
					</div>
				</CardHeader>
			</Card>
			<Skeleton className="h-8 w-56" />
			<Card>
				<CardContent className="space-y-4">
					{[0, 1, 2].map((row) => (
						<Skeleton key={row} className="h-10 w-full" />
					))}
				</CardContent>
			</Card>
			<span className="sr-only">Loading library…</span>
		</main>
	);
}

export const libraryRoute: RouteObject = {
	id: "library",
	path: "/",
	element: <App />,
	loader: libraryLoader,
	action: scanAction,
	errorElement: <RouteError kind="page" />,
	hydrateFallbackElement: <LibraryLoading />,
	children: [
		{
			path: "settings",
			action: settingsAction,
			element: <SettingsPage />,
		},
		{
			index: true,
			loader: directoryLoader,
			element: <DirectoryPage />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "directories/:id",
			loader: directoryLoader,
			element: <DirectoryPage />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "files/:id",
			loader: fileLoader,
			element: <PlayerPage />,
			errorElement: <RouteError kind="file" />,
		},
		{
			path: "*",
			element: (
				<section>
					<p role="alert">Page not found.</p>
					<Link className={buttonStyles("outline")} to="/">
						Go to root
					</Link>
				</section>
			),
		},
	],
};
