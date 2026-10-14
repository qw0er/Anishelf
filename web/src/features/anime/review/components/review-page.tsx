import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { buttonStyles } from "../../../../shared/components/ui/button.js";
import { IdentificationStatus } from "../../identification-status.js";
import { reviewsQuery } from "../queries.js";
import { ReviewEditor } from "./review-editor.js";
import { ReviewList } from "./review-list.js";
export function ReviewPage() {
	const [params, setParams] = useSearchParams();
	const item = params.get("item");
	const decision = ["pending", "confirmed", "rejected"].includes(
		params.get("decision") ?? "",
	)
		? (params.get("decision") ?? "pending")
		: "pending";
	const rawPage = params.get("page") ?? "1";
	const page = /^[1-9][0-9]{0,4}$/.test(rawPage) ? Number(rawPage) : 1;
	const scope = useQueryScope();
	const { t } = useTranslation();
	const query = useQuery({
		...reviewsQuery(decision, page, scope),
		enabled: !item,
	});
	const listUrl = `/review?${new URLSearchParams({ decision, page: String(page) })}`;
	return (
		<section className="min-w-0 space-y-6">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="max-w-2xl space-y-2">
					<h1 className="page-title">{t("review.title")}</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{t("review.hint")}
					</p>
				</div>
				{item && (
					<Link to={listUrl} className={buttonStyles("outline")}>
						<ArrowLeft className="size-4" aria-hidden="true" />
						{t("review.back")}
					</Link>
				)}
			</header>
			<IdentificationStatus />
			{item ? (
				<ReviewEditor key={`${item}:${scope}`} id={item} />
			) : (
				<ReviewList
					decision={decision}
					page={page}
					query={query}
					onPage={(page) => setParams({ decision, page: String(page) })}
				/>
			)}
		</section>
	);
}
