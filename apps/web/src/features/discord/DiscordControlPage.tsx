import { useMutation, useQuery } from "convex/react";
import { useState, type ComponentProps } from "react";
import { publicApi } from "../../convex/functions";
import type {
  DiscordActivityReadModel,
  DiscordChannelReadModel,
  DiscordChannelRole,
  DiscordConversationPrivacyDeletionReadModel,
  DiscordConversationResetReadModel,
  DiscordControlPlaneReadModel,
  DiscordGatewayStatus,
  DiscordGuildReadModel,
  DiscordLoopStatus,
  MarketResearchControlStatusReadModel,
  SaveMarketResearchControlSettings,
} from "../../convex/types";
import { formatAge } from "../../shared/formatting/values";
import { discordInstallUrl } from "./discordInstall";
import { newspaperActionError } from "./newspaperActionError";
import {
  newspaperFailureMessage,
  newspaperPreviewSummary,
} from "./newspaperStatus";
import {
  acknowledgeNewspaperTest,
  newspaperSettingsKey,
  newspaperTestRequestId,
} from "./newspaperSettings";

type ServerChannelPurpose = "conversation" | "research";

const gatewayLabels = {
  online: "Connected",
  offline: "Disconnected",
  degraded: "Needs attention",
  not_configured: "Not configured",
} satisfies Record<DiscordGatewayStatus, string>;

const loopLabels = {
  idle: "Ready",
  triaging: "Reviewing chat",
  acknowledging: "Writing acknowledgment",
  researching: "Researching",
  drafting: "Writing reply",
  catching_up: "Catching up",
  error: "Loop error",
} satisfies Record<DiscordLoopStatus, string>;

function activityLabel(event: DiscordActivityReadModel): string {
  if (event.eventType === "message_received") return "Message received";
  if (event.eventType === "loop_started") return "Reviewing chat";
  if (event.eventType === "loop_completed") return "Loop complete";
  if (event.eventType === "loop_failed") return "Loop failed";
  if (event.eventType === "delivery_uncertain") {
    return "Delivery needs verification";
  }
  if (event.eventType === "delivery_reconciliation_required") {
    return "Delivery blocked for reconciliation";
  }
  if (event.eventType === "stage_changed") {
    return event.stage === undefined ? "Loop updated" : loopLabels[event.stage];
  }
  const subject =
    event.replyKind === "acknowledgement"
      ? "Acknowledgment"
      : event.replyKind === "research_log"
        ? "Research note"
        : event.replyKind === "final"
          ? "Reply"
          : "Message";
  if (event.eventType === "reply_queued") return `${subject} queued`;
  if (event.eventType === "reply_sent") return `${subject} sent`;
  return `${subject} failed`;
}

function roleIsAvailable(
  role: DiscordChannelRole,
  guild: DiscordGuildReadModel,
  channel: DiscordChannelReadModel,
) {
  if (role === "conversation_monitor") {
    return (
      guild.permissions.viewChannels &&
      guild.permissions.readMessageHistory &&
      guild.permissions.messageContent &&
      channel.canView &&
      channel.canReadHistory
    );
  }
  return (
    guild.permissions.viewChannels &&
    guild.permissions.sendMessages &&
    channel.canView &&
    channel.canSend
  );
}

function roleUnavailableReason(
  role: DiscordChannelRole,
  guild: DiscordGuildReadModel,
  channel: DiscordChannelReadModel,
) {
  if (role === "conversation_monitor") {
    if (!guild.permissions.messageContent) {
      return "Enable the Message Content intent in Discord.";
    }
    if (!guild.permissions.viewChannels || !channel.canView) {
      return "The bot cannot view this channel.";
    }
    return "The bot needs Read Message History permission.";
  }
  if (!guild.permissions.viewChannels || !channel.canView) {
    return "The bot cannot view this channel.";
  }
  return "The bot needs Send Messages permission.";
}

function channelSupportsPurpose(
  purpose: ServerChannelPurpose,
  guild: DiscordGuildReadModel,
  channel: DiscordChannelReadModel,
) {
  if (purpose === "conversation") {
    return (
      roleIsAvailable("conversation_monitor", guild, channel) &&
      roleIsAvailable("reply_target", guild, channel)
    );
  }
  return roleIsAvailable("research_log", guild, channel);
}

function purposeUnavailableReason(
  purpose: ServerChannelPurpose,
  guild: DiscordGuildReadModel,
  channel: DiscordChannelReadModel,
) {
  if (purpose === "conversation") {
    if (!roleIsAvailable("conversation_monitor", guild, channel)) {
      return roleUnavailableReason("conversation_monitor", guild, channel);
    }
    return roleUnavailableReason("reply_target", guild, channel);
  }
  return roleUnavailableReason("research_log", guild, channel);
}

