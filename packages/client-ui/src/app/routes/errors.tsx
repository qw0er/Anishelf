import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import type { ComponentProps } from "react";
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
	const error = useRouteError();
	const revalidator = useRevalidator();
	return (
		<section
			className={kind === "page" ? "page-container page-content" : "min-w-0"}
			aria-label={t("errors.pageLabel")}
		>
			<RouteLoadFailure
				kind={kind}
				error={error}
				retry={() => void revalidator.revalidate()}
				retryState={revalidator.state === "idle" ? undefined : "retrying"}
			/>
		</section>
	);
}

export function RouteLoadFailure({
	kind,
	hideReturnLink = false,
	...failure
}: Pick<
	ComponentProps<typeof LoadFailure>,
	"error" | "retry" | "retryState"
> & {
	kind: keyof typeof loadMessages;
	hideReturnLink?: boolean;
}) {
	const { t } = useTranslation();
	return (
		<LoadFailure
			message={t(loadMessages[kind])}
			{...failure}
			retryLabel={kind === "file" ? t("player.retry") : undefined}
		>
			<RouteRecovery kind={kind} hideReturnLink={hideReturnLink} />
		</LoadFailure>
	);
}

export function RouteRecovery({
	kind,
	hideReturnLink = false,
}: {
	kind: keyof typeof loadMessages;
	hideReturnLink?: boolean;
}) {
	const { t } = useTranslation();
	const offlineCache = useOfflineCache();
	const [params] = useSearchParams();
	const recovery = recoveryLink(kind, params);
	return (
		<>
			{!hideReturnLink && (
				<Link className={buttonStyles("outline")} to={recovery.to}>
					{t(recovery.label)}
				</Link>
			)}
			<ServerConnectionLink />
			{offlineCache && (
				<Link className={buttonStyles("outline")} to={offlineCachePath}>
					{t("offlineCache.open")}
				</Link>
			)}
		</>
	);
}
