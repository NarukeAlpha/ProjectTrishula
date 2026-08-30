import { timingSafeEqual } from "node:crypto";

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isBoundActor(boundActorId: string | undefined, actorId: string): boolean {
  return boundActorId === undefined || equal(boundActorId, actorId);
}

export function assertBoundActor(boundActorId: string, actorId: string): void {
  if (!equal(boundActorId, actorId)) throw new Error("Actor does not match this Pi runtime.");
}