function channelForPurpose(
  purpose: ServerChannelPurpose,
  guild: DiscordGuildReadModel,
) {
  const routedChannelId =
    purpose === "conversation"
      ? guild.routing?.conversationChannelId
      : guild.routing?.researchLogChannelId;
  if (routedChannelId !== undefined) {
    return guild.channels.find(
      (channel) => channel.channelId === routedChannelId,
    );
  }
  if (purpose === "conversation") {
    return guild.channels.find(
      (channel) =>
        channel.roles.includes("conversation_monitor") &&
        channel.roles.includes("reply_target"),
    );
  }
  return guild.channels.find((channel) =>
    channel.roles.includes("research_log"),
  );
}

function PermissionStatus({
  allowed,
  children,
}: {
  allowed: boolean;
  children: string;
}) {
  return (
    <li data-allowed={allowed}>
      <span aria-hidden="true">{allowed ? "✓" : "!"}</span>
      {children}
    </li>
  );
}

function GatewayCard({
  applicationId,
  model,
}: {
  applicationId?: string;
  model: DiscordControlPlaneReadModel;
}) {
  const { gateway } = model;
  return (
    <section
      className="discord-gateway surface"
      aria-labelledby="gateway-title"
    >
      <div className="discord-section-heading">
        <div>
          <p className="section-kicker">Gateway</p>
          <h2 id="gateway-title">Discord connection</h2>
        </div>
        <span className="status-pill" data-status={gateway.status}>
          <span className="status-dot" aria-hidden="true" />
          {gatewayLabels[gateway.status]}
        </span>
      </div>
      {gateway.botUserName && (
        <p className="discord-bot-identity">
          Signed in as <strong>{gateway.botUserName}</strong>
        </p>
      )}
      {gateway.lastHeartbeatAt && (
        <p className="discord-fine-print">
          Last heartbeat {formatAge(gateway.lastHeartbeatAt)}
        </p>
      )}
      {gateway.status === "not_configured" && (
        <div className="discord-callout" role="status">
          <strong>Add the bot token in Railway.</strong>
          <p>
            Set DISCORD_BOT_TOKEN only on the Discord service. The token never
            enters this browser or Convex.
          </p>
        </div>
      )}
      {gateway.status === "offline" && (
        <div className="discord-callout discord-callout--warning" role="alert">
          <strong>The Discord gateway is offline.</strong>
          <p>
            Saved channel assignments remain visible, but no messages will be
            read or sent until the service reconnects.
          </p>
        </div>
      )}
      {gateway.status === "degraded" && (
        <div className="discord-callout discord-callout--warning" role="alert">
          <strong>The Discord gateway needs attention.</strong>
          <p>
            {gateway.error ??
              "Check the bot permissions and the Discord service logs."}
          </p>
        </div>
      )}
      {gateway.status === "online" && gateway.error && (
        <p className="discord-inline-error" role="alert">
          {gateway.error}
        </p>
      )}
      {applicationId && (
        <div className="discord-gateway-actions">
          <a
            className="discord-action-link"
            href={discordInstallUrl(applicationId)}
            target="_blank"
            rel="noreferrer"
          >
            Add to Discord
          </a>
          <p>
            Requests only View Channels, Send Messages, and Read Message
            History.
          </p>
        </div>
      )}
    </section>
  );
}

function ChannelRouteField({
  guild,
  purpose,
  label,
  description,
  selectedChannel,
  otherSelectedChannelId,
  busy,
  onSetPurpose,
}: {
  guild: DiscordGuildReadModel;
  purpose: ServerChannelPurpose;
  label: string;
  description: string;
  selectedChannel: DiscordChannelReadModel | undefined;
  otherSelectedChannelId: string | undefined;
  busy: boolean;
  onSetPurpose: (
    guild: DiscordGuildReadModel,
    purpose: ServerChannelPurpose,
    channelId: string | null,
  ) => Promise<void>;
}) {
  const selectId = `${guild.guildId}-${purpose}-channel`;
  return (
    <label className="discord-route-field" htmlFor={selectId}>
      <span className="discord-route-icon" data-purpose={purpose}>
        {purpose === "conversation" ? "01" : "02"}
      </span>
      <span className="discord-route-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <select
        id={selectId}
        aria-label={label}
        value={selectedChannel?.channelId ?? ""}
        disabled={busy}
        onChange={(event) =>
          void onSetPurpose(guild, purpose, event.target.value || null)
        }
      >
        <option value="">Choose a channel</option>
        {guild.channels.map((channel) => (
          <option
            key={channel.channelId}
            value={channel.channelId}
            disabled={
              (channel.channelId === otherSelectedChannelId &&
                channel.channelId !== selectedChannel?.channelId) ||
              (!channelSupportsPurpose(purpose, guild, channel) &&
                channel.channelId !== selectedChannel?.channelId)
            }
          >
            #{channel.name}
          </option>
        ))}
      </select>
      {selectedChannel &&
        !channelSupportsPurpose(purpose, guild, selectedChannel) && (
          <small className="discord-route-warning">
            {purposeUnavailableReason(purpose, guild, selectedChannel)}
          </small>
        )}
    </label>
  );
}

