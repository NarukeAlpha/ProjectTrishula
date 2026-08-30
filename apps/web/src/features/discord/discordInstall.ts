const discordBotPermissions = 68_608;

export function discordInstallUrl(applicationId: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", applicationId);
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("scope", "bot");
  url.searchParams.set("permissions", String(discordBotPermissions));
  return url.toString();
}
