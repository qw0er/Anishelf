import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { libraryReturnPath } from "../../../../shared/navigation.js";
import { metadataDetailQuery } from "../../metadata/public.js";
import { Artwork } from "../../shared/components/artwork.js";
import {
	accountQuery,
	entryQuery,
	trackingIdentity,
	ViewingPanel,
} from "../../tracking/public.js";
import { WorkMetadataHeader } from "./work-metadata-header.js";
import { WorkSynopsis } from "./work-synopsis.js";
export function TrackedAnimeDetail() {
	const { mediaId = "" } = useParams();
	const [params] = useSearchParams();
	const { t } = useTranslation();
	const metadata = useQuery(metadataDetailQuery("anilist", mediaId));
	const account = useQuery(accountQuery());
	const entry = useQuery({
		...entryQuery(
			mediaId,
			account.data
				? trackingIdentity(account.data)
				: { accountId: null, generation: "" },
		),
		enabled: Boolean(account.data?.account),
	});
	const info = metadata.data?.data;
	const summary = entry.data?.entry;
	const title = summary?.titles[0] ?? info?.titles[0]?.value ?? mediaId;
	return (
		<section className="stack-page">
			<Link
				className={buttonStyles("outline")}
				to={libraryReturnPath(params.get("library"))}
				state={{ focusWork: `anilist-${mediaId}` }}
			>
				{t("anime.back")}
			</Link>
			<p className="surface-panel">{t("trackingList.noLocal")}</p>
			{metadata.data && info ? (
				<>
					<Artwork url={info.bannerUrl} title={title} banner />
					<WorkMetadataHeader
						data={{
							work: {
								displayTitle: title,
								coverUrl: summary?.coverUrl ?? info.coverUrl,
								format: info.format,
								year: info.year,
								episodeCount: info.episodeCount,
								reference: info.reference,
							},
							metadata: metadata.data,
						}}
					/>
					<ViewingPanel mediaId={mediaId} />
					<WorkSynopsis data={{ metadata: metadata.data }} />
				</>
			) : (
				<>
					<h1 className="page-title">{title}</h1>
					{summary && (
						<div className="w-32">
							<Artwork url={summary.coverUrl} title={title} />
						</div>
					)}
					<ViewingPanel mediaId={mediaId} />
					{metadata.error ? (
						<div role="alert">
							<p>{t("errors.pageLoad")}</p>
							<Button variant="outline" onClick={() => void metadata.refetch()}>
								{t("actions.retry")}
							</Button>
						</div>
					) : (
						<p role="status">{t("anime.loading")}</p>
					)}
				</>
			)}
		</section>
	);
}
