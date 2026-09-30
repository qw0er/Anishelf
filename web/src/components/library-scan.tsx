import { RefreshCw, ScanLine } from "lucide-react";
import { Link } from "react-router";
import type { LibraryContext } from "../App.js";
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
	| "scanError"
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
	scanError,
	refreshing,
	reload,
	startScan,
}: LibraryScanProps) {
	const scan = library?.scan;
	const setupRequired = settings?.resourceRoot === null;

	return (
		<Card>
			<CardHeader className="gap-4 sm:grid-cols-[1fr_auto]">
				<div className="space-y-1">
					<CardTitle>Library scan</CardTitle>
					<div
						className="text-sm text-muted-foreground"
						role="status"
						aria-live="polite"
					>
						<p className="inline-flex items-center gap-2">
							{scanning && <Spinner />}
							Scan: {scan?.status ?? "not started"}
						</p>
						{scan && (
							<p>
								Visited entries: {scan.visitedCount} · Video files:{" "}
								{scan.matchedCount}
							</p>
						)}
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						disabled={scanPending || scanning || !library?.ready}
						onClick={startScan}
					>
						{scanSubmitting ? (
							<>
								<Spinner />
								Starting scan…
							</>
						) : (
							<>
								<ScanLine size={16} aria-hidden="true" />
								Scan library
							</>
						)}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={refreshing}
						onClick={reload}
					>
						{refreshing ? (
							<>
								<Spinner />
								Refreshing…
							</>
						) : (
							<>
								<RefreshCw size={16} aria-hidden="true" />
								Refresh
							</>
						)}
					</Button>
				</div>
			</CardHeader>
			{(scan?.warnings.count ||
				library?.stale ||
				library?.error ||
				libraryError ||
				scanError ||
				!settings?.resourceRoot) && (
				<CardContent className="space-y-2 text-sm">
					{!settings?.resourceRoot && settings && (
						<p>
							Set a resource directory in{" "}
							<Link className="underline" to="/settings">
								Settings
							</Link>{" "}
							to start using the library.
						</p>
					)}
					{scan && scan.warnings.count > 0 && (
						<details>
							<summary className="cursor-pointer">
								Scan warnings: {scan.warnings.count}
							</summary>
							<ul className="list-disc pl-5">
								{scan.warnings.messages.map((message) => (
									<li key={message}>{message}</li>
								))}
							</ul>
						</details>
					)}
					{library?.stale && <p>Showing the previous scan results.</p>}
					{library?.error &&
						!(
							setupRequired &&
							library.error.code === "RESOURCE_ROOT_NOT_CONFIGURED"
						) && <p role="alert">{library.error.message}</p>}
					{libraryError && <p role="alert">{libraryError}</p>}
					{scanError && <p role="alert">{scanError}</p>}
				</CardContent>
			)}
		</Card>
	);
}
