# Acquisition Selection Profiles

Acquisition profiles select one supported regular-episode release from a manually
configured RSS feed. They do not search new sites, handle packs, certify playback
compatibility, or upgrade reserved downloads. Watching/Torznab automation remains
planned separately.

## Built-in profiles

| ID | Name | Levels, in priority order |
| --- | --- | --- |
| `builtin:general` | General (default) | 1080p / 2160p after 60 minutes; 720p after 120 minutes |
| `builtin:efficient` | Efficient codecs preferred | HEVC / AV1 at 1080p / 2160p after 120 minutes; any codec at those resolutions after 180 minutes; 720p after 240 minutes |
| `builtin:chinese` | Chinese subtitles | Require explicitly declared Simplified or Traditional Chinese subtitles; 1080p / 2160p after 60 minutes; 720p after 120 minutes |

These thresholds all run from the first eligible observation of an episode; they
are not accumulated between levels. The defaults allow time for later releases
to appear. They are initial tradeoffs, not guarantees that a preferred release
will be published within the window. Custom profiles can still use zero-minute waits.

1080p and 2160p are equal inside a level, as are HEVC and AV1. General and Efficient
accept unknown subtitle language. None of the built-ins requires a seed count or
restricts groups, source or subtitle format. Unknown resolution cannot satisfy
these built-ins. Codec efficiency does not guarantee quality, size or playback.

## External configuration and selection

