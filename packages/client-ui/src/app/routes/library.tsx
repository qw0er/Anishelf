import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import {
	EpisodeDownloadAction,
	SubscriptionsPage,
} from "../../features/acquisition/ui.js";
import { ReviewPage, TrackedAnimeDetail } from "../../features/anime/ui.js";
import { HistoryPage } from "../../features/playback/ui.js";
import App from "../App.js";
import { FilesLayout, PreparedMediaRoute } from "../components/files-layout.js";
import InitialLoading from "../components/initial-loading.js";
import { WorkAcquisitionPanel } from "../components/work-acquisition-panel.js";
import RouteError, { RouteRecovery } from "./errors.js";
import { AnimeDetailPage } from "./pages/anime-detail-page.js";
import { AnimeLibraryPage } from "./pages/anime-library-page.js";
import { DirectoryPage } from "./pages/directory-page.js";
import { NotFoundPage } from "./pages/not-found-page.js";
import { PlayerPage } from "./pages/player-page.js";
import { SettingsPage } from "./pages/settings-page.js";
import { locateFileLoader } from "./resources-data.js";
import { libraryLoader } from "./root-data.js";
import { settingsAction } from "./settings-data.js";
export function createLibraryRoute({
	offlineCache = false,
	externalPlayerSettings,
	desktopSettings,
	showSecuritySettings,
}: {
	offlineCache?: boolean;
	externalPlayerSettings?: ReactNode;
	desktopSettings?: ReactNode;
	showSecuritySettings?: boolean | undefined;
} = {}): RouteObject {
	const workDetail = (
		<TrackedAnimeDetail
			renderEpisodeAction={(target) => (
				<EpisodeDownloadAction
					key={`${target.workKey}:${target.episode}`}
					{...target}
				/>
			)}
			renderSubscription={(workKey, status) => (
				<WorkAcquisitionPanel key={workKey} workKey={workKey} status={status} />
			)}
		/>
	);
	return {
		id: "library",
		path: "/",
		element: <App />,
		loader: libraryLoader,
		// The mounted shell owns refreshes and session checks after bootstrap.
		shouldRevalidate: () => false,
		errorElement: <RouteError kind="page" />,
		hydrateFallbackElement: <InitialLoading />,
		children: [
			{ path: "subscriptions", element: <SubscriptionsPage /> },
			{ path: "review", element: <ReviewPage /> },
			{
				path: "history",
				element: (
					<HistoryPage loadRecovery={<RouteRecovery kind="history" />} />
				),
				errorElement: <RouteError kind="history" />,
			},
			{
				path: "settings",
				action: settingsAction,
				element: (
					<SettingsPage
						externalPlayerSettings={externalPlayerSettings}
						desktopSettings={desktopSettings}
						showSecuritySettings={showSecuritySettings}
					/>
				),
			},
			{
				index: true,
				element: <AnimeLibraryPage />,
				errorElement: <RouteError kind="library" />,
			},
			{
				path: "anime/tracked/:mediaId",
				element: workDetail,
				errorElement: <RouteError kind="work" />,
			},
			{
				path: "anime/works/:metadataId",
				element: workDetail,
				errorElement: <RouteError kind="work" />,
			},
			{
				path: "anime/:id",
				element: <AnimeDetailPage />,
				errorElement: <RouteError kind="work" />,
			},
			{
				element: <FilesLayout offlineCache={offlineCache} />,
				children: [
					{
						path: "directories/:id",
						element: <DirectoryPage />,
						errorElement: <RouteError kind="directory" />,
					},
					{ path: "prepared-media", element: <PreparedMediaRoute /> },
				],
			},
			{
				path: "files/:id/locate",
				loader: locateFileLoader,
				errorElement: <RouteError kind="file" />,
			},
			{
				path: "files/:id",
				element: <PlayerPage />,
				errorElement: <RouteError kind="file" />,
			},
			{
				path: "*",
				element: <NotFoundPage />,
			},
		],
	};
}