function MarketResearchSettings({
  guild,
  status,
  onSave,
  onTest,
}: {
  guild: DiscordGuildReadModel;
  status: MarketResearchControlStatusReadModel | undefined;
  onSave: (settings: SaveMarketResearchControlSettings) => Promise<void>;
  onTest: (guildId: string, requestId: string) => Promise<void>;
}) {
  const preferences = status?.preferences;
  const [forumChannelId, setForumChannelId] = useState(
    preferences?.forumChannelId ?? "",
  );
  const [forumTagId, setForumTagId] = useState(
    preferences?.forumTagIds[0] ?? "",
  );
  const [timezone, setTimezone] = useState(
    preferences?.timezone ?? "America/New_York",
  );
  const [timezoneConfirmed, setTimezoneConfirmed] = useState(
    preferences?.timezoneConfirmed ?? false,
  );
  const [localTime, setLocalTime] = useState(
    `${String(preferences?.localHour ?? 8).padStart(2, "0")}:${String(preferences?.localMinute ?? 0).padStart(2, "0")}`,
  );
  const [includeWeekends, setIncludeWeekends] = useState(
    preferences?.includeWeekends ?? true,
  );
  const [savedOverride, setSavedOverride] = useState<{
    revision: number | undefined;
    settings: SaveMarketResearchControlSettings;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const forums = guild.channels.filter((channel) => channel.type === "forum");
  const selectedForum = forums.find(
    (channel) => channel.channelId === forumChannelId,
  );
  const validTags = (selectedForum?.availableTags ?? []).filter(
    (tag) => !tag.moderated,
  );
  const forumReady =
    selectedForum !== undefined &&
    selectedForum.canView &&
    selectedForum.canCreateForumPost &&
    selectedForum.canSendInThreads &&
    selectedForum.canReadThreadHistory &&
    (!selectedForum.requiresTag ||
      validTags.some((tag) => tag.id === forumTagId));
  const scheduleReady =
    forumReady &&
    timezoneConfirmed &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime);

  function controlSettings(
    scheduleEnabled: boolean,
  ): SaveMarketResearchControlSettings {
    const [hourText, minuteText] = localTime.split(":");
    const settings: SaveMarketResearchControlSettings = {
      guildId: guild.guildId,
      forumChannelId: forumChannelId || null,
      forumTagIds: forumTagId ? [forumTagId] : [],
      timezone,
      timezoneConfirmed,
      localHour: Number(hourText),
      localMinute: Number(minuteText),
      includeWeekends,
      editionDepth: "full",
      maximumRankedSetups: 10,
      enabled: scheduleEnabled,
      includeCharts: true,
      maximumCharts: 3,
    };
    return settings;
  }

  const savedSettings =
    savedOverride && savedOverride.revision === preferences?.revision
      ? savedOverride.settings
      : preferences;
  const scheduled =
    savedSettings?.enabled === true &&
    newspaperSettingsKey(savedSettings) ===
      newspaperSettingsKey(controlSettings(true));

  async function persist(scheduleEnabled: boolean) {
    const settings = controlSettings(scheduleEnabled);
    await onSave(settings);
    setSavedOverride({ revision: preferences?.revision, settings });
  }

  async function save(action: "save" | "schedule") {
    setBusy(true);
    setMessage(null);
    try {
      await persist(action === "schedule" || scheduled);
      setMessage(
        action === "schedule"
          ? "Newspaper scheduled."
          : scheduled
            ? "Settings saved. Schedule unchanged."
            : "Settings saved. Click Schedule now to apply the schedule.",
      );
    } catch (error) {
      setMessage(newspaperActionError(action, error));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setMessage(null);
    let settingsSaved = false;
    try {
      const requestId = newspaperTestRequestId(controlSettings(scheduled));
      await persist(scheduled);
      settingsSaved = true;
      await onTest(guild.guildId, requestId);
      acknowledgeNewspaperTest(guild.guildId, requestId);
      setMessage(
        "Test queued. Research will post in the selected forum. The scheduled edition is separate.",
      );
    } catch (error) {
      setMessage(
        newspaperActionError(settingsSaved ? "test" : "test_save", error),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="discord-newspaper"
      aria-labelledby={`newspaper-${guild.guildId}`}
    >
      <div className="discord-section-heading">
        <div>
          <p className="section-kicker">03 · Scheduled research</p>
          <h3 id={`newspaper-${guild.guildId}`}>Morning newspaper</h3>
        </div>
        <span
          className="status-pill"
          data-status={scheduled ? "online" : "offline"}
        >
          {scheduled
            ? "Scheduled"
            : savedSettings?.enabled
              ? "Changes pending"
              : "Not scheduled"}
        </span>
      </div>
      <p>
        Full research from your usual watchlist, with up to 10 qualified ranked
        setups. Charts accompany positive ranked setups only.
      </p>
      <div className="discord-newspaper-grid">
        <label>
          <span>Forum</span>
          <select
            aria-label="Morning newspaper forum"
            value={forumChannelId}
            disabled={busy}
            onChange={(event) => {
              setForumChannelId(event.target.value);
              setForumTagId("");
              setMessage(null);
            }}
          >
            <option value="">Choose a forum</option>
            {forums.map((channel) => (
              <option
                key={channel.channelId}
                value={channel.channelId}
                disabled={
                  !channel.canView ||
                  !channel.canCreateForumPost ||
                  !channel.canSendInThreads ||
                  !channel.canReadThreadHistory
                }
              >
                #{channel.name}
              </option>
            ))}
          </select>
        </label>
        {selectedForum &&
          (selectedForum.requiresTag || validTags.length > 0) && (
            <label>
              <span>Forum tag</span>
              <select
                aria-label="Morning newspaper tag"
                value={forumTagId}
                disabled={busy}
                onChange={(event) => {
                  setForumTagId(event.target.value);
                  setMessage(null);
                }}
              >
                <option value="">Choose a tag</option>
                {validTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.emoji ? `${tag.emoji} ` : ""}
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        <label>
          <span>Timezone</span>
          <select
            aria-label="Schedule timezone"
            value={timezoneConfirmed ? timezone : ""}
            disabled={busy}
            onChange={(event) => {
              if (event.target.value === "") return;
              setTimezone(event.target.value);
              setTimezoneConfirmed(true);
              setMessage(null);
            }}
          >
            <option value="" disabled>
              Choose a timezone
            </option>
            <option value="America/New_York">America/New_York</option>
            <option value="America/Puerto_Rico">America/Puerto_Rico</option>
            {timezone !== "America/New_York" &&
              timezone !== "America/Puerto_Rico" && (
                <option value={timezone}>{timezone}</option>
              )}
          </select>
        </label>
        <label>
          <span>Publish time</span>
          <input
            aria-label="Local publish time"
            type="time"
            value={localTime}
            disabled={busy}
            onChange={(event) => {
              setLocalTime(event.target.value);
              setMessage(null);
            }}
          />
        </label>
      </div>
      <div className="discord-newspaper-checks">
        <label>
          <input
            type="checkbox"
            checked={includeWeekends}
            disabled={busy}
            onChange={(event) => {
              setIncludeWeekends(event.target.checked);
              setMessage(null);
            }}
          />
          Include weekend outlooks
        </label>
      </div>
      {selectedForum && !selectedForum.canAttachFiles && (
        <p className="discord-fine-print">
          This forum cannot receive chart attachments. Research will still post
          as text.
        </p>
      )}
      {selectedForum && !forumReady && (
        <p className="discord-route-warning">
          This forum is missing a required permission or valid required tag.
        </p>
      )}
      <div className="discord-gateway-actions">
        <button
          className="discord-settings-save"
          type="button"
          aria-label="Save morning newspaper"
          disabled={busy}
          onClick={() => void save("save")}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy || !scheduleReady}
          onClick={() => void runTest()}
        >
          Test now
        </button>
        <button
          type="button"
          disabled={busy || !scheduleReady || scheduled}
          onClick={() => void save("schedule")}
        >
          {scheduled ? "Scheduled" : "Schedule now"}
        </button>
      </div>
      <p className="discord-fine-print">
        Test now saves these settings and posts a separate edition. Schedule now
        applies them to future editions at the selected time.
      </p>
      {status?.preview && !status.current && (
        <details className="discord-fine-print" open>
          <summary>Latest preview: {status.preview.status}</summary>
          <p>{status.preview.previewId}</p>
          {status.preview.safeFailure && (
            <p>{newspaperFailureMessage(status.preview.safeFailure)}</p>
          )}
          {newspaperPreviewSummary(
            status.preview.qualitySummary,
            status.preview.safeFailure,
          ).map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </details>
      )}
      {status?.current && (
        <p className="discord-fine-print">
          Latest: {status.current.editionDate} · {status.current.status} ·{" "}
          {status.current.acceptedSourceCount}/{status.current.sourceCount}{" "}
          accepted sources
          {status.current.forumUrl && (
            <>
              {" "}
              ·{" "}
              <a
                href={status.current.forumUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open forum thread
              </a>
            </>
          )}
          {status.current.lastErrorCode && (
            <> · {newspaperFailureMessage(status.current.lastErrorCode)}</>
          )}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function GuildCard({
  guild,
  busyPurpose,
  onSetPurpose,
  marketResearch,
  onSaveMarketResearch,
  onTestMarketResearch,
}: {
  guild: DiscordGuildReadModel;
  busyPurpose: ServerChannelPurpose | null;
  onSetPurpose: (
    guild: DiscordGuildReadModel,
    purpose: ServerChannelPurpose,
    channelId: string | null,
  ) => Promise<void>;
  marketResearch: MarketResearchControlStatusReadModel | undefined;
  onSaveMarketResearch: (
    settings: SaveMarketResearchControlSettings,
  ) => Promise<void>;
  onTestMarketResearch: (guildId: string, requestId: string) => Promise<void>;
}) {
  const conversationChannel = channelForPurpose("conversation", guild);
  const researchChannel = channelForPurpose("research", guild);
  const loop = conversationChannel?.loop;

  return (
    <article
      className="discord-guild surface"
      aria-labelledby={`guild-${guild.guildId}`}
    >
      <div className="discord-guild-header">
        <div className="discord-guild-heading">
          <span className="discord-guild-mark" aria-hidden="true">
            {guild.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="section-kicker">Server routing</p>
            <h2 id={`guild-${guild.guildId}`}>{guild.name}</h2>
          </div>
        </div>
        {loop && (
          <span className="loop-pill" data-status={loop.status}>
            {loopLabels[loop.status]}
          </span>
        )}
      </div>
      <p className="discord-guild-description">
        Keep conversation in one place. Send detailed research progress to a
        separate log.
      </p>
      <ul className="discord-permissions" aria-label="Bot permissions">
        <PermissionStatus allowed={guild.permissions.viewChannels}>
          View channels
        </PermissionStatus>
        <PermissionStatus allowed={guild.permissions.sendMessages}>
          Send messages
        </PermissionStatus>
        <PermissionStatus allowed={guild.permissions.readMessageHistory}>
          Read history
        </PermissionStatus>
        <PermissionStatus allowed={guild.permissions.messageContent}>
          Message content intent
        </PermissionStatus>
      </ul>
      {guild.channels.length === 0 ? (
        <div className="discord-empty discord-empty--nested">
          <strong>No usable text channels found.</strong>
          <p>Give the bot permission to view at least one Discord channel.</p>
        </div>
      ) : (
        <div className="discord-route-list" aria-label="Channel routing">
          <ChannelRouteField
            guild={guild}
            purpose="conversation"
            label="Conversation channel"
            description="Trishula reads, acknowledges, and replies here."
            selectedChannel={conversationChannel}
            otherSelectedChannelId={researchChannel?.channelId}
            busy={busyPurpose !== null}
            onSetPurpose={onSetPurpose}
          />
          <ChannelRouteField
            guild={guild}
            purpose="research"
            label="Research log channel"
            description="Long-running research progress stays out of the conversation."
            selectedChannel={researchChannel}
            otherSelectedChannelId={conversationChannel?.channelId}
            busy={busyPurpose !== null}
            onSetPurpose={onSetPurpose}
          />
        </div>
      )}
      <p className="discord-memory-note">
        Changing the conversation channel keeps this server&apos;s Trishula
        memory and current epoch.
      </p>
      {loop && (
        <div className="loop-summary" aria-label="Agent loop status">
          <strong>{loopLabels[loop.status]}</strong>
          <span>
            {loop.pendingMessageCount === 0
              ? "No messages waiting"
              : `${loop.pendingMessageCount} message${loop.pendingMessageCount === 1 ? "" : "s"} waiting`}
          </span>
          {loop.lastProcessedAt && (
            <span>Last reply {formatAge(loop.lastProcessedAt)}</span>
          )}
          {loop.error && (
            <span className="discord-inline-error">{loop.error}</span>
          )}
        </div>
      )}
      {busyPurpose && (
        <p className="channel-save-status" role="status">
          Saving {busyPurpose === "conversation" ? "conversation" : "research"}
          channel…
        </p>
      )}
      <MarketResearchSettings
        guild={guild}
        status={marketResearch}
        onSave={onSaveMarketResearch}
        onTest={onTestMarketResearch}
      />
    </article>
  );
}

function modelProfileLabel({
  model,
  reasoningEffort,
  serviceTier,
}: {
  model: string;
  reasoningEffort: string;
  serviceTier: string;
}) {
  return `${model} · ${reasoningEffort} · ${serviceTier}`;
}

function resetConfirmationText(guildName: string) {
  return `Reset Trishula memory for ${guildName}`;
}

function privacyDeletionConfirmationText(guildName: string) {
  return `Delete retained Trishula data for ${guildName}`;
}

function ConversationResetControl({
  guild,
  onResetGuildConversation,
}: {
  guild: DiscordGuildReadModel;
  onResetGuildConversation: (
    guildId: string,
  ) => Promise<DiscordConversationResetReadModel>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetEpoch, setResetEpoch] = useState<number | null>(null);
  const requiredConfirmation = resetConfirmationText(guild.name);

  async function resetMemory() {
    if (confirmation !== requiredConfirmation) return;

    setResetting(true);
    setResetError(null);
    setResetEpoch(null);
    try {
      const result = await onResetGuildConversation(guild.guildId);
      setResetEpoch(result.epoch);
      setConfirmation("");
      setConfirming(false);
    } catch {
      setResetError("Trishula memory could not be reset. Try again.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="discord-reset-panel">
      <div>
        <p className="section-kicker">Owner control</p>
        <h3>Reset Trishula memory for this server</h3>
        <p>
          Reset starts a clean epoch for {guild.name}. It cancels active work
          and makes prior Trishula context unavailable. It does not delete
          Discord messages or audit records.
        </p>
      </div>
      {!confirming ? (
        <button
          className="discord-reset-action"
          type="button"
          aria-expanded="false"
          onClick={() => {
            setConfirming(true);
            setResetError(null);
            setResetEpoch(null);
          }}
        >
          Reset server memory
        </button>
      ) : (
        <form
          className="discord-reset-confirmation"
          onSubmit={(event) => {
            event.preventDefault();
            void resetMemory();
          }}
        >
          <label htmlFor={`reset-confirmation-${guild.guildId}`}>
            <span>
              Type <strong>{requiredConfirmation}</strong> to confirm the server
              and effect.
            </span>
            <input
              id={`reset-confirmation-${guild.guildId}`}
              aria-label="Reset confirmation"
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              disabled={resetting}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <div className="discord-reset-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={resetting}
              onClick={() => {
                setConfirming(false);
                setConfirmation("");
                setResetError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="discord-reset-action"
              type="submit"
              disabled={resetting || confirmation !== requiredConfirmation}
            >
              {resetting ? "Resetting…" : "Start clean epoch"}
            </button>
          </div>
        </form>
      )}
      {resetError && (
        <p className="discord-inline-error" role="alert">
          {resetError}
        </p>
      )}
      {resetEpoch !== null && (
        <p className="discord-reset-success" role="status">
          Trishula memory was reset for {guild.name}. Epoch {resetEpoch} is
          active.
        </p>
      )}
    </div>
  );
}

function ConversationPrivacyControl({
  guild,
  onDeleteGuildConversationPrivacyData,
}: {
  guild: DiscordGuildReadModel;
  onDeleteGuildConversationPrivacyData: (
    guildId: string,
  ) => Promise<DiscordConversationPrivacyDeletionReadModel>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deletedRecords, setDeletedRecords] = useState<number | null>(null);
  const requiredConfirmation = privacyDeletionConfirmationText(guild.name);

  async function deletePrivacyData() {
    if (confirmation !== requiredConfirmation) return;

    setDeleting(true);
    setDeletionError(null);
    setDeletedRecords(null);
    try {
      const result = await onDeleteGuildConversationPrivacyData(guild.guildId);
      setDeletedRecords(result.deletedRecords);
      setConfirmation("");
      setConfirming(false);
    } catch {
      setDeletionError(
        "Retained Trishula data could not be deleted. Try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="discord-reset-panel discord-privacy-panel">
      <div>
        <p className="section-kicker">Privacy control</p>
        <h3>Delete retained Trishula data for this server</h3>
        <p>
          This fences active work and deletes retained source messages,
          canonical history, research artifacts, checkpoints, outbox content,
          and derived indexes for {guild.name}. It does not delete messages from
          Discord. This action cannot be undone.
        </p>
      </div>
      {!confirming ? (
        <button
          className="discord-reset-action discord-delete-action"
          type="button"
          aria-expanded="false"
          onClick={() => {
            setConfirming(true);
            setDeletionError(null);
            setDeletedRecords(null);
          }}
        >
          Delete retained data
        </button>
      ) : (
        <form
          className="discord-reset-confirmation"
          onSubmit={(event) => {
            event.preventDefault();
            void deletePrivacyData();
          }}
        >
          <label htmlFor={`privacy-confirmation-${guild.guildId}`}>
            <span>
              Type <strong>{requiredConfirmation}</strong> to confirm the server
              and permanent deletion.
            </span>
            <input
              id={`privacy-confirmation-${guild.guildId}`}
              aria-label="Privacy deletion confirmation"
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              disabled={deleting}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <div className="discord-reset-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={deleting}
              onClick={() => {
                setConfirming(false);
                setConfirmation("");
                setDeletionError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="discord-reset-action discord-delete-action"
              type="submit"
              disabled={deleting || confirmation !== requiredConfirmation}
            >
              {deleting ? "Deleting…" : "Delete retained data"}
            </button>
          </div>
        </form>
      )}
      {deletionError && (
        <p className="discord-inline-error" role="alert">
          {deletionError}
        </p>
      )}
      {deletedRecords !== null && (
        <p className="discord-reset-success" role="status">
          Retained Trishula data was deleted for {guild.name}. Removed{" "}
          {deletedRecords} records.
        </p>
      )}
    </div>
  );
}

function ConversationStatusCard({
  guild,
  onResetGuildConversation,
  onDeleteGuildConversationPrivacyData,
}: {
  guild: DiscordGuildReadModel;
  onResetGuildConversation: (
    guildId: string,
  ) => Promise<DiscordConversationResetReadModel>;
  onDeleteGuildConversationPrivacyData?: (
    guildId: string,
  ) => Promise<DiscordConversationPrivacyDeletionReadModel>;
}) {
  const conversation = guild.conversation;

  return (
    <section
      className="discord-conversation-status surface"
      aria-labelledby={`conversation-status-${guild.guildId}`}
    >
      <div className="discord-section-heading">
        <div>
          <p className="section-kicker">Server memory</p>
          <h2 id={`conversation-status-${guild.guildId}`}>
            Conversation status
          </h2>
        </div>
        {conversation && (
          <span className="loop-pill">Epoch {conversation.epoch}</span>
        )}
      </div>
      {conversation === undefined ? (
        <p className="discord-conversation-empty">
          Conversation status will appear after Trishula initializes this
          server&apos;s durable memory.
        </p>
      ) : (
        <>
          <dl className="discord-conversation-facts">
            <div>
              <dt>Epoch</dt>
              <dd>{conversation.epoch}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{conversation.revision}</dd>
            </div>
            <div>
              <dt>Human revision</dt>
              <dd>{conversation.humanRevision}</dd>
            </div>
            <div>
              <dt>Personality</dt>
              <dd>{conversation.personalityVersion}</dd>
            </div>
            <div>
              <dt>Last successful activity</dt>
              <dd>
                {conversation.lastSuccessfulActivityAt === undefined
                  ? "No successful activity yet"
                  : formatAge(conversation.lastSuccessfulActivityAt)}
              </dd>
            </div>
          </dl>
          <div className="discord-model-profiles" aria-label="Model profiles">
            <div>
              <span>Luna frontman</span>
              <code>{modelProfileLabel(conversation.models.luna)}</code>
            </div>
            <div>
              <span>Sol research</span>
              <code>{modelProfileLabel(conversation.models.sol)}</code>
            </div>
          </div>
          <ConversationResetControl
            guild={guild}
            onResetGuildConversation={onResetGuildConversation}
          />
          {onDeleteGuildConversationPrivacyData !== undefined && (
            <ConversationPrivacyControl
              guild={guild}
              onDeleteGuildConversationPrivacyData={
                onDeleteGuildConversationPrivacyData
              }
            />
          )}
        </>
      )}
    </section>
  );
}

function ActivityFeed({
  guild,
  events,
}: {
  guild: DiscordGuildReadModel;
  events: DiscordActivityReadModel[];
}) {
  return (
    <section
      className="discord-activity surface"
      aria-labelledby="activity-title"
    >
      <div className="discord-section-heading">
        <div>
          <p className="section-kicker">Live</p>
          <h2 id="activity-title">Agent activity</h2>
        </div>
        <span className="discord-live-indicator">
          <span aria-hidden="true" />
          Updating
        </span>
      </div>
      {events.length === 0 ? (
        <p className="discord-activity-empty">
          No activity yet. New monitored messages will appear here.
        </p>
      ) : (
        <ol className="discord-activity-list" aria-live="polite">
          {events.map((event) => {
            const channel = guild.channels.find(
              (candidate) => candidate.channelId === event.channelId,
            );
            return (
              <li key={event.eventId} data-event={event.eventType}>
                <span className="discord-activity-dot" aria-hidden="true" />
                <div>
                  <strong>{activityLabel(event)}</strong>
                  <span>
                    {channel ? `#${channel.name}` : "Discord channel"}
                  </span>
                </div>
                <time dateTime={new Date(event.createdAt).toISOString()}>
                  {formatAge(event.createdAt)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function DiscordControlView({
  applicationId,
  model,
  onSetGuildRouting,
  onResetGuildConversation,
  onDeleteGuildConversationPrivacyData,
  marketResearch = [],
  onSaveMarketResearch = async () => undefined,
  onTestMarketResearch = async () => undefined,
}: {
  applicationId?: string;
  model: DiscordControlPlaneReadModel;
  onSetGuildRouting: (
    guildId: string,
    conversationChannelId: string | null,
    researchLogChannelId: string | null,
  ) => Promise<void>;
  onResetGuildConversation: (
    guildId: string,
  ) => Promise<DiscordConversationResetReadModel>;
  onDeleteGuildConversationPrivacyData?: (
    guildId: string,
  ) => Promise<DiscordConversationPrivacyDeletionReadModel>;
  marketResearch?: MarketResearchControlStatusReadModel[];
  onSaveMarketResearch?: (
    settings: SaveMarketResearchControlSettings,
  ) => Promise<void>;
  onTestMarketResearch?: (guildId: string, requestId: string) => Promise<void>;
}) {
  const [busyPurpose, setBusyPurpose] = useState<ServerChannelPurpose | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const selectedGuild =
    model.guilds.find((guild) => guild.guildId === selectedGuildId) ??
    model.guilds[0];
  const selectedActivity = selectedGuild
    ? (model.activity ?? []).filter(
        (event) => event.guildId === selectedGuild.guildId,
      )
    : [];

  async function setPurpose(
    guild: DiscordGuildReadModel,
    purpose: ServerChannelPurpose,
    channelId: string | null,
  ) {
    setBusyPurpose(purpose);
    setError(null);
    try {
      const conversationChannelId =
        purpose === "conversation"
          ? channelId
          : (channelForPurpose("conversation", guild)?.channelId ?? null);
      const researchLogChannelId =
        purpose === "research"
          ? channelId
          : (channelForPurpose("research", guild)?.channelId ?? null);
      if (
        conversationChannelId !== null &&
        conversationChannelId === researchLogChannelId
      ) {
        setError("Conversation and research log channels must be different.");
        return;
      }
      await onSetGuildRouting(
        guild.guildId,
        conversationChannelId,
        researchLogChannelId,
      );
    } catch {
      setError("Server routing could not be saved. Try again.");
    } finally {
      setBusyPurpose(null);
    }
  }

  return (
    <main className="discord-page" data-layout="phone-first">
      <header className="discord-page-heading">
        <div>
          <p className="page-kicker">Discord</p>
          <h1>Server routing</h1>
          <p>
            Manage each server&apos;s conversation channel, quiet research log,
            and durable Trishula memory.
          </p>
        </div>
      </header>
      {error && (
        <div className="discord-page-error" role="alert">
          {error}
        </div>
      )}
      <GatewayCard applicationId={applicationId} model={model} />
      {model.guilds.length === 0 ? (
        <section
          className="discord-empty surface"
          aria-labelledby="no-guild-title"
        >
          <strong id="no-guild-title">No Discord servers available.</strong>
          <p>
            Invite the configured bot to a server. The channel list appears
            after the gateway connects.
          </p>
        </section>
      ) : (
        <section
          className="discord-server-settings"
          aria-labelledby="server-settings-title"
        >
          <div className="discord-server-picker surface">
            <label htmlFor="discord-server">
              <span>Server</span>
              <select
                id="discord-server"
                value={selectedGuild?.guildId}
                onChange={(event) => setSelectedGuildId(event.target.value)}
              >
                {model.guilds.map((guild) => (
                  <option key={guild.guildId} value={guild.guildId}>
                    {guild.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {model.guilds.length} installed server
              {model.guilds.length === 1 ? "" : "s"}
            </p>
          </div>
          <h2 className="sr-only" id="server-settings-title">
            Per-server channel settings
          </h2>
          {selectedGuild && (
            <>
              <GuildCard
                key={selectedGuild.guildId}
                guild={selectedGuild}
                busyPurpose={busyPurpose}
                onSetPurpose={setPurpose}
                marketResearch={marketResearch.find(
                  (status) => status.guildId === selectedGuild.guildId,
                )}
                onSaveMarketResearch={onSaveMarketResearch}
                onTestMarketResearch={onTestMarketResearch}
              />
              <ConversationStatusCard
                key={`${selectedGuild.guildId}-conversation`}
                guild={selectedGuild}
                onResetGuildConversation={onResetGuildConversation}
                onDeleteGuildConversationPrivacyData={
                  onDeleteGuildConversationPrivacyData
                }
              />
              <ActivityFeed guild={selectedGuild} events={selectedActivity} />
            </>
          )}
        </section>
      )}
    </main>
  );
}

export function DiscordControlPageContent({
  model,
  marketResearch,
  ...viewProps
}: Omit<
  ComponentProps<typeof DiscordControlView>,
  "model" | "marketResearch"
> & {
  model: DiscordControlPlaneReadModel | undefined;
  marketResearch: MarketResearchControlStatusReadModel[] | undefined;
}) {
  if (model === undefined || marketResearch === undefined) {
    return (
      <main className="discord-page">
        <div className="loading" role="status">
          <span aria-hidden="true" />
          Loading Discord control…
        </div>
      </main>
    );
  }

  return (
    <DiscordControlView
      {...viewProps}
      model={model}
      marketResearch={marketResearch}
    />
  );
}

export function DiscordControlPage({
  applicationId,
}: {
  applicationId?: string;
}) {
  const model = useQuery(publicApi.discord.getControlPlane, {});
  const marketResearch = useQuery(
    publicApi.marketResearch.getControlStatuses,
    {},
  );
  const setGuildRouting = useMutation(publicApi.discord.setGuildRouting);
  const resetGuildConversation = useMutation(
    publicApi.discord.resetGuildConversation,
  );
  const deleteGuildConversationPrivacyData = useMutation(
    publicApi.discord.deleteGuildConversationPrivacyData,
  );
  const saveMarketResearch = useMutation(
    publicApi.marketResearch.saveControlSettings,
  );
  const manualMarketResearch = useMutation(
    publicApi.marketResearch.manualTrigger,
  );

  return (
    <DiscordControlPageContent
      applicationId={applicationId}
      model={model}
      marketResearch={marketResearch}
      onSetGuildRouting={(
        guildId,
        conversationChannelId,
        researchLogChannelId,
      ) =>
        setGuildRouting({
          guildId,
          conversationChannelId,
          researchLogChannelId,
        }).then(() => undefined)
      }
      onResetGuildConversation={(guildId) =>
        resetGuildConversation({ guildId, confirmGuildId: guildId })
      }
      onDeleteGuildConversationPrivacyData={(guildId) =>
        deleteGuildConversationPrivacyData({ guildId, confirmGuildId: guildId })
      }
      onSaveMarketResearch={(settings) =>
        saveMarketResearch(settings).then(() => undefined)
      }
      onTestMarketResearch={(guildId, requestId) =>
        manualMarketResearch({
          guildId,
          dryRun: false,
          publish: true,
          regeneratePublishedEdition: false,
          requestId,
        }).then(() => undefined)
      }
    />
  );
}
