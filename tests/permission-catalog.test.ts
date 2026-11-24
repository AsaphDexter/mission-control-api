import { describe, expect, it } from "vitest";

import {
  PERMISSION_CATALOG,
  ROLE_PERMISSION_CODES,
} from "../src/modules/authorization/permission-catalog.js";

const catalogCodes = new Set(PERMISSION_CATALOG.map((permission) => permission.code));

describe("RBAC permission catalogue", () => {
  it("contains no duplicate permission codes", () => {
    expect(catalogCodes.size).toBe(PERMISSION_CATALOG.length);
  });

  it("defines every permission assigned to a role", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSION_CODES)) {
      for (const permission of permissions) {
        expect(
          catalogCodes.has(permission),
          `${role} references undefined permission ${permission}`,
        ).toBe(true);
      }
    }
  });

  it("contains no duplicate permission assignments within a role", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSION_CODES)) {
      expect(new Set(permissions).size, `${role} contains duplicate permission assignments`).toBe(
        permissions.length,
      );
    }
  });

  it("grants Contributors all Learner permissions", () => {
    expect(ROLE_PERMISSION_CODES.CONTRIBUTOR).toEqual(
      expect.arrayContaining(ROLE_PERMISSION_CODES.LEARNER),
    );
  });

  it("grants Administrators all Contributor permissions", () => {
    expect(ROLE_PERMISSION_CODES.ADMINISTRATOR).toEqual(
      expect.arrayContaining(ROLE_PERMISSION_CODES.CONTRIBUTOR),
    );
  });

  it("allows only Administrators to assign non-administrator roles", () => {
    expect(ROLE_PERMISSION_CODES.LEARNER).not.toContain("users.assign.non_admin_roles");

    expect(ROLE_PERMISSION_CODES.CONTRIBUTOR).not.toContain("users.assign.non_admin_roles");

    expect(ROLE_PERMISSION_CODES.ADMINISTRATOR).toContain("users.assign.non_admin_roles");
  });

  it("does not expose administrator-role assignment as an ordinary permission", () => {
    expect(catalogCodes.has("users.assign.admin_role")).toBe(false);
  });

  it("grants resource category management only to Administrators", () => {
    expect(ROLE_PERMISSION_CODES.LEARNER).not.toContain("resources.categories.manage");

    expect(ROLE_PERMISSION_CODES.CONTRIBUTOR).not.toContain("resources.categories.manage");

    expect(ROLE_PERMISSION_CODES.ADMINISTRATOR).toContain("resources.categories.manage");
  });
});
