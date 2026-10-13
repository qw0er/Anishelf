import { directoryQuery as internal_directoryQuery } from "./library/queries.js";
export const directoryQuery = (
	...args: Parameters<typeof internal_directoryQuery>
) => internal_directoryQuery(...args);

import { libraryQuery as internal_libraryQuery } from "./library/queries.js";
export const libraryQuery = (
	...args: Parameters<typeof internal_libraryQuery>
) => internal_libraryQuery(...args);

import { startScan as internal_startScan } from "./library/api.js";
export const startScan = (...args: Parameters<typeof internal_startScan>) =>
	internal_startScan(...args);

import { fileQuery as internal_fileQuery } from "./resource-access/queries.js";
export const fileQuery = (...args: Parameters<typeof internal_fileQuery>) =>
	internal_fileQuery(...args);
