import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { ErrorMessage } from "../../shared/components/error-message.js";
import { workReviewsQuery } from "../queries.js";

export function UnresolvedResources({ workId }: { workId: string }) {
	const { t } = useTranslation();
	const [page, setPage] = useState(1);
	const query = useQuery(workReviewsQuery(workId, page, useQueryScope()));
	return (
		<section
			className="surface-panel space-y-3"
			aria-label={t("anime.unresolvedResources")}
		>
			<h2 className="text-lg font-semibold">
				{t("anime.unresolvedResources")}
			</h2>
			{query.data?.items.length ? (
				<p className="text-sm text-muted-foreground">
					{t("anime.unresolvedCandidatesHint")}
				</p>
			) : null}
			{query.error && (
				<ErrorMessage error={query.error} retry={() => void query.refetch()} />
			)}
			{query.isPending && !query.error && (
				<p role="status">{t("anime.loading")}</p>
			)}
			{query.data && (
				<>
					{query.data.items.length ? (
						<ul className="divide-y">
							{query.data.items.map((item) => (
								<li key={item.id} className="space-y-1 py-3">
									<Link
										to={`/review?item=${encodeURIComponent(item.id)}`}
										className="underline wrap-anywhere"
									>
										{item.relativePath}
									</Link>
									<p className="text-sm text-muted-foreground">
										{item.unresolved.join(" · ") || t("review.pending")}
										{!item.available && ` · ${t("anime.unavailable")}`}
									</p>
								</li>
							))}
						</ul>
					) : (
						<p>{t("anime.noUnresolvedResources")}</p>
					)}
					{(page > 1 || query.data.hasNextPage) && (
						<div className="flex gap-2">
							<Button
								variant="outline"
								disabled={page === 1 || query.isFetching}
								onClick={() => setPage(page - 1)}
							>
								{t("anime.previous")}
							</Button>
							<Button
								variant="outline"
								disabled={!query.data.hasNextPage || query.isFetching}
								onClick={() => setPage(page + 1)}
							>
								{t("anime.next")}
							</Button>
						</div>
					)}
				</>
			)}
			<Link to="/review?decision=pending" className="text-sm underline">
				{t("anime.allUnresolved")}
			</Link>
		</section>
	);
}
