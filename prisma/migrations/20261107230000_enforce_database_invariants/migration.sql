-- Mission Control API: database invariants beyond the Prisma-generated baseline
-- Source: MC-DBD-001 v1.0
-- Apply after 20261107220000_init/migration.sql.
-- Review against the target PostgreSQL version before applying to any shared or
-- production database. This file is intended to be committed as a Prisma SQL migration.

-- -----------------------------------------------------------------------------
-- 1. User email normalisation and case-insensitive uniqueness
-- -----------------------------------------------------------------------------

ALTER TABLE "users"
    ADD CONSTRAINT "chk_users_email_lowercase"
    CHECK ("email" = LOWER("email"));

CREATE UNIQUE INDEX "uq_users_email_case_insensitive"
    ON "users" (LOWER("email"));

-- -----------------------------------------------------------------------------
-- 2. Partial unique indexes
-- -----------------------------------------------------------------------------

-- A user may hold a given role only once while that assignment is active.
CREATE UNIQUE INDEX "uq_user_roles_active"
    ON "user_roles" ("user_id", "role_id")
    WHERE "revoked_at" IS NULL;

-- At most one currently published revision per resource.
CREATE UNIQUE INDEX "uq_resource_revisions_one_published"
    ON "resource_revisions" ("resource_id")
    WHERE "status" = 'PUBLISHED';

-- At most one working revision per resource.
CREATE UNIQUE INDEX "uq_resource_revisions_one_working"
    ON "resource_revisions" ("resource_id")
    WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED');

-- At most one currently published revision per challenge.
CREATE UNIQUE INDEX "uq_challenge_revisions_one_published"
    ON "challenge_revisions" ("challenge_id")
    WHERE "status" = 'PUBLISHED';

-- At most one working revision per challenge.
CREATE UNIQUE INDEX "uq_challenge_revisions_one_working"
    ON "challenge_revisions" ("challenge_id")
    WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED');

-- Only one evaluation may be current for a submission.
CREATE UNIQUE INDEX "uq_submission_current_evaluation"
    ON "submission_evaluations" ("submission_id")
    WHERE "is_current" = TRUE;

-- -----------------------------------------------------------------------------
-- 3. Row-level check constraints
-- -----------------------------------------------------------------------------

ALTER TABLE "users"
    ADD CONSTRAINT "chk_users_auth_version_positive"
    CHECK ("auth_version" > 0);

ALTER TABLE "resource_revisions"
    ADD CONSTRAINT "chk_resource_revisions_number_positive"
    CHECK ("revision_number" > 0);

ALTER TABLE "challenge_revisions"
    ADD CONSTRAINT "chk_challenge_revisions_number_positive"
    CHECK ("revision_number" > 0),
    ADD CONSTRAINT "chk_challenge_revisions_maximum_score_positive"
    CHECK ("maximum_score" > 0),
    ADD CONSTRAINT "chk_challenge_revisions_passing_score_non_negative"
    CHECK ("passing_score" >= 0),
    ADD CONSTRAINT "chk_challenge_revisions_passing_score_lte_maximum"
    CHECK ("passing_score" <= "maximum_score"),
    ADD CONSTRAINT "chk_challenge_revisions_maximum_attempts_positive"
    CHECK ("maximum_attempts" > 0);

ALTER TABLE "challenge_evaluation_configs"
    ADD CONSTRAINT "chk_challenge_evaluation_configs_schema_version_positive"
    CHECK ("schema_version" > 0);

ALTER TABLE "challenge_submissions"
    ADD CONSTRAINT "chk_challenge_submissions_attempt_number_positive"
    CHECK ("attempt_number" > 0);

ALTER TABLE "user_challenge_attempts"
    ADD CONSTRAINT "chk_user_challenge_attempts_non_negative"
    CHECK ("attempts_used" >= 0);

ALTER TABLE "submission_evaluations"
    ADD CONSTRAINT "chk_submission_evaluations_number_positive"
    CHECK ("evaluation_number" > 0),
    ADD CONSTRAINT "chk_submission_evaluations_score_non_negative"
    CHECK ("score" >= 0),
    ADD CONSTRAINT "chk_submission_evaluations_maximum_score_positive"
    CHECK ("maximum_score" > 0),
    ADD CONSTRAINT "chk_submission_evaluations_score_lte_maximum"
    CHECK ("score" <= "maximum_score"),
    ADD CONSTRAINT "chk_submission_evaluations_evaluator_consistency"
    CHECK (
        ("evaluation_method" = 'AUTOMATIC' AND "evaluator_id" IS NULL)
        OR
        ("evaluation_method" = 'MANUAL' AND "evaluator_id" IS NOT NULL)
    );

