import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import { useTranslation } from "react-i18next";
import {
	Link,
	useRevalidator,
	useRouteError,
	useSearchParams,
} from "react-router";
import { useOfflineCache } from "../../features/playback/ui.js";
import { LoadFailure } from "../../shared/components/load-failure.js";
import { buttonStyles } from "../../shared/components/ui/button.js";
import {
	animeReturnPath,
	directoryPath,
	libraryReturnPath,
} from "../../shared/navigation.js";
import { ServerConnectionLink } from "../components/server-connection-link.js";

const loadMessages = {
	page: "errors.pageLoad",
	directory: "errors.directoryLoad",
	file: "errors.fileLoad",
	history: "errors.historyLoad",
	library: "errors.animeLibraryLoad",
	work: "errors.workLoad",
} as const;

function recoveryLink(
	kind: keyof typeof loadMessages,
	params: URLSearchParams,
) {
	switch (kind) {
		case "file": {
			const detail = animeReturnPath(params);
			return detail
				? { to: detail, label: "anime.backToDetail" }
				: {
						to: directoryPath(params.get("directory") || "root"),
						label: "navigation.backToFiles",
					};
		}
		case "directory":
			return { to: directoryPath("root"), label: "navigation.goToRoot" };
		case "work":
			return {
				to: libraryReturnPath(params.get("library")),
				label: "anime.back",
			};
		default:
			return { to: "/", label: "anime.back" };
	}
}

export default function RouteError({
	kind,
}: {
	kind: keyof typeof loadMessages;
}) {
	const { t } = useTranslation();
	const offlineCache = useOfflineCache();
	const error = useRouteError();
	const revalidator = useRevalidator();
	const [searchParams] = useSearchParams();
	const recovery = recoveryLink(kind, searchParams);
	return (
		<section
			className={kind === "page" ? "page-container page-content" : "min-w-0"}
			aria-label={t("errors.pageLabel")}
		>
			<LoadFailure
				message={t(loadMessages[kind])}
				error={error}
				retry={() => void revalidator.revalidate()}
				retryLabel={kind === "file" ? t("player.retry") : undefined}
				retryState={revalidator.state === "idle" ? undefined : "retrying"}
			>
				<Link className={buttonStyles("outline")} to={recovery.to}>
					{t(recovery.label)}
				</Link>
				<ServerConnectionLink />
				{offlineCache && (
					<Link className={buttonStyles("outline")} to={offlineCachePath}>
						{t("offlineCache.open")}
					</Link>
				)}
			</LoadFailure>
		</section>
	);
}
