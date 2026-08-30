import { internal } from "./_generated/api.js";
import { httpAction } from "./_generated/server.js";
import {
  discordGatewayRequestSchema,
  type DiscordGatewayOperation,
  type DiscordGatewayResponse,
} from "./lib/discord_contract.js";
import { authorizedDiscordGatewayRequest } from "./lib/service_auth.js";

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function json<T>(body: DiscordGatewayResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function success<T>(operation: DiscordGatewayOperation, result: T): Response {
  return json({ ok: true, operation, result });
}

type WithoutUndefinedDeep<T> = T extends readonly (infer Item)[]
  ? WithoutUndefinedDeep<Item>[]
  : T extends object
    ? {
        [Key in keyof T as undefined extends T[Key] ? never : Key]: WithoutUndefinedDeep<T[Key]>;
      } & {
        [Key in keyof T as undefined extends T[Key] ? Key : never]?: WithoutUndefinedDeep<
          Exclude<T[Key], undefined>
        >;
      }
    : T;

function withoutUndefined<T>(value: T): WithoutUndefinedDeep<T> {
  // SAFETY: The validated request contains JSON values only. The JSON round trip removes
  // optional properties whose inferred Zod type includes explicit `undefined`.
  return JSON.parse(JSON.stringify(value)) as WithoutUndefinedDeep<T>;
}

export const discordGateway = httpAction(async (ctx, request) => {
  if (!authorizedDiscordGatewayRequest(request)) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const parsed = discordGatewayRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid Discord gateway request." }, 400);
  }
  const body = parsed.data;
  try {
    switch (body.operation) {
      case "syncGuilds": {
        const { operation, ...args } = body;
        return success(operation, await ctx.runMutation(internal.discord.syncGuilds, withoutUndefined(args)));
      }
      case "ingestMessage": {
        const { operation, ...args } = body;
        const result = await ctx.runMutation(internal.discord.ingestMessage, withoutUndefined(args));
        return result.accepted
          ? success(operation, result)
          : json({ ok: false, operation, error: result.reason }, 409);
      }
      case "claimLoop": {
        const { operation, ...args } = body;
        const result = await ctx.runMutation(internal.discord.claimLoop, args);
        return success(operation, result);
      }
      case "newestContext": {
        const { operation, ...args } = body;
        return success(operation, await ctx.runQuery(internal.discord.getNewestContext, args));
      }
      case "completeLoop": {
        const { operation, ...args } = body;
        const result = await ctx.runMutation(internal.discord.completeLoop, withoutUndefined(args));
        return result.accepted
          ? success(operation, result)
          : json({ ok: false, operation, error: result.reason }, 409);
      }
      case "heartbeat": {
        const { operation, ...args } = body;
        const result = await ctx.runMutation(internal.discord.heartbeat, withoutUndefined(args));
        return success(operation, result);
      }
      case "listRunnable": {
        const { operation, ...args } = body;
        return success(operation, await ctx.runMutation(internal.discord.listRunnable, withoutUndefined(args)));
      }
      case "enqueueReply": {
        const { operation, ...args } = body;
        const result = await ctx.runMutation(internal.discord.enqueueReply, withoutUndefined(args));
        return result.accepted
          ? success(operation, result)
          : json({ ok: false, operation, error: result.reason }, 409);
      }
      case "acknowledgeReply": {
        const { operation, ...args } = body;
        const result = await ctx.runMutation(internal.discord.acknowledgeReply, withoutUndefined(args));
        return result.accepted
          ? success(operation, result)
          : json({ ok: false, operation, error: result.reason }, 409);
      }
    }
  } catch {
    return json({ ok: false, operation: body.operation, error: "Discord gateway operation failed." }, 400);
  }
});
