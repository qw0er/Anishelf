-- Preserve the exact audio selection of single-track preparation snapshots.
UPDATE preparation_tasks
SET snapshot = json_remove(
    json_set(snapshot,
        '$.request.audioStreamIndices', CASE
            WHEN json_type(snapshot, '$.request.audioStreamIndex') = 'integer'
            THEN json_array(json_extract(snapshot, '$.request.audioStreamIndex'))
            ELSE json_array()
        END,
        '$.identity.audioStreamIndices', CASE
            WHEN json_type(snapshot, '$.request.audioStreamIndex') = 'integer'
            THEN json_array(json_extract(snapshot, '$.request.audioStreamIndex'))
            ELSE json_array()
        END
    ),
    '$.request.audioStreamIndex', '$.identity.audioStreamIndex'
)
WHERE json_type(snapshot, '$.request.audioStreamIndices') IS NULL
  AND json_type(snapshot, '$.request.audioStreamIndex') IN ('integer', 'null');
