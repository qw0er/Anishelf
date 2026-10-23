# AniList Authorization and API Verification

## Scope and Historical Evidence

This is the executable provider check for step 1 of the
[archived AniList design](../history.md#anilist-design-9-delivery-and-verification).
It does not implement the production Tracking module or satisfy ANI01–ANI10 by
itself. Client ID `53902` was supplied by the maintainer; it is public application
identity, not a credential. Its registered redirect URI has not yet been confirmed.

The iteration was subsequently accepted by the user on 2026-10-17; see the
[final acceptance record](../history.md#anilist-accounts-archive-notes). The registration
and evidence statements here describe the diagnostic checkpoint, not current release blockers.

Evidence recorded on 2026-10-15:

| Check | Result |
| --- | --- |
| Official PIN and mutation documentation | Reviewed; live authorization remains required |
| Native Node fetch to https://graphql.anilist.co, anonymous Media(id: 1, type: ANIME) | HTTP 200, media ID 1, no GraphQL errors |
| Native API schema introspection | HTTP 200; MediaListCollection exposes lists/user/hasNextChunk; SaveMediaListEntry exposes id/mediaId/progress/status and no conditional-version argument |
| Verification fixture tests | 10 passed; these do not contact AniList |
| User-supplied authorization token | Accepted by the real API; PIN-page output and registered redirect URI were not independently observed |
| Authenticated Viewer and complete personal lists | Passed from the local Node CLI: Viewer identified the account; 3 chunks, 244 unique entries |
| Actual progress/status changes and independent read-back | Pending an explicitly selected existing entry and desired values |

Authenticated read verification retrieved 198 COMPLETED, 27 DROPPED, 2 PLANNING
and 17 CURRENT entries. The private local report has mode 0600 and records no
write attempt. No token or full personal list is copied into this repository.
Successful backend reads validate token use for these queries; they do not yet
validate mutations or attest which Client ID issued the token.

The initial sandbox request failed with ENOTFOUND; the same read-only request
succeeded with network access outside the sandbox. This is not evidence of an
AniList service failure. No real account token or personal-list mutation was used
for the anonymous connectivity check.

## 1. Obtain a Token Locally

In the [AniList developer settings](https://anilist.co/settings/developer), verify
that application 53902 uses `https://anilist.co/api/v2/oauth/pin` as its redirect URI.
Generate the authorization URL:

```sh
npm run anilist:verify
```

Open the printed URL, authorize the correct account on AniList, and copy the access
token shown by the PIN page. Do not paste a token into chat, command arguments,
source files or reports. The CLI cannot attest which application issued a supplied
token; successful API calls alone do not verify the browser authorization flow.
Record the actual PIN-page behavior separately without capturing the token.

For zsh, this creates a temporary private token file without echoing the input or
including its value in shell history:

```sh
(umask 077; read -rs 'ANISHELF_VERIFY_TOKEN?Paste AniList access token: '; printf '\n'; printf '%s' "$ANISHELF_VERIFY_TOKEN" > /tmp/anishelf-anilist-token)
```

The CLI requires a regular token file without group/other permissions. Protect
this file as a credential and delete it when verification is finished. It is not
the production credential store.

## 2. Verify Account and Lists

```sh
npm run anilist:verify -- \
  --token-file /tmp/anishelf-anilist-token \
  --output /tmp/anishelf-anilist-read.json
```

Every API run requires an explicit output path that does not already exist. The
CLI creates the report with mode 0600, never overwrites an existing report and
prints its absolute location. Reports contain account identity and personal list
data, including private entries; keep them outside the repository.

The default invocation makes no mutations. It checks Viewer, retrieves every
MediaListCollection chunk, deduplicates repeated entries in custom lists and
rejects incomplete GraphQL results or inconsistent entries. Output lists the
number of chunks and unique entries. The report records account identity and the
minimal entry fields needed for subsequent verification. No token is returned or
written into it.

## 3. Preview and Apply a Specific Change

Select an existing entry belonging to the test account and agree on the exact
values to change. The following is a template; replace the media ID and progress:

```sh
npm run anilist:verify -- \
  --token-file /tmp/anishelf-anilist-token \
  --media-id MEDIA_ID --progress NEW_PROGRESS --status PAUSED \
  --output /tmp/anishelf-anilist-preview.json
```

This only previews the baseline and desired values. Omit either --progress or
--status to test only the other field. Allowed statuses are CURRENT, PLANNING,
COMPLETED, PAUSED, DROPPED and REPEATING. Progress must be a nonnegative integer;
media ID must be a positive integer. A no-op is rejected because it does not
verify an actual change. Entry creation and deletion are outside this checker.

After reviewing the target and values, rerun the command with `--apply` and a new
report path. That invocation reads a fresh baseline, saves it before delivery,
checks the remote entry again, sends only requested fields using the list-entry
ID and verifies both the mutation result and an independent read-back.

A successful write changes the real account. The tool does not automatically
restore the original values or promise to reverse provider activity side effects.
If restoration is desired, review the report's original progress/status and the
current remote entry, then explicitly preview/apply those values with another
report. It never writes scores, notes, dates or repeat counts.

A report left at `attempting`, a network error or a failed read-back does not prove
that a mutation failed. Inspect the remote state before any retry. The checker
performs no automatic retry. Read-before-write still has a concurrent-edit window;
it is not an atomic remote conditional update.

## 4. Safety and Failure Behavior

Requests target only the fixed AniList HTTPS GraphQL endpoint; redirects are
rejected. Calls are sequential, spaced at least 2500 ms apart and time out after
20 seconds. HTTP errors, GraphQL errors even on HTTP 200, invalid JSON, partial
chunks and unexpected account/entry identity fail the run. Raw provider error
bodies and transport exception details are withheld so a provider cannot echo a
token into output. A numeric Retry-After is shown on HTTP failure; the operator
must wait before rerunning. This diagnostic checker is not the production shared
scheduler or durable submission queue.

The JSON report is created before API work and the write baseline is flushed
before attempting a mutation. Keep an interrupted report for reconciliation.
`authorizationFlow: not-attested` is intentional: the checker does not observe the
user's PIN authorization page. Record real authorization evidence only after
checking the actual registered app and its output.

Run local regression checks with:

```sh
npm run anilist:verify:test
npm run biome:check
npm run lint
```

The fixture suite verifies fixed-origin credential delivery, withheld errors,
chunk completion/deduplication, account isolation, read-only preview, changed
baseline rejection, explicit backward corrections, no retry after uncertain
mutation and independent read-back mismatch detection.

References: [official authentication/PIN guide](https://raw.githubusercontent.com/AniList/docs/master/docs/guide/auth/index.md),
[implicit flow and its client-side guidance](https://raw.githubusercontent.com/AniList/docs/master/docs/guide/auth/implicit.md),
[mutation fields](https://raw.githubusercontent.com/AniList/docs/master/docs/reference/mutation.md).
The design's use of the manually supplied token from the user's self-hosted
backend still requires actual provider verification; do not infer that result
from documentation or fixtures alone.
