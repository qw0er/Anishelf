import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../shared/components/ui/dialog.js";
import { toast } from "../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../shared/lib/error-translation.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import {
	activityStatus,
	episodeActivityStatus,
	episodeNeedsAttention,
} from "./activity-status.js";
import { DownloadActivityPanel } from "./download-activity.js";
import {
	downloadKeys,
	getWorkDownloadActivity,
	requestEpisodeDownload,
} from "./downloads-api.js";

export function EpisodeDownloadAction({
	workKey,
	episode,
}: {
	workKey: string;
	episode: number;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [open, setOpen] = useState(false);
	const [commandId] = useState(() => crypto.randomUUID());
	const query = useQuery({
		queryKey: [...downloadKeys, workKey, "episodes"],
		queryFn: async ({ signal }) => {
			const previous = client.getQueryData<
				Awaited<ReturnType<typeof getWorkDownloadActivity>>
			>([...downloadKeys, workKey, "episodes"]);
			const result = await getWorkDownloadActivity(workKey, { signal });
			if (
				result.items.some(
					(item) =>
						item.state === "available" &&
						!previous?.items.some(
							(old) => old.id === item.id && old.state === "available",
						),
				)
			) {
				void invalidateAnimeQueries(client, "acquisition", workKey);
			}
			return result;
		},
		staleTime: 5000,
		refetchInterval: (query) => (query.state.data?.active ? 5000 : 60000),
	});
	const item = query.data?.items
		.filter((item) => item.episode === episode)
		.sort((a, b) => b.updatedAt - a.updatedAt)[0];
	const attention = !!item && episodeNeedsAttention(item);
	const status = item ? episodeActivityStatus(item, t) : null;
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
					children: t("acquisition.episode.viewTask"),
					onClick: () => setOpen(true),
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
		<>
			<Button
				variant="ghost"
				className="episode-primary-action min-w-0 justify-center px-3 tabular-nums"
				disabled={mutation.isPending || (query.isPending && !item)}
				aria-busy={mutation.isPending}
				aria-label={
					item
						? `${t("acquisition.episode.taskLabel", { episode })}: ${activityStatus(item, t)}`
						: t("acquisition.episode.downloadLabel", { episode })
				}
				onClick={() => {
					if (item || query.isError) {
						setOpen(true);
						console.info("[acquisition] Episode task details opened.", {
							workKey,
							episode,
						});
					} else mutation.mutate();
				}}
			>
				{(attention || query.isError) && (
					<TriangleAlert
						className="size-4 shrink-0 text-destructive"
						aria-hidden="true"
					/>
				)}
				{!item && !query.isError && (
					<Download className="size-4 shrink-0" aria-hidden="true" />
				)}
				<span className="min-w-0 truncate">
					{query.isError && !item
						? t("acquisition.episode.statusUnknown")
						: mutation.isPending || query.isPending
							? t("acquisition.episode.compactWaiting")
							: query.isError && status
								? `${status} · ${t("acquisition.episode.stale")}`
								: (status ?? t("acquisition.episode.downloadAction"))}
				</span>
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[85dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{t("acquisition.episode.taskTitle", { episode })}
						</DialogTitle>
					</DialogHeader>
					<DownloadActivityPanel
						workKey={workKey}
						episode={episode}
						view={{ subscription: null }}
						reason={(code) => code}
						onConfigure={() => {}}
					/>
				</DialogContent>
			</Dialog>
		</>
	);
}
