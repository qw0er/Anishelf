import { ScanLine } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "../../../../shared/components/ui/button.js";
import { RefreshButton } from "../../../../shared/components/ui/refresh-button.js";
import { Spinner } from "../../../../shared/components/ui/spinner.js";
import { useDelayedPending } from "../../../../shared/hooks/use-delayed-pending.js";
import type { LibraryScanState } from "../public.js";

type LibraryScanProps = Pick<
	LibraryScanState,
	| "library"
	| "settings"
	| "scanning"
	| "scanPending"
	| "scanSubmitting"
	| "refreshing"
	| "reload"
	| "startScan"
>;

export function LibraryScanActions({
	library,
	scanning,
	scanPending,
	scanSubmitting,
	refreshing,
	reload,
	startScan,
}: LibraryScanProps) {
	const { t } = useTranslation();
	const showSubmitting = useDelayedPending(scanSubmitting);
	const showScanning = useDelayedPending(scanning);

	return (
		<>
			<Button
				type="button"
				disabled={scanPending || scanning || !library?.ready}
				aria-busy={scanPending || scanning}
				onClick={startScan}
			>
				{showSubmitting || showScanning ? (
					<Spinner />
				) : (
					<ScanLine size={16} aria-hidden="true" />
				)}
				{t("scan.start")}
			</Button>
			<RefreshButton
				label={t("scan.refresh")}
				busy={refreshing}
				onClick={reload}
			/>
		</>
	);
}

export default function LibraryScan({
	library,
	settings,
}: Pick<LibraryScanState, "library" | "settings">) {
	const { t } = useTranslation();
	const hasNotices = Boolean(
		library?.monitor?.status === "degraded" ||
			library?.roots?.some((root) => !root.available) ||
			library?.stale ||
			(settings && !settings.resourceRoots.length),
	);

	if (!hasNotices) return null;

	return (
		<section
			className="flex min-w-0 flex-col gap-2"
			aria-label={t("scan.title")}
		>
			<div className="flex min-w-0 flex-col gap-2 text-sm">
				{!settings?.resourceRoots.length && settings && (
					<p>
						<Trans
							i18nKey="scan.setupRequired"
							components={{
								settings: <Link className="underline" to="/settings" />,
							}}
						/>
					</p>
				)}
				{library?.monitor?.status === "degraded" &&
					settings?.resourceRoots.length && (
						<p
							role={
								library.monitor.status === "degraded" ? "status" : undefined
							}
						>
							{t(`scan.monitor.${library.monitor.status}`)}
						</p>
					)}
				{library?.stale && <p>{t("scan.stale")}</p>}
				{library?.roots
					?.filter((root) => !root.available)
					.map((root) => (
						<p key={root.id} role="status">
							{t("scan.directoryUnavailable", { name: root.name })}
						</p>
					))}
			</div>
		</section>
	);
}
