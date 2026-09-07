import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DiscordConversationPrivacyDeletionReadModel,
  DiscordConversationResetReadModel,
  DiscordControlPlaneReadModel,
  MarketResearchControlStatusReadModel,
} from "../../convex/types";
import {
  DiscordControlPageContent,
  DiscordControlView,
} from "./DiscordControlPage";
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
        conversation: {
          conversationId: "discord:guild_1",
          epoch: 3,
          revision: 17,
          humanRevision: 11,
          personalityVersion: "trishula-discord-v1",
          models: {
            luna: {
              model: "gpt-5.6-luna",
              reasoningEffort: "xhigh",
              serviceTier: "priority",
            },
            sol: {
              model: "gpt-5.6-sol",
              reasoningEffort: "max",
              serviceTier: "priority",
            },
          },
          lastSuccessfulActivityAt: Date.now() - 60_000,
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

function resetGuildConversation(guildId: string) {
  return Promise.resolve({
    guildId,
    conversationId: `discord:${guildId}`,
    epoch: 4,
    generation: 8,
    routingGeneration: 3,
    resetAt: Date.now(),
  });
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

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

function readyNewspaperStatus(): MarketResearchControlStatusReadModel {
  const status = marketResearchStatus();
  Object.assign(status.preferences, {
    forumChannelId: "channel_3",
    forumTagIds: ["tag_1"],
    timezoneConfirmed: true,
    maximumRankedSetups: 10,
    includeCharts: true,
    maximumCharts: 3,
  });
  return status;
}

describe("Discord control surface", () => {
  it("waits for both control queries before it initializes editable settings", () => {
    render(
      <DiscordControlPageContent
        model={controlPlane()}
        marketResearch={undefined}
        onResetGuildConversation={vi.fn()}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={vi.fn()}
        onMarketResearchAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Discord control…",
    );
    expect(
      screen.queryByRole("combobox", { name: "Schedule timezone" }),
    ).not.toBeInTheDocument();
  });

  it("preserves a dirty setting when a hydrated query refreshes", () => {
    const callbacks = {
      onResetGuildConversation: vi.fn(),
      onSetGuildRouting: vi.fn(),
      onSaveMarketResearch: vi.fn(),
      onMarketResearchAction: vi.fn(),
    };
    const { rerender } = render(
      <DiscordControlPageContent
        model={controlPlane()}
        marketResearch={[marketResearchStatus()]}
        {...callbacks}
      />,
    );
    const timezone = screen.getByRole("combobox", {
      name: "Schedule timezone",
    });
    fireEvent.change(timezone, {
      target: { value: "America/Puerto_Rico" },
    });

    rerender(
      <DiscordControlPageContent
        model={controlPlane()}
        marketResearch={[marketResearchStatus("America/New_York")]}
        {...callbacks}
      />,
    );

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
        onResetGuildConversation={resetGuildConversation}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Add to Discord" }),
    ).toHaveAttribute("href", discordInstallUrl("1114379702015111228"));
  });

  it("shows only the forum, time, and weekend controls for a full newspaper", () => {
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={resetGuildConversation}
      />,
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
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    for (const label of [
      "Edition depth",
      "Chart images",
      "Numerical data provider",
      "Maximum ranked setups",
    ]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Automatic publishing" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/up to 10 qualified ranked/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save morning newspaper" }),
    ).toHaveTextContent("Save");
    expect(screen.getByRole("button", { name: "Test now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Schedule now" })).toBeDisabled();
  });

  it("saves the forum and fixed research policy without changing conversation routes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onRoute = vi.fn();
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={onRoute}
        onSaveMarketResearch={onSave}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    fireEvent.change(screen.getByLabelText("Morning newspaper forum"), {
      target: { value: "channel_3" },
    });
    fireEvent.change(screen.getByLabelText("Morning newspaper tag"), {
      target: { value: "tag_1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save morning newspaper" }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      guildId: "guild_1",
      forumChannelId: "channel_3",
      forumTagIds: ["tag_1"],
      editionDepth: "full",
      maximumRankedSetups: 10,
      includeCharts: true,
      maximumCharts: 3,
      enabled: false,
    });
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("marketDataProviderId");
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty(
      "chartsAcceptancePassed",
    );
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("ownerDecision");
    expect(onRoute).not.toHaveBeenCalled();
  });

  it("requires a valid forum, tag, timezone, and time before test or schedule", () => {
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    const schedule = screen.getByRole("button", { name: "Schedule now" });
    const test = screen.getByRole("button", { name: "Test now" });
    fireEvent.change(screen.getByLabelText("Morning newspaper forum"), {
      target: { value: "channel_3" },
    });
    fireEvent.change(screen.getByLabelText("Schedule timezone"), {
      target: { value: "America/Puerto_Rico" },
    });
    expect(schedule).toBeDisabled();
    expect(test).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Morning newspaper tag"), {
      target: { value: "tag_1" },
    });
    expect(schedule).toBeEnabled();
    expect(test).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Local publish time"), {
      target: { value: "" },
    });
    expect(schedule).toBeDisabled();
    expect(test).toBeDisabled();
  });

  it("test saves the current form then queues a real forum edition with a request ID", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[readyNewspaperStatus()]}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={onSave}
        onMarketResearchAction={onAction}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    fireEvent.change(screen.getByLabelText("Local publish time"), {
      target: { value: "09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test now" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
        "guild_1",
        "test",
        undefined,
        expect.any(String),
      ),
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        localHour: 9,
        localMinute: 30,
        enabled: false,
        forumChannelId: "channel_3",
      }),
    );
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      onAction.mock.invocationCallOrder[0]!,
    );
    expect(screen.getByText(/Test queued/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Schedule now" })).toBeEnabled();
  });

  it("does not queue a test when saving fails", async () => {
    const onAction = vi.fn();
    render(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[readyNewspaperStatus()]}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={vi.fn().mockRejectedValue(new Error("offline"))}
        onMarketResearchAction={onAction}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test now" }));
    await waitFor(() =>
      expect(screen.getByText(/Could not queue/)).toBeVisible(),
    );
    expect(onAction).not.toHaveBeenCalled();
  });

  it("reuses an uncertain test request ID, then creates a new ID after success", async () => {
    const onAction = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[readyNewspaperStatus()]}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={vi.fn().mockResolvedValue(undefined)}
        onMarketResearchAction={onAction}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    const test = screen.getByRole("button", { name: "Test now" });
    fireEvent.click(test);
    await waitFor(() =>
      expect(screen.getByText(/Could not queue/)).toBeVisible(),
    );
    fireEvent.click(test);
    await waitFor(() => expect(screen.getByText(/Test queued/)).toBeVisible());
    expect(onAction.mock.calls[0]![3]).toBe(onAction.mock.calls[1]![3]);
    fireEvent.click(test);
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(3));
    expect(onAction.mock.calls[2]![3]).not.toBe(onAction.mock.calls[1]![3]);
  });

  it("preserves an uncertain test ID when the server card remounts", async () => {
    const onAction = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(undefined);
    const view = () => (
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[readyNewspaperStatus()]}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={vi.fn().mockResolvedValue(undefined)}
        onMarketResearchAction={onAction}
        onResetGuildConversation={resetGuildConversation}
      />
    );
    const first = render(view());
    fireEvent.click(screen.getByRole("button", { name: "Test now" }));
    await waitFor(() =>
      expect(screen.getByText(/Could not queue/)).toBeVisible(),
    );
    first.unmount();
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "Test now" }));
    await waitFor(() => expect(screen.getByText(/Test queued/)).toBeVisible());
    expect(onAction.mock.calls[1]![3]).toBe(onAction.mock.calls[0]![3]);
  });

  it("shows Scheduled only after scheduling succeeds and re-enables it for changes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[readyNewspaperStatus()]}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={onSave}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Schedule now" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Scheduled" })).toBeDisabled(),
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    fireEvent.change(screen.getByLabelText("Local publish time"), {
      target: { value: "09:00" },
    });
    expect(screen.getByRole("button", { name: "Schedule now" })).toBeEnabled();
    expect(screen.queryByText("Newspaper scheduled.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Local publish time"), {
      target: { value: "08:00" },
    });
    expect(screen.getByRole("button", { name: "Scheduled" })).toBeDisabled();
  });

  it("Save keeps an unchanged schedule but changed settings need scheduling again", async () => {
    const status = readyNewspaperStatus();
    status.preferences.enabled = true;
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[status]}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={onSave}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    expect(screen.getByRole("button", { name: "Scheduled" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save morning newspaper" }),
    );
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Local publish time")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Local publish time"), {
      target: { value: "10:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save morning newspaper" }),
    );
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false, localHour: 10 }),
      ),
    );
    expect(screen.getByRole("button", { name: "Schedule now" })).toBeEnabled();
  });

  it("does not claim Scheduled when the backend rejects scheduling", async () => {
    render(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[readyNewspaperStatus()]}
        onSetGuildRouting={vi.fn()}
        onSaveMarketResearch={vi
          .fn()
          .mockRejectedValue(new Error("unavailable"))}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Schedule now" }));
    await waitFor(() =>
      expect(screen.getByText(/Could not save/)).toBeVisible(),
    );
    expect(
      screen.queryByRole("button", { name: "Scheduled" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule now" })).toBeEnabled();
  });

  it("uses new server revisions to clear an outdated Scheduled state without resetting the draft", () => {
    const status = readyNewspaperStatus();
    status.preferences.enabled = true;
    const callbacks = {
      onSetGuildRouting: vi.fn(),
      onResetGuildConversation: resetGuildConversation,
    };
    const { rerender } = render(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[status]}
        {...callbacks}
      />,
    );
    expect(screen.getByRole("button", { name: "Scheduled" })).toBeDisabled();
    const updated = readyNewspaperStatus();
    updated.preferences.revision = 2;
    rerender(
      <DiscordControlView
        model={controlPlane()}
        marketResearch={[updated]}
        {...callbacks}
      />,
    );
    expect(screen.getByRole("button", { name: "Schedule now" })).toBeEnabled();
    expect(screen.getByLabelText("Morning newspaper forum")).toHaveValue(
      "channel_3",
    );
  });

  it("allows text publication when the forum lacks optional chart permission", () => {
    const model = controlPlane();
    model.guilds[0]!.channels[2]!.canAttachFiles = false;
    render(
      <DiscordControlView
        model={model}
        marketResearch={[readyNewspaperStatus()]}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={resetGuildConversation}
      />,
    );
    expect(screen.getByText(/Research will still post as text/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Test now" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Schedule now" })).toBeEnabled();
  });

  it.each(["America/Puerto_Rico", "Europe/London"])(
    "preserves the saved timezone %s",
    async (timezone) => {
      const status = readyNewspaperStatus();
      status.preferences.timezone = timezone;
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <DiscordControlView
          model={controlPlane()}
          marketResearch={[status]}
          onSetGuildRouting={vi.fn()}
          onSaveMarketResearch={onSave}
          onResetGuildConversation={resetGuildConversation}
        />,
      );
      expect(screen.getByLabelText("Schedule timezone")).toHaveValue(timezone);
      fireEvent.click(
        screen.getByRole("button", { name: "Save morning newspaper" }),
      );
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({ timezone, timezoneConfirmed: true }),
        ),
      );
    },
  );

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

    render(
      <DiscordControlView
        model={model}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={resetGuildConversation}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Conversation channel" }),
    ).toHaveValue("");
  });

  it("rejects one channel assigned to both server roles", async () => {
    const onSetGuildRouting = vi.fn().mockResolvedValue(undefined);
    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={onSetGuildRouting}
        onResetGuildConversation={resetGuildConversation}
      />,
    );

    expect(screen.getByText("12 messages waiting")).toBeVisible();
    expect(
      screen
        .getByRole("combobox", { name: "Research log channel" })
        .querySelector('option[value="channel_1"]'),
    ).toBeDisabled();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Research log channel" }),
      { target: { value: "channel_1" } },
    );

    expect(
      await screen.findByText(
        "Conversation and research log channels must be different.",
      ),
    ).toBeVisible();
    expect(onSetGuildRouting).not.toHaveBeenCalled();
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
        onResetGuildConversation={resetGuildConversation}
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
          eventId: "run_1:delivery-reconciliation-required",
          guildId: "guild_1",
          channelId: "channel_1",
          runId: "run_1",
          eventType: "delivery_reconciliation_required",
          replyKind: "final",
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

    render(
      <DiscordControlView
        model={model}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={resetGuildConversation}
      />,
    );

    expect(screen.getByText("Acknowledgment sent")).toBeVisible();
    expect(
      screen.getByText("Delivery blocked for reconciliation"),
    ).toBeVisible();
    expect(screen.queryByText("Writing reply")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Server"), {
      target: { value: "guild_2" },
    });

    expect(screen.getByText("Writing reply")).toBeVisible();
    expect(screen.queryByText("Acknowledgment sent")).not.toBeInTheDocument();
  });

  it("shows content-free conversation status and confirms a memory reset", async () => {
    let resolveReset:
      | ((result: DiscordConversationResetReadModel) => void)
      | undefined;
    const resetPending = new Promise<DiscordConversationResetReadModel>(
      (resolve) => {
        resolveReset = resolve;
      },
    );
    const onResetGuildConversation = vi.fn(() => resetPending);

    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={onResetGuildConversation}
      />,
    );

    const statusHeading = screen.getByRole("heading", {
      name: "Conversation status",
    });
    const status = statusHeading.closest("section");
    if (!status) throw new Error("The conversation status card is missing.");

    expect(within(status).getByText("17")).toBeVisible();
    expect(within(status).getByText("11")).toBeVisible();
    expect(within(status).getByText("trishula-discord-v1")).toBeVisible();
    expect(
      within(status).getByText("gpt-5.6-luna · xhigh · priority"),
    ).toBeVisible();
    expect(
      within(status).getByText("gpt-5.6-sol · max · priority"),
    ).toBeVisible();
    expect(
      within(status).queryByText("discord:guild_1"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(status).getByRole("button", { name: "Reset server memory" }),
    );

    expect(
      within(status).getByText(
        /It does not delete Discord messages or audit records\./,
      ),
    ).toBeVisible();
    const confirmation = within(status).getByRole("textbox", {
      name: "Reset confirmation",
    });
    const submit = within(status).getByRole("button", {
      name: "Start clean epoch",
    });
    expect(submit).toBeDisabled();

    fireEvent.change(confirmation, {
      target: { value: "Reset Trishula memory for another server" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(confirmation, {
      target: { value: "Reset Trishula memory for Market Desk" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(onResetGuildConversation).toHaveBeenCalledOnce();
    expect(onResetGuildConversation).toHaveBeenCalledWith("guild_1");
    expect(
      within(status).queryByText(/Epoch 4 is active\./),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveReset?.({
        guildId: "guild_1",
        conversationId: "discord:guild_1",
        epoch: 4,
        generation: 8,
        routingGeneration: 3,
        resetAt: Date.now(),
      });
    });

    expect(
      within(status).getByText(
        "Trishula memory was reset for Market Desk. Epoch 4 is active.",
      ),
    ).toBeVisible();
  });

  it("keeps privacy deletion separate and requires the exact server confirmation", async () => {
    const onDeleteGuildConversationPrivacyData = vi
      .fn<
        (
          guildId: string,
        ) => Promise<DiscordConversationPrivacyDeletionReadModel>
      >()
      .mockResolvedValue({
        guildId: "guild_1",
        conversationId: "discord:guild_1",
        deletedRecords: 42,
        epoch: 4,
        deletedAt: Date.now(),
      });

    render(
      <DiscordControlView
        model={controlPlane()}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={resetGuildConversation}
        onDeleteGuildConversationPrivacyData={
          onDeleteGuildConversationPrivacyData
        }
      />,
    );

    const statusHeading = screen.getByRole("heading", {
      name: "Conversation status",
    });
    const status = statusHeading.closest("section");
    if (!status) throw new Error("The conversation status card is missing.");

    expect(
      within(status).getByText(/It does not delete messages from Discord\./),
    ).toBeVisible();
    expect(
      within(status).getByText(
        /It does not delete Discord messages or audit records\./,
      ),
    ).toBeVisible();

    fireEvent.click(
      within(status).getByRole("button", { name: "Delete retained data" }),
    );

    const confirmation = within(status).getByRole("textbox", {
      name: "Privacy deletion confirmation",
    });
    const submit = within(status).getByRole("button", {
      name: "Delete retained data",
    });
    expect(submit).toBeDisabled();

    fireEvent.change(confirmation, {
      target: { value: "Delete retained Trishula data for another server" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(confirmation, {
      target: { value: "Delete retained Trishula data for Market Desk" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onDeleteGuildConversationPrivacyData).toHaveBeenCalledWith(
        "guild_1",
      ),
    );
    expect(
      within(status).getByText(
        "Retained Trishula data was deleted for Market Desk. Removed 42 records.",
      ),
    ).toBeVisible();
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

    render(
      <DiscordControlView
        model={model}
        onSetGuildRouting={vi.fn()}
        onResetGuildConversation={resetGuildConversation}
      />,
    );

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
        onResetGuildConversation={resetGuildConversation}
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
        onResetGuildConversation={resetGuildConversation}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Research log channel" }),
      { target: { value: "" } },
    );

    expect(
      await screen.findByText("Server routing could not be saved. Try again."),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Market Desk" })).toBeVisible();
  });
});
