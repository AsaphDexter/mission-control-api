-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "content_revision_status" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'PUBLISHED', 'REJECTED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

-- CreateEnum
CREATE TYPE "challenge_type" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'API_ASSERTION', 'SQL_EXERCISE', 'TEST_CASE_DESIGN', 'TEST_PLAN', 'BUG_REPORT', 'AUTOMATION_ASSIGNMENT', 'EXPLORATORY_REPORT');

-- CreateEnum
CREATE TYPE "difficulty_level" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "evaluation_method" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('RECEIVED', 'PENDING_REVIEW', 'IN_REVIEW', 'EVALUATED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100),
    "biography" TEXT,
    "profile_image_url" VARCHAR(2048),
    "status" "user_status" NOT NULL,
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "email_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "auth_version_at_issue" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_token_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "resource_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_revisions" (
    "id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "category_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "external_url" VARCHAR(2048),
    "status" "content_revision_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "resource_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_reviews" (
    "id" UUID NOT NULL,
    "resource_revision_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "review_decision" NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "challenge_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_revisions" (
    "id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "category_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "challenge_type" "challenge_type" NOT NULL,
    "difficulty" "difficulty_level" NOT NULL,
    "maximum_score" DECIMAL(8,2) NOT NULL,
    "passing_score" DECIMAL(8,2) NOT NULL,
    "maximum_attempts" INTEGER NOT NULL DEFAULT 3,
    "learning_objectives" JSONB NOT NULL,
    "status" "content_revision_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "challenge_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_evaluation_configs" (
    "id" UUID NOT NULL,
    "challenge_revision_id" UUID NOT NULL,
    "evaluation_method" "evaluation_method" NOT NULL,
    "configuration" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "challenge_evaluation_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_reviews" (
    "id" UUID NOT NULL,
    "challenge_revision_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "review_decision" NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_submissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "challenge_revision_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_payload" JSONB NOT NULL,
    "status" "submission_status" NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "challenge_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_challenge_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "challenge_revision_id" UUID NOT NULL,
    "attempts_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_challenge_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_evaluations" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "evaluation_number" INTEGER NOT NULL,
    "evaluation_method" "evaluation_method" NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "maximum_score" DECIMAL(8,2) NOT NULL,
    "feedback" TEXT,
    "evaluator_id" UUID,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role_snapshot" VARCHAR(50),
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "request_id" VARCHAR(100),
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_status" ON "users"("status");

-- CreateIndex
CREATE INDEX "idx_users_created_at" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_roles_code" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_permissions_code" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "idx_user_roles_role_id" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_permissions_role_permission" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_refresh_tokens_token_hash" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_email_verification_tokens_token_hash" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_password_reset_tokens_token_hash" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_resource_categories_slug" ON "resource_categories"("slug");

-- CreateIndex
CREATE INDEX "idx_resource_revisions_category_id" ON "resource_revisions"("category_id");

-- CreateIndex
CREATE INDEX "idx_resource_revisions_status" ON "resource_revisions"("status");

-- CreateIndex
CREATE INDEX "idx_resource_revisions_published_at" ON "resource_revisions"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_resource_revisions_resource_revision" ON "resource_revisions"("resource_id", "revision_number");

-- CreateIndex
CREATE INDEX "idx_resource_reviews_resource_revision_id" ON "resource_reviews"("resource_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_challenge_categories_slug" ON "challenge_categories"("slug");

-- CreateIndex
CREATE INDEX "idx_challenge_revisions_category_id" ON "challenge_revisions"("category_id");

-- CreateIndex
CREATE INDEX "idx_challenge_revisions_status" ON "challenge_revisions"("status");

-- CreateIndex
CREATE INDEX "idx_challenge_revisions_difficulty" ON "challenge_revisions"("difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "uq_challenge_revisions_challenge_revision" ON "challenge_revisions"("challenge_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_challenge_evaluation_configs_revision" ON "challenge_evaluation_configs"("challenge_revision_id");

-- CreateIndex
CREATE INDEX "idx_challenge_reviews_challenge_revision_id" ON "challenge_reviews"("challenge_revision_id");

-- CreateIndex
CREATE INDEX "idx_challenge_submissions_user_id" ON "challenge_submissions"("user_id");

-- CreateIndex
CREATE INDEX "idx_challenge_submissions_revision_id" ON "challenge_submissions"("challenge_revision_id");

-- CreateIndex
CREATE INDEX "idx_challenge_submissions_status" ON "challenge_submissions"("status");

-- CreateIndex
CREATE INDEX "idx_challenge_submissions_submitted_at" ON "challenge_submissions"("submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_challenge_submissions_user_revision_attempt" ON "challenge_submissions"("user_id", "challenge_revision_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_challenge_submissions_user_idempotency" ON "challenge_submissions"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_user_challenge_attempts_revision_id" ON "user_challenge_attempts"("challenge_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_challenge_attempts_user_revision" ON "user_challenge_attempts"("user_id", "challenge_revision_id");

-- CreateIndex
CREATE INDEX "idx_submission_evaluations_evaluator_id" ON "submission_evaluations"("evaluator_id");

-- CreateIndex
CREATE INDEX "idx_submission_evaluations_is_current" ON "submission_evaluations"("is_current");

-- CreateIndex
CREATE UNIQUE INDEX "uq_submission_evaluations_submission_number" ON "submission_evaluations"("submission_id", "evaluation_number");

-- CreateIndex
CREATE INDEX "idx_audit_logs_actor_user_id" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey" FOREIGN KEY ("replaced_by_token_id") REFERENCES "refresh_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_revisions" ADD CONSTRAINT "resource_revisions_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_revisions" ADD CONSTRAINT "resource_revisions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "resource_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_revisions" ADD CONSTRAINT "resource_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_reviews" ADD CONSTRAINT "resource_reviews_resource_revision_id_fkey" FOREIGN KEY ("resource_revision_id") REFERENCES "resource_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_reviews" ADD CONSTRAINT "resource_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_revisions" ADD CONSTRAINT "challenge_revisions_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_revisions" ADD CONSTRAINT "challenge_revisions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "challenge_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_revisions" ADD CONSTRAINT "challenge_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_evaluation_configs" ADD CONSTRAINT "challenge_evaluation_configs_challenge_revision_id_fkey" FOREIGN KEY ("challenge_revision_id") REFERENCES "challenge_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_reviews" ADD CONSTRAINT "challenge_reviews_challenge_revision_id_fkey" FOREIGN KEY ("challenge_revision_id") REFERENCES "challenge_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_reviews" ADD CONSTRAINT "challenge_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_submissions" ADD CONSTRAINT "challenge_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_submissions" ADD CONSTRAINT "challenge_submissions_challenge_revision_id_fkey" FOREIGN KEY ("challenge_revision_id") REFERENCES "challenge_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_challenge_attempts" ADD CONSTRAINT "user_challenge_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_challenge_attempts" ADD CONSTRAINT "user_challenge_attempts_challenge_revision_id_fkey" FOREIGN KEY ("challenge_revision_id") REFERENCES "challenge_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_evaluations" ADD CONSTRAINT "submission_evaluations_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "challenge_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_evaluations" ADD CONSTRAINT "submission_evaluations_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
