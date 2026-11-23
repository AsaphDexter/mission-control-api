export const PERMISSION_CATALOG = [
  {
    code: "profile.read.own",
    description: "Read the authenticated user's own profile.",
  },
  {
    code: "profile.update.own",
    description: "Update the authenticated user's own profile.",
  },

  {
    code: "resources.read.published",
    description: "Read published learning resources.",
  },
  {
    code: "resources.read.own",
    description: "Read resources owned by the authenticated user, including unpublished resources.",
  },
  {
    code: "resources.read.all",
    description: "Read all learning resources regardless of ownership.",
  },
  {
    code: "resources.create",
    description: "Create learning resources.",
  },
  {
    code: "resources.update.own",
    description: "Update resources owned by the authenticated user.",
  },
  {
    code: "resources.submit.own",
    description: "Submit owned resources for review.",
  },
  {
    code: "resources.review",
    description: "Review submitted learning resources.",
  },
  {
    code: "resources.publish",
    description: "Publish approved learning resources.",
  },
  {
    code: "resources.archive",
    description: "Archive learning resources.",
  },
  {
    code: "resources.categories.manage",
    description: "Create, update and deactivate learning resource categories.",
  },

  {
    code: "challenges.read.published",
    description: "Read published QA challenges.",
  },
  {
    code: "challenges.read.own",
    description:
      "Read challenges owned by the authenticated user, including unpublished challenges.",
  },
  {
    code: "challenges.read.all",
    description: "Read all QA challenges regardless of ownership.",
  },
  {
    code: "challenges.create",
    description: "Create QA challenges.",
  },
  {
    code: "challenges.update.own",
    description: "Update challenges owned by the authenticated user.",
  },
  {
    code: "challenges.submit.own",
    description: "Submit owned challenges for review.",
  },
  {
    code: "challenges.review",
    description: "Review submitted QA challenges.",
  },
  {
    code: "challenges.publish",
    description: "Publish approved QA challenges.",
  },
  {
    code: "challenges.archive",
    description: "Archive QA challenges.",
  },

  {
    code: "submissions.create",
    description: "Submit responses to QA challenges.",
  },
  {
    code: "submissions.read.own",
    description: "Read the authenticated user's own submissions.",
  },
  {
    code: "submissions.read.all",
    description: "Read submissions from all learners.",
  },
  {
    code: "submissions.evaluate",
    description: "Evaluate challenge submissions and record results.",
  },

  {
    code: "progress.read.own",
    description: "Read the authenticated user's own learning progress.",
  },
  {
    code: "progress.read.all",
    description: "Read learning progress across all learners.",
  },

  {
    code: "users.read",
    description: "Read user account records for administration.",
  },
  {
    code: "users.update.status",
    description: "Manage user account statuses.",
  },
  {
    code: "users.assign.non_admin_roles",
    description: "Assign or revoke Learner and Contributor roles.",
  },

  {
    code: "roles.read",
    description: "Read available application roles.",
  },
  {
    code: "permissions.read",
    description: "Read the application permission catalogue.",
  },
  {
    code: "audit_logs.read",
    description: "Read application audit logs.",
  },
] as const satisfies readonly {
  code: string;
  description: string;
}[];

export type PermissionCode = (typeof PERMISSION_CATALOG)[number]["code"];

const LEARNER_PERMISSIONS = [
  "profile.read.own",
  "profile.update.own",
  "resources.read.published",
  "challenges.read.published",
  "submissions.create",
  "submissions.read.own",
  "progress.read.own",
] as const satisfies readonly PermissionCode[];

const CONTRIBUTOR_PERMISSIONS = [
  ...LEARNER_PERMISSIONS,
  "resources.read.own",
  "resources.create",
  "resources.update.own",
  "resources.submit.own",
  "challenges.read.own",
  "challenges.create",
  "challenges.update.own",
  "challenges.submit.own",
] as const satisfies readonly PermissionCode[];

const ADMINISTRATOR_PERMISSIONS = [
  ...CONTRIBUTOR_PERMISSIONS,

  "resources.read.all",
  "resources.review",
  "resources.publish",
  "resources.archive",
  "resources.categories.manage",

  "challenges.read.all",
  "challenges.review",
  "challenges.publish",
  "challenges.archive",

  "submissions.read.all",
  "submissions.evaluate",

  "progress.read.all",

  "users.read",
  "users.update.status",
  "users.assign.non_admin_roles",

  "roles.read",
  "permissions.read",
  "audit_logs.read",
] as const satisfies readonly PermissionCode[];

export const ROLE_PERMISSION_CODES = {
  LEARNER: LEARNER_PERMISSIONS,
  CONTRIBUTOR: CONTRIBUTOR_PERMISSIONS,
  ADMINISTRATOR: ADMINISTRATOR_PERMISSIONS,
} as const satisfies Record<"LEARNER" | "CONTRIBUTOR" | "ADMINISTRATOR", readonly PermissionCode[]>;

export type RoleCode = keyof typeof ROLE_PERMISSION_CODES;
