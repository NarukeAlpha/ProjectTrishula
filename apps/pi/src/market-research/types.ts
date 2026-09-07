import type { z } from "zod";
import type {
  requestedSourceStatusSchema,
} from "./contracts.js";

export type RequestedSourceStatus = z.infer<typeof requestedSourceStatusSchema>;
