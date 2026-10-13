import type { FileDto } from "../../contracts/http.js";
import type { FileInfo } from "../../modules/resources/resource-access/public.js";
export function fileDto(file: FileInfo): FileDto {
	return {
		kind: "file",
		id: file.id,
		parentId: file.parentId,
		name: file.name,
		sizeBytes: file.sizeBytes,
		modifiedAt: file.modifiedAt,
		mimeType: file.mimeType,
	};
}
