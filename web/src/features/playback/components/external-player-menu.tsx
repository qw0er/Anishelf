import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Ellipsis, ExternalLink, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryScope } from "../../../api/queries.js";
import { Button } from "../../../components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu.js";
import { Spinner } from "../../../components/ui/spinner.js";
import { toast } from "../../../components/ui/toast.js";
import {
	detectClientPlatform,
	presetsForPlatform,
} from "../../../config/external-player-policy.js";
import { buildPlayerUrl } from "../external-players.js";
import { useExternalPlayers } from "../hooks/use-external-players.js";
import { resolveMediaLink } from "../media-link.js";
import MediaLink from "./media-link.js";

export function ExternalPlayerSubmenu({ fileId }: { fileId: string }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const client = useQueryClient();
	const scope = useQueryScope();
	const custom = useExternalPlayers();
	const players = [
		...presetsForPlatform(detectClientPlatform(navigator)),
		...custom.players,
	];
	const media = useQuery({
		queryKey: ["external-player-media", scope, fileId],
		queryFn: ({ signal }) =>
			resolveMediaLink(
				fileId,
				window.location.origin,
				{ signal },
				client,
				scope,
			),
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
							<a
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
						<span className="min-w-0 break-all">{player.name}</span>
					</DropdownMenuItem>
				))}
				{open && media.error && (
					<DropdownMenuItem
						closeOnClick={false}
						onClick={() => void media.refetch()}
					>
						{t("actions.retry")}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem render={<a href="/settings" />}>
					<Settings size={16} aria-hidden="true" />
					{t("externalPlayers.manage")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenuSub>
	);
}

export function PlaybackActionsMenu({ fileId }: { fileId: string }) {
	const { t } = useTranslation();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline" />}>
				<Ellipsis size={16} aria-hidden="true" />
				{t("externalPlayers.moreActions")}
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<ExternalPlayerSubmenu fileId={fileId} />
				<MediaLink fileId={fileId} menuItem />
				<MediaLink fileId={fileId} menuItem playlist />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
