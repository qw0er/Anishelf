import { RefreshCw, ScanLine } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LibraryContext } from "../App.js";
import { useDelayedPending } from "../hooks/use-delayed-pending.js";
import { getScanWarningTranslationKey } from "../lib/error-translation.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Spinner } from "./ui/spinner.js";

type LibraryScanProps = Pick<
	LibraryContext,
	| "library"
	| "settings"
	| "libraryError"
	| "scanning"
	| "scanPending"
	| "scanSubmitting"
	| "refreshing"
	| "reload"
	| "startScan"
>;

export default function LibraryScan({
	library,
	settings,
	libraryError,
	scanning,
	scanPending,
	scanSubmitting,
	refreshing,
	reload,
	startScan,
}: LibraryScanProps) {
	const { t } = useTranslation();
	const scan = library?.scan;
	const setupRequired = settings?.resourceRoot === null;
	const showScanning = useDelayedPending(scanning);
	const showSubmitting = useDelayedPending(scanSubmitting);
	const showRefreshing = useDelayedPending(refreshing);
	const scanStatusKey = scan
		? `scan.status${scan.status[0]?.toUpperCase()}${scan.status.slice(1)}`
		: "scan.statusNotStarted";

	return (
		<Card>
			<CardHeader className="gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
				<div className="flex min-w-0 flex-col gap-1">
					<CardTitle>{t("scan.title")}</CardTitle>
					<div
						className="text-sm text-muted-foreground"
						role="status"
						aria-live="polite"
					>
						<p className="inline-flex items-center gap-2">
							<span className="inline-flex size-4 shrink-0">
								{showScanning && <Spinner />}
							</span>
							{t("scan.status", { status: t(scanStatusKey) })}
						</p>
						{scan && (
							<p>
								{t("scan.visitedEntries", {
									count: scan.visitedCount,
									matched: scan.matchedCount,
								})}
							</p>
						)}
					</div>
				</div>
				<div className="action-row">
					<Button
						type="button"
						disabled={scanPending || scanning || !library?.ready}
						aria-busy={scanPending}
						onClick={startScan}
					>
						{showSubmitting ? (
							<Spinner />
						) : (
							<ScanLine size={16} aria-hidden="true" />
						)}
						{t("scan.start")}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={refreshing}
						aria-busy={refreshing}
						onClick={reload}
					>
						{showRefreshing ? (
							<Spinner />
						) : (
							<RefreshCw size={16} aria-hidden="true" />
						)}
						{t("scan.refresh")}
					</Button>
				</div>
			</CardHeader>
			{(scan?.warnings.count ||
				library?.stale ||
				library?.error ||
				libraryError ||
				!settings?.resourceRoot) && (
				<CardContent className="flex min-w-0 flex-col gap-2 text-sm">
					{!settings?.resourceRoot && settings && (
						<p>
							<Trans
								i18nKey="scan.setupRequired"
								components={{
									settings: <Link className="underline" to="/settings" />,
								}}
							/>
						</p>
					)}
					{scan && scan.warnings.count > 0 && (
						<details>
							<summary className="cursor-pointer">
								{t("scan.warnings", { count: scan.warnings.count })}
							</summary>
							<ul className="flex min-w-0 flex-col gap-1 list-disc pl-4">
								{scan.warnings.messages.map((message) => (
									<li key={message}>
										{getScanWarningTranslationKey(message)
											? t(getScanWarningTranslationKey(message) ?? "")
											: message}
									</li>
								))}
							</ul>
						</details>
					)}
					{library?.stale && <p>{t("scan.stale")}</p>}
					{library?.error &&
						!(
							setupRequired &&
							library.error.code === "RESOURCE_ROOT_NOT_CONFIGURED"
						) && (
							<p className="text-base text-destructive" role="alert">
								{t(`errors.api.${library.error.code}`)}
							</p>
						)}
					{libraryError && (
						<p className="text-base text-destructive" role="alert">
							{t(libraryError)}
						</p>
					)}
				</CardContent>
			)}
		</Card>
	);
}
