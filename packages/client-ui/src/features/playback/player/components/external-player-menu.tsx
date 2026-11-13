import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	Ellipsis,
	ExternalLink,
	Link2,
	RefreshCw,
	Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getClientRuntime } from "../../../../shared/api/connection.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../../../../shared/components/ui/dropdown-menu.js";
import { ExternalPlayerLink } from "../../../../shared/components/ui/external-link.js";
import { Spinner } from "../../../../shared/components/ui/spinner.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import {
	buildPlayerUrl,
	detectClientPlatform,
	presetsForPlatform,
	useExternalPlayers,
} from "../../../settings/public.js";
import { resolveMediaLink } from "../media-link.js";
import MediaLink from "./media-link.js";

function ExternalPlayerSubmenu({ fileId }: { fileId: string }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const client = useQueryClient();
	const scope = useQueryScope();
	const custom = useExternalPlayers();
	const players = [
		...presetsForPlatform(
			detectClientPlatform(getClientRuntime().platform.device),
		),
		...custom.players,
	];
	const media = useQuery({
		queryKey: ["external-player-media", scope, fileId],
		queryFn: ({ signal }) =>
			resolveMediaLink(fileId, { signal }, client, scope),
		enabled: open,
		staleTime: 0,
		retry: false,
	});
	const available = media.data && !media.isFetching && !media.error;
	useEffect(() => {
		if (open && media.error)
			toast.add({
				id: `external-player:${fileId}`,
				type: "error",
				title: t("player.mediaLinkError"),
			});
	}, [open, media.error, fileId, t]);
	return (
		<DropdownMenuSub open={open} onOpenChange={setOpen}>
			<DropdownMenuSubTrigger>
				{media.isFetching ? (
					<Spinner />
				) : (
					<ExternalLink size={16} aria-hidden="true" />
				)}
				{t("externalPlayers.open")}
				<ChevronRight className="ml-auto size-4" aria-hidden="true" />
			</DropdownMenuSubTrigger>
			<DropdownMenuContent submenu>
				{players.map((player) => (
					<DropdownMenuItem
						key={player.id}
						disabled={!available}
						label={player.name}
						render={
							<ExternalPlayerLink
								href={
									available && media.data
										? buildPlayerUrl(
												player.template,
												media.data.url,
												media.data.mimeType,
											)
										: undefined
								}
							/>
						}
					>
						<ExternalLink size={16} aria-hidden="true" />
						<span className="min-w-0 break-all">{player.name}</span>
					</DropdownMenuItem>
				))}
				{open && media.error && (
					<DropdownMenuItem
						closeOnClick={false}
						onClick={() => void media.refetch()}
					>
						<RefreshCw size={16} aria-hidden="true" />
						{t("actions.retry")}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem render={<a href="/settings?section=playback" />}>
					<Settings size={16} aria-hidden="true" />
					{t("externalPlayers.manage")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenuSub>
	);
}

export function PlaybackActionsMenu({
	fileId,
	onOptions,
	onRetry,
}: {
	fileId: string;
	onOptions?(): void;
	onRetry?(): void;
}) {
	const { t } = useTranslation();
	return (
		<DropdownMenu>
			<Tooltip content={t("externalPlayers.moreActions")}>
				<DropdownMenuTrigger
					render={
						<Button
							variant="outline"
							className="player-action"
							aria-label={t("externalPlayers.moreActions")}
						/>
					}
				>
					<Ellipsis size={16} className="shrink-0" aria-hidden="true" />
					<span className="player-action-label">{t("player.more")}</span>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent>
				{onOptions && (
					<DropdownMenuItem onClick={onOptions}>
						<Settings size={16} aria-hidden="true" />
						{t("player.options")}
					</DropdownMenuItem>
				)}
				{onRetry && (
					<DropdownMenuItem onClick={onRetry}>
						<RefreshCw size={16} aria-hidden="true" />
						{t("player.retry")}
					</DropdownMenuItem>
				)}
				<FileLinkMenuItems fileId={fileId} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function FileLinkMenuItems({ fileId }: { fileId: string }) {
	const { t } = useTranslation();
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<Link2 size={16} aria-hidden="true" />
				{t("player.mediaLinkLabel")}
				<ChevronRight className="ml-auto size-4" aria-hidden="true" />
			</DropdownMenuSubTrigger>
			<DropdownMenuContent submenu>
				<ExternalPlayerSubmenu fileId={fileId} />
				<MediaLink fileId={fileId} menuItem />
				<MediaLink fileId={fileId} menuItem download />
				<MediaLink fileId={fileId} menuItem playlist />
			</DropdownMenuContent>
		</DropdownMenuSub>
	);
}
