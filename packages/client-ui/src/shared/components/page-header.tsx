import type { ReactNode } from "react";

export function PageHeader({
	title,
	description,
	actions,
	id,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	id?: string;
}) {
	return (
		<header className="page-header">
			<div className="min-w-0 space-y-2">
				<h1 id={id} className="page-title">
					{title}
				</h1>
				{description && <p className="page-description">{description}</p>}
			</div>
			{actions && <div className="action-row shrink-0">{actions}</div>}
		</header>
	);
}
