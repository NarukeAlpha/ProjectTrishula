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

function controlPlane(
  overrides: Partial<DiscordControlPlaneReadModel> = {},
): DiscordControlPlaneReadModel {
  return {
    gateway: {
      status: "online",
      botUserName: "Trishula#2048",
      lastHeartbeatAt: Date.now(),
    },
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
        model={{ gateway: { status: "not_configured" }, guilds: [] }}
        onSetChannelRoles={vi.fn()}
      />,
    );

    expect(container.querySelector("main")).toHaveAttribute(
      "data-layout",
      "phone-first",
    );
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("Add the Discord credentials in Railway."),
    ).toBeVisible();
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
