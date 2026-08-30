import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { publicApi } from "../../convex/functions";
import type {
  DiscordActivityReadModel,
  DiscordChannelReadModel,
  DiscordChannelRole,
  DiscordControlPlaneReadModel,
  DiscordGatewayStatus,
  DiscordGuildReadModel,
  DiscordLoopStatus,
} from "../../convex/types";
import { formatAge } from "../../shared/formatting/values";
import { discordInstallUrl } from "./discordInstall";

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
  busy,
  onSetPurpose,
}: {
  guild: DiscordGuildReadModel;
  purpose: ServerChannelPurpose;
  label: string;
  description: string;
  selectedChannel: DiscordChannelReadModel | undefined;
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
              !channelSupportsPurpose(purpose, guild, channel) &&
              channel.channelId !== selectedChannel?.channelId
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

function GuildCard({
  guild,
  busyPurpose,
  onSetPurpose,
}: {
  guild: DiscordGuildReadModel;
  busyPurpose: ServerChannelPurpose | null;
  onSetPurpose: (
    guild: DiscordGuildReadModel,
    purpose: ServerChannelPurpose,
    channelId: string | null,
  ) => Promise<void>;
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
            busy={busyPurpose !== null}
            onSetPurpose={onSetPurpose}
          />
          <ChannelRouteField
            guild={guild}
            purpose="research"
            label="Research log channel"
            description="Long-running research progress stays out of the conversation."
            selectedChannel={researchChannel}
            busy={busyPurpose !== null}
            onSetPurpose={onSetPurpose}
          />
        </div>
      )}
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
    </article>
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
}: {
  applicationId?: string;
  model: DiscordControlPlaneReadModel;
  onSetGuildRouting: (
    guildId: string,
    conversationChannelId: string | null,
    researchLogChannelId: string | null,
  ) => Promise<void>;
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
            Give each server one conversation channel and one quiet research
            log.
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
              />
              <ActivityFeed guild={selectedGuild} events={selectedActivity} />
            </>
          )}
        </section>
      )}
    </main>
  );
}

export function DiscordControlPage({
  applicationId,
}: {
  applicationId?: string;
}) {
  const model = useQuery(publicApi.discord.getControlPlane, {});
  const setGuildRouting = useMutation(publicApi.discord.setGuildRouting);

  if (model === undefined) {
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
      applicationId={applicationId}
      model={model}
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
    />
  );
}
