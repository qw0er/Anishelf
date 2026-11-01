import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Ellipsis } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../shared/components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { toast } from "../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../shared/lib/error-translation.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { downloadKeys, requestEpisodeDownload } from "./downloads-api.js";

export function EpisodeDownloadMenu({
	workKey,
	episode,
}: {
	workKey: string;
	episode: number;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	const [commandId] = useState(() => crypto.randomUUID());
	const activityParams = new URLSearchParams(location.search);
	activityParams.set("activity", "downloads");
	const activityPath = `${location.pathname}?${activityParams}${location.hash}`;
	const mutation = useMutation({
		mutationFn: () => requestEpisodeDownload({ workKey, episode, commandId }),
		onSuccess: (result) => {
			console.info("[acquisition] Episode acquisition accepted.", {
				workKey,
				episode,
				intentId: result.intentId,
				existing: result.existing,
			});
			void client.invalidateQueries({ queryKey: [...downloadKeys, workKey] });
			void invalidateAnimeQueries(client, "acquisition", workKey);
			toast.add({
				id: `episode-download:${workKey}:${episode}`,
				type: "info",
				title: t(
					result.existing
						? "acquisition.episode.existing"
						: "acquisition.episode.searching",
				),
				actionProps: {
					children: t("acquisition.subscription.activity"),
					onClick: () => void navigate(activityPath),
				},
			});
		},
		onError: (error) => {
			console.warn("[acquisition] Episode acquisition could not be accepted.", {
				workKey,
				episode,
			});
			toast.add({
				id: `episode-download:${workKey}:${episode}`,
				type: "error",
				title: t(getErrorTranslationKey(error) ?? "acquisition.episode.failed"),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => mutation.mutate(),
				},
			});
		},
	});
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						disabled={mutation.isPending}
						aria-busy={mutation.isPending}
						aria-label={t("acquisition.episode.actions", { episode })}
					/>
				}
			>
				<Ellipsis className="size-4" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem
					disabled={mutation.isPending}
					onClick={() => mutation.mutate()}
				>
					<Download className="size-4" aria-hidden="true" />
					{t("acquisition.episode.download")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
