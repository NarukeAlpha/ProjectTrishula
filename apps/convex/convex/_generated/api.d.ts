/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as commands from "../commands.js";
import type * as crons from "../crons.js";
import type * as dispatch from "../dispatch.js";
import type * as discord from "../discord.js";
import type * as discord_http from "../discord_http.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_canonical_json from "../lib/canonical_json.js";
import type * as lib_data from "../lib/data.js";
import type * as lib_discord_contract from "../lib/discord_contract.js";
import type * as lib_discord_state from "../lib/discord_state.js";
import type * as lib_execution from "../lib/execution.js";
import type * as lib_invariants from "../lib/invariants.js";
import type * as lib_trade_approval from "../lib/trade_approval.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_service_auth from "../lib/service_auth.js";
import type * as messages from "../messages.js";
import type * as reconciliation from "../reconciliation.js";
import type * as results from "../results.js";
import type * as runs from "../runs.js";
import type * as threads from "../threads.js";
import type * as trading from "../trading.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  commands: typeof commands;
  crons: typeof crons;
  dispatch: typeof dispatch;
  discord: typeof discord;
  discord_http: typeof discord_http;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/canonical_json": typeof lib_canonical_json;
  "lib/data": typeof lib_data;
  "lib/discord_contract": typeof lib_discord_contract;
  "lib/discord_state": typeof lib_discord_state;
  "lib/execution": typeof lib_execution;
  "lib/invariants": typeof lib_invariants;
  "lib/trade_approval": typeof lib_trade_approval;
  "lib/validation": typeof lib_validation;
  "lib/service_auth": typeof lib_service_auth;
  messages: typeof messages;
  reconciliation: typeof reconciliation;
  results: typeof results;
  runs: typeof runs;
  threads: typeof threads;
  trading: typeof trading;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
