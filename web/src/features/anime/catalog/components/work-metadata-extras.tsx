import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalWorkDetailResponse } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { fuzzyDate, safeLink } from "../detail-format.js";
import type { LocalWorkDetailController } from "../use-local-work-detail.js";
export function WorkMetadataExtras({
	data,
	controller,
}: {
	data: Pick<LocalWorkDetailResponse, "metadata">;
	controller?: Pick<
		LocalWorkDetailController,
		"showSpoilers" | "toggleSpoilers"
	>;
}) {
	const { t } = useTranslation();
	const { metadata } = data;
	const info = metadata.data;
	const [localSpoilers, setLocalSpoilers] = useState(false);
	const showSpoilers = controller?.showSpoilers ?? localSpoilers;
	const toggleSpoilers =
		controller?.toggleSpoilers ?? (() => setLocalSpoilers((value) => !value));
	const providerUrl = safeLink(info.siteUrl);
	return (
		<details className="space-y-3 rounded-lg border p-4">
			<summary className="cursor-pointer font-medium">
				{t("anime.moreMetadata")}
			</summary>
			<dl className="grid gap-3 text-sm sm:grid-cols-2">
				{[
					["startDate", fuzzyDate(info.startDate)],
					["endDate", fuzzyDate(info.endDate)],
					["genres", info.genres.join(", ") || null],
					[
						"studios",
						info.studios.map((studio) => studio.name).join(", ") || null,
					],
					["source", info.source],
					[
						"duration",
						info.durationMinutes === null
							? null
							: t("anime.minutes", { minutes: info.durationMinutes }),
					],
					[
						"rating",
						info.averageScore === null ? null : `${info.averageScore}/100`,
					],
				].map(([key, value]) => (
					<div key={key}>
						<dt className="text-muted-foreground">{t(`anime.${key}`)}</dt>
						<dd>{value ?? t("anime.unknown")}</dd>
					</div>
				))}
			</dl>
			<p className="text-sm text-muted-foreground">
				{t("anime.provider", { provider: info.reference.provider })}
				{providerUrl && (
					<>
						{" "}
						·{" "}
						<a
							className="underline"
							href={providerUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t("anime.providerPage")}
						</a>
					</>
				)}
			</p>
			<p className="text-sm">
				{info.tags
					.filter((tag) => showSpoilers || !tag.spoiler)
					.map((tag) => tag.name)
					.join(" · ")}
			</p>
			{info.tags.some((tag) => tag.spoiler) && (
				<Button variant="outline" onClick={() => toggleSpoilers()}>
					{t(showSpoilers ? "anime.hideSpoilers" : "anime.showSpoilers")}
				</Button>
			)}
		</details>
	);
}
