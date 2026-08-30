import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordControlPlaneReadModel } from "../../convex/types";
import { DiscordControlView } from "./DiscordControlPage";
import { discordInstallUrl } from "./discordInstall";

function controlPlane(
  overrides: Partial<DiscordControlPlaneReadModel> = {},
): DiscordControlPlaneReadModel {
  return {
    gateway: {
      status: "online",
      botUserName: "Trishula#2048",
      lastHeartbeatAt: Date.now(),
    },
    activity: [],
    guilds: [
      {
        guildId: "guild_1",
        name: "Market Desk",
        permissions: {
          viewChannels: true,
          sendMessages: true,
          readMessageHistory: true,
          messageContent: true,
        },
        channels: [
          {
            channelId: "channel_1",
            name: "market-chat",
            type: "text",
            canView: true,
            canSend: true,
            canReadHistory: true,
            roles: ["conversation_monitor"],
            loop: {
              status: "researching",
              pendingMessageCount: 12,
              lastProcessedAt: Date.now() - 60_000,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

afterEach(cleanup);

describe("Discord control surface", () => {
  it("builds a callback-free guild install link with minimum permissions", () => {
    expect(discordInstallUrl("1114379702015111228")).toBe(
      "https://discord.com/oauth2/authorize?client_id=1114379702015111228&integration_type=0&scope=bot&permissions=68608",
    );

    render(
      <DiscordControlView
        applicationId="1114379702015111228"
        model={controlPlane()}
        onSetChannelRoles={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Add to Discord" }),
    ).toHaveAttribute("href", discordInstallUrl("1114379702015111228"));
  });

  it("saves a stable set of channel roles", async () => {
    const onSetChannelRoles = vi.fn().mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetChannelRoles={onSetChannelRoles}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /conversation monitor/i }),
    ).toBeChecked();
    expect(screen.getByText("12 messages waiting")).toBeVisible();

    fireEvent.click(screen.getByRole("checkbox", { name: /reply target/i }));

    await waitFor(() =>
      expect(onSetChannelRoles).toHaveBeenCalledWith("guild_1", "channel_1", [
        "conversation_monitor",
        "reply_target",
      ]),
    );
  });

  it("selects and updates one server at a time", async () => {
    const onSetChannelRoles = vi.fn().mockResolvedValue(undefined);
    const first = controlPlane().guilds[0];
    if (!first) throw new Error("The test server is missing.");
    const model = controlPlane({
      guilds: [
        first,
        {
          guildId: "guild_2",
          name: "Options Desk",
          permissions: {
            viewChannels: true,
            sendMessages: true,
            readMessageHistory: true,
            messageContent: true,
          },
          channels: [
            {
              channelId: "channel_2",
              name: "market-chat",
              type: "text",
              canView: true,
              canSend: true,
              canReadHistory: true,
              roles: [],
            },
          ],
        },
      ],
    });

    render(
      <DiscordControlView
        model={model}
        onSetChannelRoles={onSetChannelRoles}
      />,
    );

    expect(screen.getByText("2 installed servers")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Market Desk" })).toBeVisible();

    fireEvent.change(screen.getByLabelText("Server"), {
      target: { value: "guild_2" },
    });

    expect(screen.getByRole("heading", { name: "Options Desk" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Market Desk" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /reply target/i }));

    await waitFor(() =>
      expect(onSetChannelRoles).toHaveBeenCalledWith("guild_2", "channel_2", [
        "reply_target",
      ]),
    );
  });

  it("shows safe live activity for the selected server", () => {
    const first = controlPlane().guilds[0];
    if (!first) throw new Error("The test server is missing.");
    const model = controlPlane({
      activity: [
        {
          eventId: "run_1:ack:sent",
          guildId: "guild_1",
          channelId: "channel_1",
          runId: "run_1",
          eventType: "reply_sent",
          replyKind: "acknowledgement",
          createdAt: Date.now(),
        },
        {
          eventId: "run_2:researching",
          guildId: "guild_2",
          channelId: "channel_2",
          runId: "run_2",
          eventType: "stage_changed",
          stage: "drafting",
          createdAt: Date.now(),
        },
      ],
      guilds: [
        first,
        {
          guildId: "guild_2",
          name: "Options Desk",
          permissions: {
            viewChannels: true,
            sendMessages: true,
            readMessageHistory: true,
            messageContent: true,
          },
          channels: [
            {
              channelId: "channel_2",
              name: "options-chat",
              type: "text",
              canView: true,
              canSend: true,
              canReadHistory: true,
              roles: ["conversation_monitor"],
            },
          ],
        },
      ],
    });

    render(<DiscordControlView model={model} onSetChannelRoles={vi.fn()} />);

    expect(screen.getByText("Acknowledgment sent")).toBeVisible();
    expect(screen.queryByText("Writing reply")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Server"), {
      target: { value: "guild_2" },
    });

    expect(screen.getByText("Writing reply")).toBeVisible();
    expect(screen.queryByText("Acknowledgment sent")).not.toBeInTheDocument();
  });

  it("shows a disconnected gateway and blocks roles without permissions", () => {
    const model = controlPlane({
      gateway: { status: "offline" },
      guilds: [
        {
          guildId: "guild_1",
          name: "Market Desk",
          permissions: {
            viewChannels: true,
            sendMessages: false,
            readMessageHistory: false,
            messageContent: false,
          },
          channels: [
            {
              channelId: "channel_1",
              name: "market-chat",
              type: "text",
              canView: true,
              canSend: false,
              canReadHistory: false,
              roles: [],
            },
          ],
        },
      ],
    });

    render(<DiscordControlView model={model} onSetChannelRoles={vi.fn()} />);

    expect(screen.getByText("The Discord gateway is offline.")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /conversation monitor/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /reply target/i }),
    ).toBeDisabled();
    expect(
      screen.getByText("Message content intent").closest("li"),
    ).toHaveAttribute("data-allowed", "false");
  });

  it("renders a mobile-safe configuration state without a data table", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const { container } = render(
      <DiscordControlView
        model={{
          gateway: { status: "not_configured" },
          activity: [],
          guilds: [],
        }}
        onSetChannelRoles={vi.fn()}
      />,
    );

    expect(container.querySelector("main")).toHaveAttribute(
      "data-layout",
      "phone-first",
    );
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(screen.getByText("Add the bot token in Railway.")).toBeVisible();
    expect(screen.getByText("No Discord servers available.")).toBeVisible();
  });

  it("reports a failed role update without losing the control surface", async () => {
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetChannelRoles={() => Promise.reject(new Error("unavailable"))}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /research log/i }));

    expect(
      await screen.findByText("Channel roles could not be saved. Try again."),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Market Desk" })).toBeVisible();
  });
});
