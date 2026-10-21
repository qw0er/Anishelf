import type { RouteObject } from "react-router";
import { SubscriptionPanel } from "../../features/acquisition/ui.js";
import { ReviewPage, TrackedAnimeDetail } from "../../features/anime/ui.js";
import { HistoryPage } from "../../features/playback/ui.js";
import App from "../App.js";
import InitialLoading from "../components/initial-loading.js";
import { animeLoader } from "./anime-data.js";
import RouteError from "./errors.js";
import { historyLoader } from "./history-data.js";
import { AnimeDetailPage } from "./pages/anime-detail-page.js";
import { AnimeLibraryPage } from "./pages/anime-library-page.js";
import { DirectoryPage } from "./pages/directory-page.js";
import { NotFoundPage } from "./pages/not-found-page.js";
import { PlayerPage } from "./pages/player-page.js";
import { SettingsPage } from "./pages/settings-page.js";
import { directoryLoader, fileLoader } from "./resources-data.js";
import { libraryLoader } from "./root-data.js";
import { settingsAction } from "./settings-data.js";
export const libraryRoute: RouteObject = {
	id: "library",
	path: "/",
	element: <App />,
	loader: libraryLoader,
	errorElement: <RouteError kind="page" />,
	hydrateFallbackElement: <InitialLoading />,
	children: [
		{ path: "review", element: <ReviewPage /> },
		{
			path: "history",
			loader: historyLoader,
			element: <HistoryPage />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "settings",
			action: settingsAction,
			element: <SettingsPage />,
		},
		{
			index: true,
			element: <AnimeLibraryPage />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "anime/tracked/:mediaId",
			element: (
				<TrackedAnimeDetail
					renderSubscription={(workKey) => (
						<SubscriptionPanel key={workKey} workKey={workKey} />
					)}
				/>
			),
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "anime/:id",
			loader: animeLoader,
			element: <AnimeDetailPage />,
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
			element: <NotFoundPage />,
		},
	],
};
