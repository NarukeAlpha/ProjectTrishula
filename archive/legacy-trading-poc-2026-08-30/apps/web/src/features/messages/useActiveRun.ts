import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { publicApi } from "../../convex/functions";
import type { ActiveRunReadModel, ResultBatch } from "../../convex/types";

const batchPageSize = 64;

interface StreamCursor {
  runId: string | null;
  afterSequence: number;
  batches: ResultBatch[];
}

export function useActiveRun(
  threadId: string,
): ActiveRunReadModel | null | undefined {
  // This small query tracks active-run identity and terminal handoff without
  // subscribing to an unbounded result history.
  const metadata = useQuery(
    publicApi.runs.getActive,
    threadId
      ? { threadId, afterSequence: Number.MAX_SAFE_INTEGER, limit: 1 }
      : "skip",
  );
  const [cursor, setCursor] = useState<StreamCursor>({
    runId: null,
    afterSequence: 0,
    batches: [],
  });
  const runId = metadata?.run.runId ?? null;
  const page = useQuery(
    publicApi.runs.getActive,
    threadId && runId
      ? {
          threadId,
          afterSequence: cursor.runId === runId ? cursor.afterSequence : 0,
          limit: batchPageSize,
        }
      : "skip",
  );

  useEffect(() => {
    if (!page || page.run.runId !== runId) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setCursor((previous) => {
        const prior = previous.runId === runId ? previous.batches : [];
        const bySequence = new Map(
          prior.map((batch) => [batch.sequence, batch]),
        );
        for (const batch of page.batches) bySequence.set(batch.sequence, batch);
        const batches = [...bySequence.values()].sort(
          (left, right) => left.sequence - right.sequence,
        );
        const afterSequence = batches.at(-1)?.sequence ?? 0;
        if (
          previous.runId === runId &&
          previous.afterSequence === afterSequence &&
          previous.batches.length === batches.length
        ) {
          return previous;
        }
        return { runId, afterSequence, batches };
      });
    });
    return () => {
      current = false;
    };
  }, [metadata, page, runId]);

  return useMemo(() => {
    if (metadata === undefined) return undefined;
    if (metadata === null) return null;
    const currentPage =
      page?.run.runId === metadata.run.runId ? page.batches : [];
    const accumulated =
      cursor.runId === metadata.run.runId ? cursor.batches : [];
    const batches = new Map(
      accumulated.map((batch) => [batch.sequence, batch]),
    );
    for (const batch of currentPage) batches.set(batch.sequence, batch);
    return {
      ...metadata,
      batches: [...batches.values()].sort(
        (left, right) => left.sequence - right.sequence,
      ),
    };
  }, [cursor, metadata, page]);
}