-- Rejection and change-request reviews must include non-blank feedback.
ALTER TABLE "resource_reviews"
    ADD CONSTRAINT "chk_resource_reviews_feedback_required"
    CHECK (
        "decision" NOT IN ('REJECT', 'REQUEST_CHANGES')
        OR NULLIF(BTRIM("feedback"), '') IS NOT NULL
    );

ALTER TABLE "challenge_reviews"
    ADD CONSTRAINT "chk_challenge_reviews_feedback_required"
    CHECK (
        "decision" NOT IN ('REJECT', 'REQUEST_CHANGES')
        OR NULLIF(BTRIM("feedback"), '') IS NOT NULL
    );

-- -----------------------------------------------------------------------------
-- 4. Published revision content immutability
-- -----------------------------------------------------------------------------

-- Content and identifying fields of a revision become immutable once published.
-- The status and updated_at fields remain mutable for lifecycle transitions such
-- as PUBLISHED -> SUPERSEDED or ARCHIVED. The published_at timestamp and all
-- content fields remain protected after the revision has been published.
CREATE OR REPLACE FUNCTION public.prevent_published_revision_content_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" = 'PUBLISHED' OR OLD."published_at" IS NOT NULL THEN
            RAISE EXCEPTION 'Published revision records cannot be deleted.'
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD."status" = 'PUBLISHED' OR OLD."published_at" IS NOT NULL THEN
        IF (TO_JSONB(NEW) - ARRAY['status', 'updated_at'])
           IS DISTINCT FROM
           (TO_JSONB(OLD) - ARRAY['status', 'updated_at']) THEN
            RAISE EXCEPTION 'Published revision content is immutable; create a new revision.'
                USING ERRCODE = '55000';
        END IF;

        IF NEW."status" NOT IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
            RAISE EXCEPTION 'A published revision may only remain published, become superseded, or be archived.'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_resource_revisions_published_immutable"
    BEFORE UPDATE OR DELETE ON "resource_revisions"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_published_revision_content_changes();

CREATE TRIGGER "trg_challenge_revisions_published_immutable"
    BEFORE UPDATE OR DELETE ON "challenge_revisions"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_published_revision_content_changes();

-- -----------------------------------------------------------------------------
-- 5. Published challenge evaluation configuration immutability
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_published_evaluation_config_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_revision_id UUID;
    v_is_published BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_revision_id := OLD."challenge_revision_id";
    ELSE
        v_revision_id := NEW."challenge_revision_id";
    END IF;

    SELECT ("status" = 'PUBLISHED' OR "published_at" IS NOT NULL)
      INTO v_is_published
      FROM "challenge_revisions"
     WHERE "id" = v_revision_id;

    IF COALESCE(v_is_published, FALSE) THEN
        RAISE EXCEPTION 'Evaluation configuration for a published challenge revision is immutable.'
            USING ERRCODE = '55000';
    END IF;

    -- An update may try to move a config away from its original revision.
    IF TG_OP = 'UPDATE' THEN
        SELECT ("status" = 'PUBLISHED' OR "published_at" IS NOT NULL)
          INTO v_is_published
          FROM "challenge_revisions"
         WHERE "id" = OLD."challenge_revision_id";

        IF COALESCE(v_is_published, FALSE) THEN
            RAISE EXCEPTION 'Evaluation configuration belonging to a published challenge revision is immutable.'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_challenge_evaluation_configs_published_immutable"
    BEFORE INSERT OR UPDATE OR DELETE ON "challenge_evaluation_configs"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_published_evaluation_config_changes();

-- -----------------------------------------------------------------------------
-- 6. Publication and submission reference integrity
-- -----------------------------------------------------------------------------

