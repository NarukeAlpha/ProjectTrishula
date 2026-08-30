import type { UserIdentity } from "convex/server";

export interface Actor {
  id: string;
  workosUserId: string;
  displayName?: string;
  email?: string;
}

function requiredWorkosUserId(identity: UserIdentity): string {
  const value = identity.subject?.trim();
  if (!value) {
    throw new Error("Authenticated WorkOS identity is missing subject.");
  }
  return value;
}

function allowedWorkosUserIds(): ReadonlySet<string> {
  const configured = process.env.WORKOS_ALLOWED_USER_IDS?.trim();
  if (!configured) {
    throw new Error("WORKOS_ALLOWED_USER_IDS is required.");
  }
  const values = configured
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) {
    throw new Error("WORKOS_ALLOWED_USER_IDS must contain at least one user ID.");
  }
  return new Set(values);
}

export function requireAllowedWorkosUserId(value: string): string {
  const workosUserId = value.trim();
  if (!workosUserId) throw new Error("WorkOS user ID is required.");
  if (!allowedWorkosUserIds().has(workosUserId)) {
    throw new Error("WorkOS user is not allowed.");
  }
  return workosUserId;
}

export function actorFromIdentity(identity: UserIdentity | null): Actor {
  if (!identity) throw new Error("Authentication required.");
  const workosUserId = requireAllowedWorkosUserId(requiredWorkosUserId(identity));
  const actor: Actor = {
    id: workosUserId,
    workosUserId,
  };
  if (identity.name) actor.displayName = identity.name;
  if (identity.email) actor.email = identity.email;
  return actor;
}
