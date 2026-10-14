import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { buttonStyles } from "../../../shared/components/ui/button.js";
export function NotFoundPage() {
	const { t } = useTranslation();
	return (
		<section className="flex min-w-0 flex-col gap-4">
			<h1 className="page-title">{t("navigation.pageNotFound")}</h1>
			<div className="action-row">
				<Link className={buttonStyles("outline")} to="/">
					{t("navigation.goToRoot")}
				</Link>
			</div>
		</section>
	);
}
