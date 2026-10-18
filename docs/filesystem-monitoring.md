# Filesystem monitoring and incremental library updates

Resources uses native recursive filesystem events as the primary automatic update
mechanism. There is no scheduled full scan. Startup, resource-root changes,
explicit scans and recovery after known monitoring failures establish a complete
baseline. AniList metadata refresh remains independent.

## Event processing

`ResourceMonitor` wraps Chokidar with symbolic-link following disabled, atomic
write normalization and a two-second write-stability window. This window only
indicates that writes have paused; it is not a download-completion guarantee.
Each configured root is canonicalized before watching and owns an independent
monitor and recovery queue. Resource IDs include the opaque scope ID, so identical
relative paths in different directories remain distinct. Watch initialization may enumerate the
root to establish native watches; ordinary changes do not traverse the whole root.

The monitor collects root-relative dirty paths in a bounded set, using a 500 ms
batch window with a fixed deadline so continuous events cannot postpone work
forever. The watcher starts before baseline traversal. Events received during a
scan or settings save remain queued. One coordinator serializes baseline scans,
incremental publications and resource-setting changes.

Events are hints, not authoritative additions or deletions. `readChanges` resolves
each affected path through confined Resource Access, reading its parent directory
and inspecting only affected video files. Newly discovered directories require
subtree discovery; known, unrelated directories are not traversed. Missing
paths remove existing entries, while access errors fail the batch. A final root
read prevents publishing deletions when the root is unavailable. Symbolic links
are excluded consistently with full scanning.

`LibraryIndex.apply` validates new parent relationships, updates affected child
lists and publishes one revision per effective batch. Queries retain the previous
snapshot until the batch commits. Map containers are copied for atomic publication;
this is not an O(changes)-only memory allocation guarantee. Unchanged events do
not publish another revision. Resource versions use the existing size,
nanosecond timestamps and filesystem identity fingerprint, not content hashing.

## Recognition and Catalog

Library publications carry affected directory IDs, or a full-baseline marker.
Automatic Identification reads only those directory groups during ordinary
updates. It re-evaluates sibling context because numbering decisions can depend
on nearby files, retaining existing bounded parser batches. Results and source
versions are revalidated before publication. Changes to an active directory cancel
and requeue that work; unrelated directories do not interrupt it. Root resets
invalidate prior work through the access revision. Failed directory work is retried.

Catalog accepts either a complete scope publication or a publication scoped to
explicit file IDs, including the previous scoped file IDs of removed directory groups.
Only records inside that scope become unavailable. The availability update and
proposal writes are transactional, while automatic admission retains its existing
per-source validation. Manual decisions, episode corrections, associations and
playback history are not deleted. An unreadable source does not imply removal.

Moves are an old-path removal plus a new-path discovery. This implementation does
not infer identity-preserving relinks (L11), nor copy manual associations to a
replacement source version. Old associations and playback records remain stored.

## Failure recovery and lifecycle

Watcher errors, root loss and queue overflow report degraded monitoring and retain
the published index. Retries back off from one second to at most 30 seconds. A
new watcher and a successful baseline restore monitoring. Recovery scans with
unreadable resources do not replace the retained snapshot. Manual scans can retry
immediately. Root changes discard queued old-scope events; recovery reconciles only the affected
directory while healthy directories continue publishing incremental changes; shutdown closes the
watcher and waits for active work.

Native events cannot prove the absence of silently lost events. Network-mounted
filesystems need deployment-specific validation. There is no automatic switch to
filesystem polling and no periodic full-scan safety net. Manual scans remain the
explicit reconciliation path for undetected drift.

## API and Web behavior

`scanIntervalMinutes` is removed from settings commands and responses. Loading
an existing settings file drops that obsolete field and atomically rewrites the
validated settings. Other unknown fields remain invalid.

Library status exposes monitoring state and revision. Web polls status every three
seconds while visible (one second during full scans); this reads status, not the
filesystem tree. Resource revisions invalidate dependent queries. Identification
also exposes a publication revision so a run that completes between polls still
refreshes Catalog and Library. Persistent monitoring status stays in Files;
ordinary resource patches and successful incremental identification remain silent. Full-scan actions
retain their existing progress and result feedback.
