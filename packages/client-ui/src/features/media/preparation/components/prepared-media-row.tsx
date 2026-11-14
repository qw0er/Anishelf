import { FolderOpen, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { PreparedMediaItem } from "../../../../shared/api/contracts.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Checkbox } from "../../../../shared/components/ui/checkbox.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { formatFileSize } from "../../../resources/public.js";

function watchPath(item: PreparedMediaItem) {
	const query = new URLSearchParams({
		version: item.sourceVersion,
		asset: item.id,
		audio: item.audioStreamIndices.length
			? String(item.audioStreamIndices[0])
			: "none",
	});
	return `/files/${encodeURIComponent(item.fileId)}?${query}`;
}

export function PreparedMediaRow({
	item,
	selecting,
	selected,
	busy,
	onSelect,
	onDelete,
}: {
	item: PreparedMediaItem;
	selecting: boolean;
	selected: boolean;
	busy: boolean;
	onSelect(checked: boolean): void;
	onDelete(): void;
}) {
	const { t, i18n } = useTranslation();
	return (
		<li
			className={`grid items-center gap-x-3 gap-y-2 py-3 ${
				selecting
					? "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]"
					: "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]"
			}`}
		>
			{selecting && (
				<Checkbox
					className="size-5 shrink-0"
					aria-label={t("preparedMedia.select", {
						name: item.filename,
					})}
					checked={selected}
					disabled={busy || !!item.deleteBlockedReason}
					onCheckedChange={onSelect}
				/>
			)}
			<div className="min-w-0 flex-1 space-y-1">
				<Tooltip
					openOnClick
					content={
						<div className="space-y-1 break-all">
							<p>{item.sourcePath}</p>
							<p>{new Date(item.createdAtMs).toLocaleString(i18n.language)}</p>
						</div>
					}
				>
					<button
						type="button"
						className="block w-full truncate rounded text-left list-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={item.filename}
					>
						{item.filename}
					</button>
				</Tooltip>
				<p className="break-words text-xs text-muted-foreground">
					{item.profileName} ·{" "}
					{item.audioStreamIndices.length
						? t("preparedMedia.audio", {
								count: item.audioStreamIndices.length,
							})
						: t("audioTracks.none")}{" "}
					· {formatFileSize(item.sizeBytes, i18n.language)} ·{" "}
					{t(`preparedMedia.states.${item.status}`)}
					{item.deleteBlockedReason &&
						` · ${t(`preparedMedia.blocked.${item.deleteBlockedReason}`)}`}
				</p>
			</div>
			<div
				className={`flex items-center justify-end ${selecting ? "col-start-2 sm:col-start-auto" : ""}`}
			>
				<Tooltip content={t("preparedMedia.watch")}>
					{item.status === "ready" ? (
						<Link
							className={buttonStyles("ghost", undefined, "icon")}
							aria-label={t("preparedMedia.watch")}
							to={watchPath(item)}
						>
							<Play size={16} aria-hidden="true" />
						</Link>
					) : (
						<Button
							size="icon"
							variant="ghost"
							disabled
							aria-label={t("preparedMedia.watch")}
						>
							<Play size={16} aria-hidden="true" />
						</Button>
					)}
				</Tooltip>
				<Tooltip content={t("preparedMedia.locate")}>
					<Link
						className={buttonStyles("ghost", undefined, "icon")}
						aria-label={t("preparedMedia.locate")}
						to={`/files/${encodeURIComponent(item.fileId)}/locate`}
					>
						<FolderOpen size={16} aria-hidden="true" />
					</Link>
				</Tooltip>
				<Tooltip content={t("preparedMedia.delete")}>
					<Button
						size="icon"
						variant="ghost"
						aria-label={t("preparedMedia.delete")}
						disabled={busy || !!item.deleteBlockedReason}
						onClick={() => onDelete()}
					>
						<Trash2 size={16} aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
		</li>
	);
}
