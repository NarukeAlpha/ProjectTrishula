import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthInteraction, AuthPrompt, AuthEvent } from "@earendil-works/pi-ai";

export function authPathFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.PI_AUTH_PATH?.trim() || "/data/auth.json";
}

function promptMessage(prompt: AuthPrompt): string {
  if (prompt.type === "select") {
    return `${prompt.message}\n${prompt.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n")}\nChoose: `;
  }
  return `${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `;
}

export async function runCodexAuth(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const authPath = authPathFromEnvironment(environment);
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
  const controller = new AbortController();
  const readline = createInterface({ input, output });
  const mode = environment.CODEX_AUTH_MODE?.trim().toLowerCase();
  const interaction: AuthInteraction = {
    signal: controller.signal,
    prompt: async (prompt) => {
      if (prompt.type === "select" && mode === "device_code") return "device_code";
      if (prompt.type === "select" && mode === "browser") return "browser";
      if (prompt.type === "select" && !input.isTTY) return "device_code";
      const answer = await readline.question(promptMessage(prompt));
      if (prompt.type !== "select") return answer.trim();
      const selected = prompt.options[Number(answer.trim()) - 1];
      if (!selected) throw new Error("Invalid login method selection.");
      return selected.id;
    },
    notify: (event: AuthEvent) => {
      if (event.type === "device_code") {
        output.write(`\nOpen ${event.verificationUri} and enter code ${event.userCode}.\n`);
      } else if (event.type === "auth_url") {
        output.write(`\nOpen the displayed authorization URL to continue.\n${event.url}\n`);
      } else if (event.type === "progress" || event.type === "info") {
        output.write(`${event.message}\n`);
      }
    },
  };
  try {
    await runtime.login("openai-codex", "oauth", interaction);
    if (!runtime.hasConfiguredAuth("openai-codex")) throw new Error("OpenAI Codex login did not produce a credential.");
    output.write(`Codex authentication saved to ${authPath}.\n`);
  } finally {
    controller.abort();
    readline.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexAuth().catch((error) => {
    output.write(`${error instanceof Error ? error.message : "Codex authentication failed."}\n`);
    process.exitCode = 1;
  });
}
