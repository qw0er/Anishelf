import {
	type OfflineCacheEntry,
	offlineCachePath,
} from "@anishelf/contracts/offline-cache";
import { ChevronDown, Play, RotateCcw, Trash2, X } from "lucide-react";
import type { ComponentProps, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button, buttonStyles } from "../../../shared/components/ui/button.js";
import { Spinner } from "../../../shared/components/ui/spinner.js";
import { cn } from "../../../shared/lib/utils.js";
import { formatFileSize } from "../../resources/public.js";
import { type CacheOperation, canRetryCache, pendingCache } from "./state.js";

const actionSizing = "h-auto min-h-9 max-w-full whitespace-normal py-1";

export function CacheActionButton({
	icon: Icon,
	busy,
	children,
	...props
}: ComponentProps<typeof Button> & {
	icon: typeof Play;
	busy: boolean;
}) {
	return (
		<Button
			{...props}
			className={(state) =>
				cn(
					actionSizing,
					typeof props.className === "function"
						? props.className(state)
						: props.className,
				)
			}
			aria-busy={busy}
			disabled={busy || props.disabled}
			focusableWhenDisabled={busy || props.focusableWhenDisabled}
		>
			{busy ? <Spinner /> : <Icon size={16} aria-hidden="true" />}
			{children}
		</Button>
	);
}

export function OfflineCacheRow({
	entry,
	label,
	server,
	search,
	operation,
	perform,
	onRemove,
}: {
	entry: OfflineCacheEntry;
	label: string;
	server: string;
	search: string;
	operation: CacheOperation | undefined;
	perform: (action: "cancel" | "retry") => void;
	onRemove(event: MouseEvent<HTMLButtonElement>): void;
}) {
	const { t, i18n } = useTranslation();
	const busy = pendingCache(entry.status);
	const failed = entry.status === "failed" || entry.status === "unavailable";
	const percent = entry.status === "downloading" ? entry.percent : null;
	const source =
		entry.server === "local" ? t("offlineCache.localSource") : entry.server;
	const stateLabel =
		percent === null
			? t(`offlineCache.status.${entry.status}`)
			: t("offlineCache.percent", { percent });

	return (
		<li className="grid min-w-0 items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
			<div className="min-w-0 space-y-1">
				{label && <p className="list-primary wrap-anywhere">{label}</p>}
				<details className="group min-w-0">
					<summary
						className={`flex w-fit max-w-full cursor-pointer list-none items-start gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden ${label ? "supporting-text" : "list-primary"}`}
					>
						<span className="min-w-0 truncate group-open:whitespace-normal group-open:wrap-anywhere">
							{entry.name}
						</span>
						<ChevronDown
							size={16}
							className="mt-0.5 shrink-0 group-open:rotate-180"
							aria-hidden="true"
						/>
					</summary>
				</details>
				<p className="compact-metadata wrap-anywhere">
					{source} · {stateLabel}
					{entry.sizeBytes > 0 &&
						` · ${formatFileSize(entry.sizeBytes, i18n.language)}`}
				</p>
				{entry.failure && (
					<p className="supporting-text wrap-anywhere">
						{t(`offlineCache.failure.${entry.failure}`)}
					</p>
				)}
				{busy && entry.status !== "queued" && (
					<progress
						className={`h-2 w-full max-w-64 accent-primary ${percent === null ? "motion-reduce:hidden" : ""}`}
						max={100}
						value={percent ?? undefined}
						aria-label={t("offlineCache.progress")}
					/>
				)}
				{entry.playing && (
					<p className="supporting-text">{t("offlineCache.inUse")}</p>
				)}
				{failed && entry.server !== server && (
					<p className="supporting-text">{t("offlineCache.useSource")}</p>
				)}
			</div>
			<div className="action-row sm:justify-self-end">
				{entry.status === "ready" &&
					(operation === "remove" ? (
						<Button variant="outline" className={actionSizing} disabled>
							<Play size={16} aria-hidden="true" />
							{t("anime.play")}
						</Button>
					) : (
						<Link
							className={buttonStyles("outline", actionSizing)}
							to={{ pathname: `${offlineCachePath}/${entry.id}`, search }}
						>
							<Play size={16} aria-hidden="true" />
							{t("anime.play")}
						</Link>
					))}
				{busy && (
					<CacheActionButton
						variant="outline"
						icon={X}
						busy={operation === "cancel"}
						disabled={!!operation}
						onClick={() => perform("cancel")}
					>
						{t("actions.cancel")}
					</CacheActionButton>
				)}
				{failed && (
					<CacheActionButton
						variant="outline"
						icon={RotateCcw}
						busy={operation === "retry"}
						disabled={!!operation || !canRetryCache(entry, server)}
						onClick={() => perform("retry")}
					>
						{t("actions.retry")}
					</CacheActionButton>
				)}
				{!busy && (
					<CacheActionButton
						variant="ghost"
						icon={Trash2}
						busy={operation === "remove"}
						disabled={entry.playing || !!operation}
						onClick={onRemove}
					>
						{t("offlineCache.remove")}
					</CacheActionButton>
				)}
			</div>
		</li>
	);
}
