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
	return <LibraryBrowser listing={listing} />;
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

export const libraryRoute: RouteObject = {
	id: "library",
	path: "/",
	element: <App />,
	loader: libraryLoader,
	action: scanAction,
	errorElement: <RouteError kind="page" />,
	hydrateFallbackElement: <p role="status">Loading library…</p>,
	children: [
		{
			path: "settings",
			action: settingsAction,
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
					<Link className="border px-3 py-1" to="/">
						Go to root
					</Link>
				</section>
			),
		},
	],
};
