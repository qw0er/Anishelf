import { basename } from "node:path";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";

export async function chooseResourceDirectory(
	parent: BrowserWindow | null,
): Promise<string | null> {
	const options: OpenDialogOptions = {
		title: "Choose a resource directory",
		properties: ["openDirectory"],
	};
	const result = parent
		? await dialog.showOpenDialog(parent, options)
		: await dialog.showOpenDialog(options);
	const selected = result.canceled ? undefined : result.filePaths[0];
	if (!selected) {
		console.info("desktop.resource_directory_cancelled");
		return null;
	}
	console.info("desktop.resource_directory_selected", {
		directory: basename(selected),
	});
	return selected;
}
