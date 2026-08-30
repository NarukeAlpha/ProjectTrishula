import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Owns the one Codex OAuth runtime used by both the existing chat executor and
 * the Discord agents. The runtime reads and refreshes credentials only through
 * the configured PI_AUTH_PATH.
 */
export class CodexRuntime {
  private creation: Promise<ModelRuntime> | undefined;

  constructor(private readonly authPath: string) {}

  async get(): Promise<ModelRuntime> {
    this.creation ??= this.create();
    return this.creation;
  }

  async requireModel(modelId: string) {
    const runtime = await this.get();
    const model = runtime.getModel("openai-codex", modelId);
    if (!model) throw new Error(`Pi does not recognize OpenAI Codex model ${modelId}.`);
    const auth = await runtime.getAuth(model, { minOAuthValidityMs: 0 });
    if (!auth) throw new Error("OpenAI Codex auth is not ready.");
    return model;
  }

  private async create(): Promise<ModelRuntime> {
    const runtime = await ModelRuntime.create({
      authPath: this.authPath,
      modelsPath: null,
      refreshOnCreate: true,
    });
    if (!runtime.hasConfiguredAuth("openai-codex")) {
      throw new Error(`OpenAI Codex auth is not configured at ${this.authPath}.`);
    }
    return runtime;
  }
}

export function createCodexRuntime(authPath: string): CodexRuntime {
  return new CodexRuntime(authPath);
}
