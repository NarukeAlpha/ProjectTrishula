import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DiscordControlPlaneReadModel,
  MarketResearchControlStatusReadModel,
} from "../../convex/types";
import { DiscordControlPage, DiscordControlView } from "./DiscordControlPage";
import { discordInstallUrl } from "./discordInstall";

const convexReact = vi.hoisted(() => ({
  useMutation: vi.fn(() => vi.fn()),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convexReact);

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
            roles: ["conversation_monitor", "reply_target"],
            loop: {
              status: "researching",
              pendingMessageCount: 12,
              lastProcessedAt: Date.now() - 60_000,
            },
          },
          {
            channelId: "channel_2",
            name: "research-log",
            type: "text",
            canView: true,
            canSend: true,
            canReadHistory: true,
            roles: ["research_log"],
          },
          {
            channelId: "channel_3",
            name: "morning-paper",
            type: "forum",
            canView: true,
            canSend: true,
            canReadHistory: true,
            canCreateForumPost: true,
            canSendInThreads: true,
            canReadThreadHistory: true,
            canAttachFiles: true,
            requiresTag: true,
            availableTags: [
              { id: "tag_1", name: "Morning", moderated: false, emoji: "📰" },
              { id: "tag_2", name: "Moderated", moderated: true },
            ],
            roles: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

afterEach(cleanup);

function marketResearchStatus(
  timezone = "America/New_York",
): MarketResearchControlStatusReadModel {
  return {
    guildId: "guild_1",
    preferences: {
      guildId: "guild_1",
      enabled: false,
      forumChannelId: null,
      forumTagIds: [],
      timezone,
      timezoneConfirmed: false,
      localHour: 8,
      localMinute: 0,
      includeWeekends: true,
      includeCharts: false,
      chartsAcceptancePassed: false,
      editionDepth: "full",
      maximumRankedSetups: 5,
      revision: 1,
      updatedAt: "2026-09-07T12:00:00.000Z",
    },
    current: null,
  };
}

describe("Discord control surface", () => {
  it("waits for both control queries before it initializes editable settings", () => {
    convexReact.useQuery
      .mockReset()
      .mockReturnValueOnce(controlPlane())
      .mockReturnValueOnce(undefined);

    render(<DiscordControlPage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Discord control…",
    );
    expect(
      screen.queryByRole("combobox", { name: "Schedule timezone" }),
    ).not.toBeInTheDocument();
  });

  it("preserves a dirty setting when a hydrated query refreshes", () => {
    let statuses = [marketResearchStatus()];
    let queryNumber = 0;
    convexReact.useQuery.mockReset().mockImplementation(() => {
      queryNumber += 1;
      return queryNumber % 2 === 1 ? controlPlane() : statuses;
    });
    const { rerender } = render(<DiscordControlPage />);
    const timezone = screen.getByRole("combobox", {
      name: "Schedule timezone",
    });
    fireEvent.change(timezone, {
      target: { value: "America/Puerto_Rico" },
    });

    statuses = [marketResearchStatus("America/New_York")];
    rerender(<DiscordControlPage />);

    expect(
      screen.getByRole("combobox", { name: "Schedule timezone" }),
    ).toHaveValue("America/Puerto_Rico");
  });

  it("builds a callback-free guild install link with minimum permissions", () => {
    expect(discordInstallUrl("1114379702015111228")).toBe(
      "https://discord.com/oauth2/authorize?client_id=1114379702015111228&integration_type=0&scope=bot&permissions=68608",
    );

    render(
      <DiscordControlView
        applicationId="1114379702015111228"
        model={controlPlane()}
        onSetGuildRouting={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Add to Discord" }),
    ).toHaveAttribute("href", discordInstallUrl("1114379702015111228"));
  });

  it("shows three independent server-level routes instead of channel cards", () => {
    render(
      <DiscordControlView model={controlPlane()} onSetGuildRouting={vi.fn()} />,
    );

    expect(
      screen.getByRole("combobox", { name: "Conversation channel" }),
    ).toHaveValue("channel_1");
    expect(
      screen.getByRole("combobox", { name: "Research log channel" }),
    ).toHaveValue("channel_2");
    expect(
      screen.getByRole("combobox", { name: "Morning newspaper forum" }),
    ).toHaveValue("");
    expect(screen.getAllByRole("combobox")).toHaveLength(6);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("saves the forum route without changing either conversational route", async () => {
    const onSetGuildRouting = vi.fn().mockResolvedValue(undefined);
    const onSaveMarketResearch = vi.fn().mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={onSetGuildRouting}
        onSaveMarketResearch={onSaveMarketResearch}
      />,
    );

    const forum = screen.getByRole("combobox", {
      name: "Morning newspaper forum",
    });
    expect(forum.querySelector('option[value="channel_1"]')).toBeNull();
    fireEvent.change(forum, { target: { value: "channel_3" } });
    const tag = screen.getByRole("combobox", { name: "Morning newspaper tag" });
    expect(tag.querySelector('option[value="tag_2"]')).toBeNull();
    fireEvent.change(tag, { target: { value: "tag_1" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save morning newspaper" }),
    );

    await waitFor(() =>
      expect(onSaveMarketResearch).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild_1",
          forumChannelId: "channel_3",
          forumTagIds: ["tag_1"],
          enabled: false,
        }),
      ),
    );
    expect(onSetGuildRouting).not.toHaveBeenCalled();
  });

  it("does not present split legacy roles as a configured conversation", () => {
    const model = controlPlane();
    const guild = model.guilds[0];
    const firstChannel = guild?.channels[0];
    const secondChannel = guild?.channels[1];
    if (!firstChannel || !secondChannel) {
      throw new Error("The test channels are missing.");
    }
    firstChannel.roles = ["conversation_monitor"];
    secondChannel.roles = ["reply_target", "research_log"];

    render(<DiscordControlView model={model} onSetGuildRouting={vi.fn()} />);

    expect(
      screen.getByRole("combobox", { name: "Conversation channel" }),
    ).toHaveValue("");
  });

  it("moves a server route and preserves the other purpose", async () => {
    const onSetGuildRouting = vi.fn().mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={onSetGuildRouting}
      />,
    );

    expect(screen.getByText("12 messages waiting")).toBeVisible();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Research log channel" }),
      { target: { value: "channel_1" } },
    );

    await waitFor(() => {
      expect(onSetGuildRouting).toHaveBeenCalledOnce();
      expect(onSetGuildRouting).toHaveBeenCalledWith(
        "guild_1",
        "channel_1",
        "channel_1",
      );
    });
  });

  it("selects and updates one server at a time", async () => {
    const onSetGuildRouting = vi.fn().mockResolvedValue(undefined);
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
        onSetGuildRouting={onSetGuildRouting}
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

    fireEvent.change(
      screen.getByRole("combobox", { name: "Research log channel" }),
      { target: { value: "channel_2" } },
    );

    await waitFor(() =>
      expect(onSetGuildRouting).toHaveBeenCalledWith(
        "guild_2",
        null,
        "channel_2",
      ),
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

    render(<DiscordControlView model={model} onSetGuildRouting={vi.fn()} />);

    expect(screen.getByText("Acknowledgment sent")).toBeVisible();
    expect(screen.queryByText("Writing reply")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Server"), {
      target: { value: "guild_2" },
    });

    expect(screen.getByText("Writing reply")).toBeVisible();
    expect(screen.queryByText("Acknowledgment sent")).not.toBeInTheDocument();
  });

  it("shows a disconnected gateway and blocks unavailable channel routes", () => {
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

    render(<DiscordControlView model={model} onSetGuildRouting={vi.fn()} />);

    expect(screen.getByText("The Discord gateway is offline.")).toBeVisible();
    const conversation = screen.getByRole("combobox", {
      name: "Conversation channel",
    });
    const research = screen.getByRole("combobox", {
      name: "Research log channel",
    });
    expect(
      conversation.querySelector('option[value="channel_1"]'),
    ).toBeDisabled();
    expect(research.querySelector('option[value="channel_1"]')).toBeDisabled();
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
        onSetGuildRouting={vi.fn()}
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
        onSetGuildRouting={() => Promise.reject(new Error("unavailable"))}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Research log channel" }),
      { target: { value: "channel_1" } },
    );

    expect(
      await screen.findByText("Server routing could not be saved. Try again."),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Market Desk" })).toBeVisible();
  });
});
