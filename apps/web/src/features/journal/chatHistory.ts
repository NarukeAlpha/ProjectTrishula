export interface ClearChatHistoryBatchResult {
  deletedMessages: number;
  deletedRuns: number;
  hasMore: boolean;
}

export async function clearAllChatHistory(
  clearBatch: (args: {
    batchSize?: number;
  }) => Promise<ClearChatHistoryBatchResult>,
  batchSize = 100,
): Promise<void> {
  while (true) {
    const result = await clearBatch({ batchSize });
    if (!result.hasMore) return;
    if (result.deletedMessages === 0 && result.deletedRuns === 0) {
      throw new Error(
        "Chat history could not be fully cleared because no remaining records were removed.",
      );
    }
  }
}