-- A challenge revision cannot be published until its private evaluation
-- configuration row exists. The application must also validate the JSON
-- configuration against the relevant schema_version and challenge_type before
-- changing the revision to PUBLISHED; the database cannot infer those varying
-- application-level schemas from the generic JSONB column alone.
CREATE OR REPLACE FUNCTION public.require_challenge_evaluation_config_before_publish()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'PUBLISHED' AND NOT EXISTS (
        SELECT 1
          FROM "challenge_evaluation_configs" AS c
         WHERE c."challenge_revision_id" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'A challenge revision cannot be published without an evaluation configuration.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_challenge_revisions_require_evaluation_config"
    BEFORE INSERT OR UPDATE ON "challenge_revisions"
    FOR EACH ROW
    EXECUTE FUNCTION public.require_challenge_evaluation_config_before_publish();

-- A submission must be created against a revision that is published at the
-- moment of submission. Later superseding or archiving that revision does not
-- invalidate its historical submissions.
CREATE OR REPLACE FUNCTION public.require_published_challenge_revision_for_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_revision_status "content_revision_status";
BEGIN
    SELECT "status"
      INTO v_revision_status
      FROM "challenge_revisions"
     WHERE "id" = NEW."challenge_revision_id"
     FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Challenge revision does not exist.'
            USING ERRCODE = '23503';
    END IF;

    IF v_revision_status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'A submission must reference a currently published challenge revision.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_challenge_submissions_require_published_revision_insert"
    BEFORE INSERT ON "challenge_submissions"
    FOR EACH ROW
    EXECUTE FUNCTION public.require_published_challenge_revision_for_submission();

CREATE TRIGGER "trg_challenge_submissions_require_published_revision_update"
    BEFORE UPDATE OF "challenge_revision_id" ON "challenge_submissions"
    FOR EACH ROW
    EXECUTE FUNCTION public.require_published_challenge_revision_for_submission();

-- -----------------------------------------------------------------------------
-- 7. Append-only review and audit histories
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append-only; % is not permitted.', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "trg_resource_reviews_append_only"
    BEFORE UPDATE OR DELETE ON "resource_reviews"
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE TRIGGER "trg_challenge_reviews_append_only"
    BEFORE UPDATE OR DELETE ON "challenge_reviews"
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE TRIGGER "trg_audit_logs_append_only"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_append_only_mutation();

-- -----------------------------------------------------------------------------
-- 8. Submission evaluation history
-- -----------------------------------------------------------------------------

-- A current evaluation may be marked non-current once so a correction can be
-- appended. No other field may change, and non-current history cannot be changed.
CREATE OR REPLACE FUNCTION public.protect_submission_evaluation_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Submission evaluation history cannot be deleted.'
            USING ERRCODE = '55000';
    END IF;

    IF OLD."is_current" IS NOT TRUE THEN
        RAISE EXCEPTION 'Historical submission evaluations cannot be modified.'
            USING ERRCODE = '55000';
    END IF;

    IF NEW."is_current" IS NOT FALSE THEN
        RAISE EXCEPTION 'An existing current evaluation may only be marked non-current.'
            USING ERRCODE = '55000';
    END IF;

    IF (TO_JSONB(NEW) - 'is_current') IS DISTINCT FROM (TO_JSONB(OLD) - 'is_current') THEN
        RAISE EXCEPTION 'Evaluation correction must preserve the previous evaluation fields.'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_submission_evaluations_preserve_history"
    BEFORE UPDATE OR DELETE ON "submission_evaluations"
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_submission_evaluation_history();

-- Manual evaluations must identify an active administrator. The CHECK constraint
-- above handles the method/evaluator nullability rule; this trigger verifies the
-- evaluator's current role assignment when a manual evaluation is recorded.
CREATE OR REPLACE FUNCTION public.require_active_administrator_evaluator()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_active_administrator BOOLEAN;
BEGIN
    IF NEW."evaluation_method" = 'MANUAL' THEN
        SELECT EXISTS (
            SELECT 1
              FROM "user_roles" AS ur
              JOIN "roles" AS r ON r."id" = ur."role_id"
              JOIN "users" AS u ON u."id" = ur."user_id"
             WHERE ur."user_id" = NEW."evaluator_id"
               AND ur."revoked_at" IS NULL
               AND r."code" = 'ADMINISTRATOR'
               AND u."status" = 'ACTIVE'
        ) INTO v_is_active_administrator;

        IF NOT COALESCE(v_is_active_administrator, FALSE) THEN
            RAISE EXCEPTION 'Manual evaluation requires an active administrator as evaluator.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_submission_evaluations_authorised_evaluator"
    BEFORE INSERT OR UPDATE OF "evaluation_method", "evaluator_id"
    ON "submission_evaluations"
    FOR EACH ROW
    EXECUTE FUNCTION public.require_active_administrator_evaluator();

-- -----------------------------------------------------------------------------
-- 9. Cross-table maximum-attempt safeguard
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_user_challenge_attempt_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_maximum_attempts INTEGER;
BEGIN
    SELECT "maximum_attempts"
      INTO v_maximum_attempts
      FROM "challenge_revisions"
     WHERE "id" = NEW."challenge_revision_id";

    -- The foreign-key constraint will report a missing challenge revision.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF NEW."attempts_used" > v_maximum_attempts THEN
        RAISE EXCEPTION 'attempts_used (%) exceeds maximum_attempts (%) for challenge revision %.',
            NEW."attempts_used", v_maximum_attempts, NEW."challenge_revision_id"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_user_challenge_attempts_limit"
    BEFORE INSERT OR UPDATE ON "user_challenge_attempts"
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_user_challenge_attempt_limit();

-- Prevent a draft revision's attempt limit from being lowered below counters
-- already recorded for that revision.
CREATE OR REPLACE FUNCTION public.prevent_maximum_attempts_below_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_maximum_usage INTEGER;
BEGIN
    SELECT COALESCE(MAX("attempts_used"), 0)
      INTO v_existing_maximum_usage
      FROM "user_challenge_attempts"
     WHERE "challenge_revision_id" = NEW."id";

    IF NEW."maximum_attempts" < v_existing_maximum_usage THEN
        RAISE EXCEPTION 'maximum_attempts (%) cannot be lower than an existing attempts_used value (%).',
            NEW."maximum_attempts", v_existing_maximum_usage
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_challenge_revisions_maximum_attempts_guard"
    BEFORE UPDATE OF "maximum_attempts" ON "challenge_revisions"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_maximum_attempts_below_usage();

-- -----------------------------------------------------------------------------
-- 10. Atomic attempt reservation
-- -----------------------------------------------------------------------------

-- Call this function inside the same Prisma transaction that creates the
-- challenge_submissions row. Check the idempotency key/request hash before
-- calling it so a duplicate request does not consume another attempt.
CREATE OR REPLACE FUNCTION public.reserve_challenge_attempt(
    p_user_id UUID,
    p_challenge_revision_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_maximum_attempts INTEGER;
    v_revision_status "content_revision_status";
    v_reserved_attempt INTEGER;
BEGIN
    SELECT "maximum_attempts", "status"
      INTO v_maximum_attempts, v_revision_status
      FROM "challenge_revisions"
     WHERE "id" = p_challenge_revision_id
     FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Challenge revision does not exist.'
            USING ERRCODE = '23503';
    END IF;

    IF v_revision_status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'Challenge revision is not currently published.'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO "user_challenge_attempts" (
        "id",
        "user_id",
        "challenge_revision_id",
        "attempts_used",
        "created_at",
        "updated_at"
    )
    VALUES (
        gen_random_uuid(),
        p_user_id,
        p_challenge_revision_id,
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT ("user_id", "challenge_revision_id") DO NOTHING;

    UPDATE "user_challenge_attempts"
       SET "attempts_used" = "attempts_used" + 1,
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "user_id" = p_user_id
       AND "challenge_revision_id" = p_challenge_revision_id
       AND "attempts_used" < v_maximum_attempts
    RETURNING "attempts_used" INTO v_reserved_attempt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHALLENGE_ATTEMPT_LIMIT_REACHED'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN v_reserved_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_challenge_attempt(UUID, UUID) FROM PUBLIC;

COMMENT ON FUNCTION public.reserve_challenge_attempt(UUID, UUID) IS
    'Atomically reserves the next attempt for a published challenge revision. Call inside the same transaction as submission creation; perform idempotency checks first. Grant EXECUTE to the runtime database principal after it has been provisioned.';

-- Approved audit anonymisation/retention remains a separately privileged
-- maintenance procedure. Ordinary UPDATE and DELETE operations are blocked by
-- the audit trigger above; do not disable the trigger for application traffic.
