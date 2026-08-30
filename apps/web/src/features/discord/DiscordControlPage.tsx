import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { publicApi } from "../../convex/functions";
import type {
  DiscordChannelReadModel,
  DiscordChannelRole,
  DiscordControlPlaneReadModel,
  DiscordGatewayStatus,
  DiscordGuildReadModel,
  DiscordLoopStatus,
} from "../../convex/types";
import { formatAge } from "../../shared/formatting/values";

const channelRoles: ReadonlyArray<{
  role: DiscordChannelRole;
  label: string;
  description: string;
}> = [
  {
    role: "conversation_monitor",
    label: "Conversation monitor",
    description: "Read new messages and decide when research can help.",
  },
  {
    role: "reply_target",
    label: "Reply target",
    description: "Post the concise final response in this channel.",
  },
  {
    role: "research_log",
    label: "Research log",
    description: "Post research-loop status without interrupting the chat.",
  },
];

const roleOrder = new Map(
  channelRoles.map(({ role }, index) => [role, index] as const),
);

const gatewayLabels = {
  online: "Connected",
  offline: "Disconnected",
  degraded: "Needs attention",
  not_configured: "Not configured",
} satisfies Record<DiscordGatewayStatus, string>;

const loopLabels = {
  idle: "Ready",
  triaging: "Reviewing chat",
  researching: "Researching",
  drafting: "Writing reply",
  catching_up: "Catching up",
  error: "Loop error",
} satisfies Record<DiscordLoopStatus, string>;

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

function GatewayCard({ model }: { model: DiscordControlPlaneReadModel }) {
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
          <strong>Add the Discord credentials in Railway.</strong>
          <p>
            Configure the bot token and application details on the Discord
            service. Secrets never enter this browser or Convex.
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
    </section>
  );
}

function ChannelCard({
  guild,
  channel,
  busy,
  onSetRoles,
}: {
  guild: DiscordGuildReadModel;
  channel: DiscordChannelReadModel;
  busy: boolean;
  onSetRoles: (
    guildId: string,
    channelId: string,
    roles: DiscordChannelRole[],
  ) => Promise<void>;
}) {
  const selectedRoles = new Set(channel.roles);
  const loop = channel.loop;

  function toggle(role: DiscordChannelRole, checked: boolean) {
    const next = new Set(channel.roles);
    if (checked) next.add(role);
    else next.delete(role);
    const roles = [...next].sort(
      (left, right) => (roleOrder.get(left) ?? 0) - (roleOrder.get(right) ?? 0),
    );
    return onSetRoles(guild.guildId, channel.channelId, roles);
  }

  return (
    <li className="discord-channel-card surface">
      <div className="discord-channel-heading">
        <div>
          <div className="discord-channel-name">
            <span aria-hidden="true">#</span>
            <h3>{channel.name}</h3>
          </div>
          <p>{channel.type} channel</p>
        </div>
        {loop && (
          <span className="loop-pill" data-status={loop.status}>
            {loopLabels[loop.status]}
          </span>
        )}
      </div>
      {loop && (
        <div className="loop-summary" aria-label="Agent loop status">
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
      <fieldset className="channel-role-list" disabled={busy}>
        <legend>Use this channel for</legend>
        {channelRoles.map(({ role, label, description }) => {
          const checked = selectedRoles.has(role);
          const available = roleIsAvailable(role, guild, channel);
          const disabled = busy || (!available && !checked);
          return (
            <label key={role} data-disabled={disabled}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => void toggle(role, event.target.checked)}
              />
              <span className="role-check" aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>
                  {available
                    ? description
                    : roleUnavailableReason(role, guild, channel)}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>
      {busy && (
        <p className="channel-save-status" role="status">
          Saving channel roles…
        </p>
      )}
    </li>
  );
}

function GuildCard({
  guild,
  busyChannel,
  onSetRoles,
}: {
  guild: DiscordGuildReadModel;
  busyChannel: string | null;
  onSetRoles: (
    guildId: string,
    channelId: string,
    roles: DiscordChannelRole[],
  ) => Promise<void>;
}) {
  return (
    <article
      className="discord-guild"
      aria-labelledby={`guild-${guild.guildId}`}
    >
      <div className="discord-guild-heading">
        <span className="discord-guild-mark" aria-hidden="true">
          {guild.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="section-kicker">Server</p>
          <h2 id={`guild-${guild.guildId}`}>{guild.name}</h2>
        </div>
      </div>
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
        <div className="discord-empty surface">
          <strong>No usable text channels found.</strong>
          <p>Give the bot permission to view at least one Discord channel.</p>
        </div>
      ) : (
        <ul
          className="discord-channel-list"
          aria-label={`${guild.name} channels`}
        >
          {guild.channels.map((channel) => (
            <ChannelCard
              key={channel.channelId}
              guild={guild}
              channel={channel}
              busy={busyChannel === `${guild.guildId}:${channel.channelId}`}
              onSetRoles={onSetRoles}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

export function DiscordControlView({
  model,
  onSetChannelRoles,
}: {
  model: DiscordControlPlaneReadModel;
  onSetChannelRoles: (
    guildId: string,
    channelId: string,
    roles: DiscordChannelRole[],
  ) => Promise<void>;
}) {
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setRoles(
    guildId: string,
    channelId: string,
    roles: DiscordChannelRole[],
  ) {
    const key = `${guildId}:${channelId}`;
    setBusyChannel(key);
    setError(null);
    try {
      await onSetChannelRoles(guildId, channelId, roles);
    } catch {
      setError("Channel roles could not be saved. Try again.");
    } finally {
      setBusyChannel(null);
    }
  }

  return (
    <main className="discord-page" data-layout="phone-first">
      <header className="discord-page-heading">
        <div>
          <p className="page-kicker">Discord</p>
          <h1>Channel control</h1>
          <p>
            Choose where Trishula listens, replies, and records research work.
          </p>
        </div>
      </header>
      {error && (
        <div className="discord-page-error" role="alert">
          {error}
        </div>
      )}
      <GatewayCard model={model} />
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
        <div className="discord-guild-list">
          {model.guilds.map((guild) => (
            <GuildCard
              key={guild.guildId}
              guild={guild}
              busyChannel={busyChannel}
              onSetRoles={setRoles}
            />
          ))}
        </div>
      )}
    </main>
  );
}

export function DiscordControlPage() {
  const model = useQuery(publicApi.discord.getControlPlane, {});
  const setChannelRoles = useMutation(publicApi.discord.setChannelRoles);

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
      model={model}
      onSetChannelRoles={(guildId, channelId, roles) =>
        setChannelRoles({ guildId, channelId, roles }).then(() => undefined)
      }
    />
  );
}
