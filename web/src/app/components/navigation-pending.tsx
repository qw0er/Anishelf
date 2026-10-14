import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigation } from "react-router";
import { buttonStyles } from "../../shared/components/ui/button.js";
import { Spinner } from "../../shared/components/ui/spinner.js";
import { useDelayedPending } from "../../shared/hooks/use-delayed-pending.js";
import "../../shared/i18n.js";

export function NavigationPending() {
	const { t } = useTranslation();
	const navigation = useNavigation();
	const location = useLocation();
	const showNavigation = useDelayedPending(
		navigation.state !== "idle",
		navigation.location?.key,
	);
	return (
		<>
			{" "}
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
		</>
	);
}
