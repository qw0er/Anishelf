# Nyaa Corpus Supplement

Imported on 2026-10-11 from the user's completed local RSS/torrent collection.
No Nyaa network request, media download, tracker or peer connection was made
during import. Provider answers reuse the existing 2026-10-11 Bangumi/AniList
snapshots; their contents and collection dates were not refreshed or rewritten.

## Input and selection

| Item | Count |
| --- | ---: |
| Completed search manifests | 60 |
| Successful observations across searches | 3,839 |
| Duplicate observations by torrent SHA-256 | 262 |
| Distinct torrent metadata records | 3,577 |
| File records across distinct torrents | 100,766 |
| Selected publication sources | 33 |
| Added authentic file cases | 235 |
| Added authentic publication-title cases | 33 |
| Added identification cases | 268 |
| Confirmed work/episode answers | 183 |
| Review answers | 54 |
| Ancillary/ignore answers | 31 |
| Added directory scenarios | 5 |

Every distinct local torrent was re-decoded and its entire file inventory compared
with the exported JSON. RSS snapshot SHA-256 and entry titles/detail/download URLs
were checked against manifests. Duplicate observations retain their search IDs;
they are not counted as distinct torrents. [import-summary.json](import-summary.json)
preserves per-search counts, collection timestamps and hashes of RSS/manifests.

[releases.json](releases.json) preserves the 33 selected publications and their
679 complete inventory records, including videos, subtitles and other files.
Source URLs, exact titles, metadata SHA-256, file sizes and paths are retained;
torrent bytes, trackers, magnets and media contents are not included. The loader
rejects mismatched titles/URLs/hashes, inventory counts/bytes, or case inputs
that are absent from their captured inventory.

The whole batch is also preserved as a compressed, ignored local candidate bank
at `.nyaa-corpus.local/records.json.gz` in the repository root. It has no expected
answers and is not required by CI. It avoids dependence on temporary collector
output for future curation. It is not a provider catalog or a held-out accuracy
benchmark. Committed regression inputs are the curated subset in `corpus.json`.

## Covered boundaries

- Frieren S2 local episode 1 and continuous episode 29 both map to frozen sort 29;
  revisions remain separate file versions. A publication explicitly says `39-38`
  while its torrent lists `29-38`: the title stays unresolved and file cases are
  evaluated independently.
- A Frieren S2 publication includes S01/S00 files and a 2023 year. The contradictory
  file paths remain review cases; the release title does not silently rewrite them.
- An authentic Spy x Family batch combines S1 part 1, part 2, S2 and Code White.
  S1 part 1 and S2 have verified mappings; the uncaptured part and distinct film
  remain unresolved. Directory evidence is needed for short filenames such as
  `S02E01-FOLLOW MAMA AND PAPA`.
- Bocchi and Dungeon Meshi batches contain clean OP/ED, MV and nested extras.
  These remain discoverable supported video files but are ignored for regular
  episode identification. `v2/v3/v4`, checksums, resolution and audio numbers are
  not silently treated as episode numbers.
- Your Name has two color variants of one movie. Suzume combines the film and
  numbered PV trailers; numeric BDMV streams need playlist/content evidence and
  remain unresolved. A subtitle-only movie publication has no video resource.
- Steins;Gate 0 contains an alternate `23β` release and a special. Their precise
  provider association is unverified; stripping beta/special markers cannot
  establish a regular-episode match.
- Conan continuous numbering, 86 part directories, a Clannad multi-season/OVA
  batch, Bocchi recap movies and single TS `01-02` broadcasts retain authentic
  evidence. Their missing provider mappings are marked review. A parsed range
  does not prove the actual content of the video without inspecting it.

Positive cases cover nine already captured work records. This supplement does
not add provider snapshots for every work returned by the searches. A review
answer for an uncaptured work means that this frozen evaluation has insufficient
verified association data; it does not assert that no external provider can
identify that work. Search results are candidates, not an identity oracle.

## Regression scope

The five new recipes are `nyaa-frieren-local-and-continuous`,
`nyaa-spy-mixed-batch`, `nyaa-dungeon-extras`,
`nyaa-movie-versions-and-trailers` and `nyaa-publication-path-conflict`.
The test suite checks provenance, local/continuous offsets, mixed-work boundaries,
ancillary exclusion, scanner extension policy and evaluator detection of wrong
or unsafe confirmations. It also rejects invented capture paths or hashes.

These checks validate the corpus, scanner and evaluator. They do not run a real
anime parser/matcher or establish identification accuracy. Application acceptance
assertions remain pending; generated `.mkv`/`.mp4` files are text placeholders.

Run from the repository root:

```sh
npm run anime:corpus -- summary
npm run --silent anime:corpus -- match
```
