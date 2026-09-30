import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	Link,
	useRevalidator,
	useRouteError,
	useSearchParams,
} from "react-router";
import { Button, buttonStyles } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";
import { useDelayedPending } from "../hooks/use-delayed-pending.js";
import { getErrorTranslationKey } from "../lib/error-translation.js";
import { directoryPath } from "./paths.js";

export default function RouteError({
	kind,
}: {
	kind: "directory" | "file" | "page";
}) {
	const { t } = useTranslation();
	const error = useRouteError();
	const revalidator = useRevalidator();
	const [searchParams] = useSearchParams();
	const retrying = revalidator.state !== "idle";
	const showRetrying = useDelayedPending(retrying);
	return (
		<section
			className={
				kind === "page"
					? "page-container page-content flex min-w-0 flex-col gap-4"
					: "flex min-w-0 flex-col gap-4"
			}
			aria-label={t("errors.pageLabel")}
		>
			<p className="text-base text-destructive" role="alert">
				{t(getErrorTranslationKey(error) ?? "errors.pageLoad")}
			</p>
			<div className="action-row">
				<Button
					type="button"
					variant="outline"
					disabled={retrying}
					aria-busy={retrying}
					onClick={() => void revalidator.revalidate()}
				>
					{showRetrying ? (
						<Spinner />
					) : (
						<RefreshCw size={16} aria-hidden="true" />
					)}
					{kind === "file" ? t("player.retry") : t("actions.retry")}
				</Button>
				<Link
					className={buttonStyles("outline")}
					to={
						kind === "file"
							? directoryPath(searchParams.get("directory") || "root")
							: "/"
					}
				>
					{kind === "file"
						? t("navigation.backToFiles")
						: t("navigation.goToRoot")}
				</Link>
			</div>
		</section>
	);
}
