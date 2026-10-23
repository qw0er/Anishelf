const units = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatFileSize(bytes: number, locale: string): string {
	let size = bytes;
	let unit = 0;
	while (size >= 1000 && unit < units.length - 1) {
		size /= 1000;
		unit += 1;
	}
	const value = new Intl.NumberFormat(locale, {
		maximumFractionDigits: unit === 0 ? 0 : 2,
	}).format(size);
	return `${value} ${units[unit]}`;
}
