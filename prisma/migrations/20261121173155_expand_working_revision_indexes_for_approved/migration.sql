BEGIN;

CREATE UNIQUE INDEX "uq_resource_revisions_one_working_approved"
ON "resource_revisions" ("resource_id")
WHERE "status" IN (
    'DRAFT',
    'PENDING_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED'
);

CREATE UNIQUE INDEX "uq_challenge_revisions_one_working_approved"
ON "challenge_revisions" ("challenge_id")
WHERE "status" IN (
    'DRAFT',
    'PENDING_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED'
);

DROP INDEX "uq_resource_revisions_one_working";

ALTER INDEX "uq_resource_revisions_one_working_approved"
RENAME TO "uq_resource_revisions_one_working";

DROP INDEX "uq_challenge_revisions_one_working";

ALTER INDEX "uq_challenge_revisions_one_working_approved"
RENAME TO "uq_challenge_revisions_one_working";

COMMIT;
