import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CatalogDetailResponse } from "../../../shared/api/contracts.js";
import { Button } from "../../../shared/components/ui/button.js";
import { Input } from "../../../shared/components/ui/input.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import { editEpisode, editWork } from "../api.js";

export function WorkEditor({ data }: { data: CatalogDetailResponse }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const work = useMutation({
		mutationFn: ({
			title,
			aliases,
		}: {
			title: string | null;
			aliases: string[];
		}) =>
			editWork(data.work.id, { revision: data.work.revision, title, aliases }),
		onSuccess: () => client.invalidateQueries({ queryKey: ["catalog"] }),
	});
	return (
		<details className="space-y-3 rounded-lg border p-4">
			<summary className="cursor-pointer font-medium">
				{t("review.editMetadata")}
			</summary>
			<form
				key={data.work.revision}
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					work.mutate({
						title: String(form.get("title") ?? "").trim() || null,
						aliases: String(form.get("aliases") ?? "")
							.split("\n")
							.map((value) => value.trim())
							.filter(Boolean),
					});
				}}
			>
				<label htmlFor="local-title" className="block text-sm">
					{t("review.localTitle")}
					<Input
						id="local-title"
						name="title"
						defaultValue={data.work.title ?? ""}
						maxLength={500}
					/>
				</label>
				<label htmlFor="local-aliases" className="block text-sm">
					{t("review.aliases")}
					<textarea
						id="local-aliases"
						name="aliases"
						defaultValue={data.work.aliases.join("\n")}
						className="min-h-20 w-full rounded-md border bg-background p-2"
					/>
				</label>
				<Button type="submit" disabled={work.isPending}>
					{t("review.saveMetadata")}
				</Button>
			</form>
			{work.error && (
				<p role="alert">
					{t(getErrorTranslationKey(work.error) ?? "errors.requestFailed")}
				</p>
			)}
			<EpisodeEditor data={data} />
		</details>
	);
}
function EpisodeEditor({ data }: { data: CatalogDetailResponse }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const edit = useMutation({
		mutationFn: ({
			id,
			number,
			label,
		}: {
			id: string;
			number: string;
			label: string;
		}) =>
			editEpisode(data.work.id, id, {
				revision: data.work.revision,
				number,
				label,
			}),
		onSuccess: () => client.invalidateQueries({ queryKey: ["catalog"] }),
	});
	return data.episodes.length ? (
		<form
			key={data.work.revision}
			className="space-y-3 border-t pt-3"
			onSubmit={(event) => {
				event.preventDefault();
				const form = new FormData(event.currentTarget);
				edit.mutate({
					id: String(form.get("episode")),
					number: String(form.get("number") ?? "").trim(),
					label: String(form.get("label") ?? "").trim(),
				});
			}}
		>
			<p className="text-sm text-muted-foreground">
				{t("review.episodeEditHint")}
			</p>
			<label className="flex flex-col gap-1 text-sm">
				{t("review.episode")}
				<select
					name="episode"
					className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"
				>
					{data.episodes.map((episode) => (
						<option key={episode.id} value={episode.id}>
							{episode.label} ({episode.kind} {episode.number})
						</option>
					))}
				</select>
			</label>
			<label htmlFor="episode-number" className="block text-sm">
				{t("review.episodeNumber")}
				<Input id="episode-number" name="number" required maxLength={100} />
			</label>
			<label htmlFor="episode-label" className="block text-sm">
				{t("review.episodeLabel")}
				<Input id="episode-label" name="label" required maxLength={500} />
			</label>
			<Button disabled={edit.isPending} type="submit">
				{t("review.saveEpisode")}
			</Button>
			{edit.error && (
				<p role="alert">
					{t(getErrorTranslationKey(edit.error) ?? "errors.requestFailed")}
				</p>
			)}
		</form>
	) : null;
}