Create `acquisition-profiles.yaml` in the application data directory. Start with the
[commented example](examples/acquisition-profiles.yaml). The file is optional and
only adds custom definitions; built-ins remain available. The application reads a
validated immutable snapshot at startup, never generates or rewrites this file, and
requires a restart after edits. Invalid configuration fails startup with diagnostics.
Hot reload is tracked as future requirement
[O20](requirements.md#acquisition-profile-hot-reload-o20); it is not implemented.
YAML 1.2 mappings, lists and scalar values are supported; aliases, custom tags,
duplicate keys, unknown fields and multiple documents are rejected.

Settings > RSS selects the global default. `settings.json` stores only the optional
`defaultAcquisitionProfileId`; omission uses `builtin:general`. Each subscription
can override it in its subscription form or follow the global default.
Subscription save validates the effective profile. Publication and task admission
retain profile fingerprint checks, including a changed inherited default.
An unavailable saved profile ID is preserved and blocks new selections until an
available profile is chosen. Configuration changes invalidate unreserved published
choices until discovery evaluates them again; existing reservations stay locked.

`GET /api/acquisition/profiles` publishes profile IDs, names, descriptions, sources
and the global selection's availability. Settings writes use the existing
`PUT /api/settings`. Subscription save accepts optional `profileId` (null/omitted
means follow global), and persists it with the subscription revision.

## File fields

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | Integer, required | Must be `1` |
| `profiles` | Array, required | At most 100 custom profiles |
| `profiles[].id` | String, required | `custom:` plus a lowercase letter followed by up to 63 lowercase letters, digits or hyphens; unique and cannot replace built-ins |
| `name` | String, required | Nonblank display name, at most 240 characters |
| `description` | String, optional | Nonblank explanation, at most 240 characters |
| `requirements` | Conditions, optional | Hard conditions shared by every level |
| `preferMoreSeeders` | Boolean, optional | Default true; compares counts only within the best unlocked level |
| `levels` | Array, required | 1–32 levels, highest priority first |
| `levels[].name` | String, required | Nonblank display name, at most 240 characters |
| `levels[].match` | Conditions or `anyOf`, required | `{}` accepts any release passing hard requirements |
| `levels[].acceptAfterMinutes` | Integer, required | 0–10080 minutes from the episode's first eligible observation; must not decrease down the levels |

All lists in conditions contain 1–64 unique values. Omit a field to impose no
constraint. Different fields are ANDed. Positive attribute lists match any listed
value; their order does not express preference. `includeKeywords` requires all
listed words; exclusion lists reject any matching word/group.

| Condition field | Values / matching |
| --- | --- |
| `subtitleLanguages` | `zh-Hans`, `zh-Hant`, `en`, `ja`, `ko`; multilingual releases match any included language |
| `subtitleFormats` | `hard`, `soft`, `external` |
| `resolutions` | Integer height labels, 1–8640; e.g. `[1080, 2160]` |
| `videoCodecs` | `avc`, `hevc`, `av1`, `vp9`, `mpeg2`, `mpeg4` |
| `sources` | `web`, `bluray`, `hdtv`, `dvd` |
| `releaseGroups` | Allowed complete normalized names; joint names also expose their `&`/`+` components |
| `excludeReleaseGroups` | Blocked normalized group names |
| `includeKeywords` | All must occur in the release title |
| `excludeKeywords` | Any occurrence excludes the release |
| `minSeeders` | Minimum source-reported count, 0–2147483647 |
| `unknownSeeders` | `allow` or `reject`; requires `minSeeders`, defaults to `reject` |

Group names and keywords use Unicode NFKC normalization and case-insensitive
comparison. Group matching is exact; keywords use literal substring matching,
without regex. Unknown attributes cannot satisfy explicit positive conditions;
unknown groups do not match a blocked group. A later level can omit an attribute to
accept unknown values, but cannot relax a hard requirement.

`match` may instead contain only `anyOf`, an array of 1–32 ordinary condition
objects. Any branch may match; all fields within a branch must match. Do not mix
`anyOf` with ordinary fields or nest expressions. `requirements` accepts ordinary
conditions only. There are no scores, scripts, `earlySelect` conditions or separate
wait overrides.

## Evidence and seed counts

Anime reuses its existing Anitomy parser for group, resolution, codec, source and
revision evidence. Supplementary rules recognize explicit Chinese language/format
annotations such as CHS/CHT, simplified/traditional labels, bilingual Chinese/Japanese
and soft/hard/external subtitle labels. These are release declarations, not verified
media tracks. The supported language list is bounded; absent or unrecognized
annotations remain unknown. Do not infer language from a group name or website.

RSS reads `nyaa:seeders` and Torznab `seeders` attributes when present. Missing,
negative, malformed or out-of-range counts are null. Counts expire one hour after
the last XML observation carrying the item. HTTP 304 responses and retained items
absent from a new response do not renew their observation times. The Mikan Classic
sample has no seed counts; its nested `torrent/pubDate` is supported. Dates without
a timezone retain JavaScript Date parsing semantics; they do not establish a
source timezone.

Reported counts are not download guarantees. The generic Torznab reader cannot
detect fabricated adapter values (for example an indexer hardcoding one seeder);
operators must avoid seed thresholds for such sources. No tracker scrape is issued.

## Decision and recovery rules

1. Keep existing work/season/episode, scope, supported-link, local-availability and
   downloader checks. Profile conditions never bypass them.
2. Apply hard requirements and assign each candidate to its first matching level.
   No matching level means no automatic download.
3. Start a per-episode clock when a candidate passes the checks and matches any
   level. Persist the earliest time with candidate decisions. Feed evidence is
   retained, and new versions, subscription edits, pauses and restarts do not reset
   the clock for the same feed/episode. Switching feeds starts a new clock.
4. Among levels whose wait has elapsed, choose the highest priority. A preferred
   level with a zero-minute wait can select immediately. Re-evaluation runs on RSS
   refresh (including 304), so thresholds are not exact submission deadlines.
5. Within that level, prefer larger known positive seed counts when enabled, then
   unknown counts, then reported zero. Otherwise equal candidates prefer a newer
   declared revision within the same group set, then earlier publication and stable
   entry identity. Resolution list order never breaks ties.
6. Reconsider unreserved choices whenever evidence changes. Once Downloads reserves
   an episode/candidate, preserve that decision. Existing final authorization,
   identity/availability checks, uniqueness and verified import still apply.

Candidate responses include profile ID/fingerprint, level, first observation,
eligibility threshold and effective seed count. Activity shows the level and wait
threshold or rejection reason. Structured decision logs contain work/candidate IDs,
profile/level, timings and reason codes without feed URLs, release titles or tokens.

The database migration adds nullable subscription profile IDs, candidate decision
snapshots and optional feed seed observations. Existing subscriptions inherit the
global profile; old candidate snapshots are re-evaluated before new reservations.
Existing downloads retain their reservations. Automated tests cover parsing,
selection, persistence/restart, direct saves and UI interactions. Live feeds,
qBittorrent and browser visual acceptance remain separate checks.
