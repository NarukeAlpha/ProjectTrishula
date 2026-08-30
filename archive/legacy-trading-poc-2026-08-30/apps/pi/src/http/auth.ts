import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function bearerAuthentication(sharedSecret: string) {
  const expected = digest(sharedSecret);

  return (request: Request, response: Response, next: NextFunction): void => {
    const authorization = request.header("authorization");
    const candidate = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    const valid = candidate.length > 0 && timingSafeEqual(digest(candidate), expected);

    if (!valid) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({ error: "unauthorized" });
      return;
    }

    next();
  };
}
