import { CircleAlert, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDelayedPending } from "../hooks/use-delayed-pending.js";
import { getErrorTranslationKey } from "../lib/error-translation.js";
import { Button } from "./ui/button.js";

type RetryState = "retrying" | "scheduled" | "automatic" | "offline";

export function queryLoadFailure(query: {
	error: unknown;
	failureReason: unknown;
	errorUpdateCount: number;
	fetchStatus: "idle" | "fetching" | "paused";
	refetch: () => unknown;
}) {
	const error = query.error ?? query.failureReason;
	const { fetchStatus } = query;
	if (!error && !query.errorUpdateCount && fetchStatus !== "paused")
		return null;

	let retryState: RetryState | undefined;
	if (fetchStatus === "paused") retryState = "offline";
	else if (fetchStatus === "fetching")
		retryState = query.failureReason ? "automatic" : "retrying";

	return { error, retryState, retry: () => void query.refetch() };
}

export function LoadFailure({
	message,
	error,
	detail,
	retry,
	retryLabel,
	retryState,
	children,
}: {
	message: string;
	error?: unknown;
	detail?: string | undefined;
	retry: () => void;
	retryLabel?: string | undefined;
	retryState?: RetryState | undefined;
	children?: ReactNode;
}) {
	const { t, i18n } = useTranslation();
	const busy = retryState === "retrying" || retryState === "automatic";
	const showBusy = useDelayedPending(busy);
	const errorKey = getErrorTranslationKey(error);
	const cause =
		detail ?? (errorKey && i18n.exists(errorKey) ? t(errorKey) : null);

	return (
		<div className="grid min-w-0 gap-3 py-2">
			<div className="flex min-w-0 items-start gap-2">
				<CircleAlert
					className="mt-0.5 size-4 shrink-0 text-destructive"
					aria-hidden="true"
				/>
				<div className="min-w-0 space-y-1 wrap-break-word">
					<div role="alert" className="space-y-1">
						<p className="text-sm font-medium">{message}</p>
						{cause && <p className="text-sm text-muted-foreground">{cause}</p>}
					</div>
				</div>
			</div>
			<div className="action-row pl-6">
				<Button
					type="button"
					aria-busy={busy}
					disabled={busy || retryState === "offline"}
					className="aria-disabled:opacity-50"
					focusableWhenDisabled
					onClick={retry}
				>
					<RefreshCw
						size={16}
						className={showBusy ? "motion-safe:animate-spin" : undefined}
						aria-hidden="true"
					/>
					{retryLabel ?? t("actions.retry")}
				</Button>
				{children}
				<p
					role="status"
					className="text-sm text-muted-foreground empty:sr-only"
				>
					{retryState && t(`errors.recovery.${retryState}`)}
				</p>
			</div>
		</div>
	);
}
