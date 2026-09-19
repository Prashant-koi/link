/**
 * Roles, subroles and the access scope derived from them.
 *
 * A Scope is the single object every graph query is filtered by. It is derived
 * from the JWT on the server and is never accepted from the client.
 */

export type Role = "student" | "faculty" | "staff";

export type Subrole =
  | "prof"
  | "assoc_prof"
  | "phd_student"
  | "admissions"
  | "finance"
  | "hr"
  | "deans_office"
  | "registrar"
  | null;

/** Apps that can appear in the dock. The dock is scope-derived — that is the demo. */
export type AppId =
  | "compass"
  | "me"
  | "courses"
  | "calendar"
  | "directory"
  | "labs"
  | "clubs"
  | "goals"
  | "admissions"
  | "finance"
  | "hr"
  | "dean";

export type Capability =
  | "discover"
  | "draft_intro_email"
  | "add_to_calendar"
  | "generate_checklist"
  | "manage_own_courses"
  | "post_openings"
  | "review_applications"
  | "view_finance"
  | "view_hr"
  | "view_institution_dashboards";

export interface Scope {
  /** id of the Person node this caller *is*. All "own" predicates key off this. */
  personId: string;
  role: Role;
  subrole: Subrole;
  name: string;
  apps: AppId[];
  capabilities: Capability[];
}

export interface Principal {
  personId: string;
  role: Role;
  subrole: Subrole;
  name: string;
}

const BASE_APPS: AppId[] = ["compass", "directory", "labs", "clubs", "calendar"];

/**
 * The scope matrix from the spec, in one place.
 * Anything not granted here is denied — both in the dock and in the query layer.
 */
export function scopeFor(p: Principal): Scope {
  const apps = new Set<AppId>(BASE_APPS);
  const caps = new Set<Capability>(["discover"]);

  if (p.role === "student") {
    ["me", "courses", "goals"].forEach((a) => apps.add(a as AppId));
    ["draft_intro_email", "add_to_calendar", "generate_checklist"].forEach((c) =>
      caps.add(c as Capability),
    );
  }

  if (p.role === "faculty") {
    ["me", "courses", "goals"].forEach((a) => apps.add(a as AppId));
    caps.add("manage_own_courses");
    caps.add("add_to_calendar");
    caps.add("draft_intro_email");
    if (p.subrole === "prof" || p.subrole === "assoc_prof") {
      caps.add("post_openings");
    }
  }

  if (p.role === "staff") {
    switch (p.subrole) {
      case "admissions":
        apps.add("admissions");
        caps.add("review_applications");
        caps.add("generate_checklist");
        break;
      case "finance":
        apps.add("finance");
        caps.add("view_finance");
        break;
      case "hr":
        apps.add("hr");
        caps.add("view_hr");
        break;
      case "deans_office":
        apps.add("dean");
        caps.add("view_institution_dashboards");
        break;
      case "registrar":
        apps.add("courses");
        break;
    }
  }

  return {
    personId: p.personId,
    role: p.role,
    subrole: p.subrole,
    name: p.name,
    apps: [...apps],
    capabilities: [...caps],
  };
}

export function can(scope: Scope, capability: Capability): boolean {
  return scope.capabilities.includes(capability);
}
