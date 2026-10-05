import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "../../../components/ui/button.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import { usePreparations } from "../use-preparations.js";
import { PreparationTaskCard } from "./task-card.js";
export function PreparationsPage() {
	const { t } = useTranslation();
	const list = usePreparations();
	const navigate = useNavigate();
	return (
		<section className="stack-page">
			<h1 className="page-title">{t("preparation.title")}</h1>
			<p>{t("preparation.listDescription")}</p>
			<Button variant="outline" onClick={list.refresh}>
				{t("preparation.refresh")}
			</Button>
			{list.loading && <p role="status">{t("preparation.loading")}</p>}
			{list.error !== null && (
				<p role="alert">
					{t(getErrorTranslationKey(list.error) ?? "errors.requestFailed")}
				</p>
			)}
			{!list.loading && !list.error && list.tasks.length === 0 && (
				<p>{t("preparation.empty")}</p>
			)}
			{list.tasks.map((task) => (
				<PreparationTaskCard
					key={task.id}
					task={task}
					refresh={list.refresh}
					onWatch={(task) =>
						navigate(
							`/files/${encodeURIComponent(task.fileId)}?preparation=${encodeURIComponent(task.id)}`,
						)
					}
				/>
			))}
		</section>
	);
}
