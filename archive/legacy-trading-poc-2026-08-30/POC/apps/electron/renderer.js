const adapterBaseUrl = window.tradingBridge.adapterBaseUrl;

const state = {
  settings: null,
  data: null,
  adapterStatus: null,
  selectedSymbol: null,
  activeDock: "Diagnostics",
  activeRightTab: "Ticket",
  activeWorkspaceMode: "Research",
  activeTimeframe: "5m",
  activeRange: "1D",
  activity: [],
  review: null,
  error: null,
  loading: false,
  toolState: {
    indicators: true,
    markers: true,
    fullscreen: false,
    percent: false,
    log: false,
    auto: true,
  },
  orderForm: {
    side: "Buy",
    quantity: 1,
    orderType: "Limit",
    limitPrice: "",
    timeInForce: "Day",
  },
  refreshTimer: null,
};

window.tradingWorkbenchReady = new Promise((resolve) => {
  window.resolveTradingWorkbenchReady = resolve;
});

class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = details.status;
    this.code = details.code;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, handler) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

function sanitizeSymbol(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.^-]/g, "");
}

function signedTone(value) {
  return String(value || "").startsWith("-") ? "negative" : "positive";
}

function requestUrl(path) {
  return new URL(path, adapterBaseUrl);
}

async function requestJson(path, options = {}) {
  const response = await fetch(requestUrl(path), {
    cache: "no-store",
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(payload?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: payload?.code,
    });
  }
  return payload;
}

function addActivity(message) {
  state.activity.unshift({
    message,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
  state.activity = state.activity.slice(0, 12);
}

function applySettings(settings) {
  state.settings = settings;
  state.selectedSymbol = settings.selectedSymbol || null;
  state.activeWorkspaceMode = settings.activeWorkspaceMode || "Research";
  state.activeTimeframe = settings.activeTimeframe || "5m";
  state.activeRange = settings.activeRange || "1D";
}

async function loadSettings() {
  applySettings(await requestJson("/v1/app/settings"));
}

async function patchSettings(update) {
  applySettings(await requestJson("/v1/app/settings", {
    method: "PATCH",
    body: JSON.stringify(update),
  }));
}

async function addWatchlistSymbol(symbol) {
  applySettings(await requestJson("/v1/app/watchlist", {
    method: "POST",
    body: JSON.stringify({ symbol }),
  }));
}

async function removeWatchlistSymbol(symbol) {
  applySettings(await requestJson(`/v1/app/watchlist/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
  }));
}

async function fetchAdapterStatus() {
  try {
    state.adapterStatus = await requestJson("/v1/status");
  } catch (error) {
    state.adapterStatus = null;
    throw error;
  }
}

async function fetchLiveWorkbench(symbol) {
  const url = requestUrl("/v1/workbench/live");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("timeframe", state.activeTimeframe);
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(payload?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: payload?.code,
    });
  }
  return payload;
}

async function selectSymbol(rawSymbol, options = {}) {
  const symbol = sanitizeSymbol(rawSymbol);
  if (!symbol) {
    state.error = "Enter a stock symbol before loading IBKR market data.";
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  render();

  try {
    const previousSymbol = state.selectedSymbol;
    if (options.persist !== false) {
      await addWatchlistSymbol(symbol);
    } else {
      state.selectedSymbol = symbol;
    }

    const [data] = await Promise.all([
      fetchLiveWorkbench(symbol),
      fetchAdapterStatus().catch(() => null),
    ]);
    state.data = data;
    state.selectedSymbol = data.symbol;
    state.activeTimeframe = data.activeTimeframe || state.activeTimeframe;
    state.orderForm.limitPrice = data.quote?.ask || data.lastPrice || "";
    if (previousSymbol && previousSymbol !== data.symbol && state.review?.symbol !== data.symbol) {
      state.review = null;
      if (state.activeRightTab === "Preview") state.activeRightTab = "Ticket";
    }
    if (!options.quiet) {
      addActivity(`Loaded IBKR ${data.symbol} from ${data.liveSource?.provider || "backend"}.`);
    }
    startAutoRefresh();
  } catch (error) {
    state.error = `${error.code || "liveFetchFailed"}: ${error.message}`;
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshSelected(options = {}) {
  if (!state.selectedSymbol) {
    state.error = "No symbol selected. Enter a symbol or choose one from the watchlist.";
    render();
    return;
  }
  await selectSymbol(state.selectedSymbol, { persist: false, quiet: options.quiet });
  if (!options.quiet && !state.error) {
    addActivity(`Refreshed ${state.selectedSymbol}.`);
    render();
  }
}

function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (state.selectedSymbol && !state.loading) {
      refreshSelected({ quiet: true });
    }
  }, 60000);
}

function renderEmptySurface() {
  renderTopbar();
  renderRail();
  renderHeader();
  renderRightPanel();
  renderDock();
  drawChart();
}

function renderTopbar() {
  const modes = document.querySelector(".mode-group");
  modes.innerHTML = "";
  ["Research", "Paper", "Live Review"].forEach((mode) => {
    modes.append(button(mode === state.activeWorkspaceMode ? "active" : "", mode, async () => {
      await patchSettings({ activeWorkspaceMode: mode });
      addActivity(`Workspace mode set to ${mode}.`);
      render();
    }));
  });

  const input = document.querySelector(".symbol-search input");
  if (document.activeElement !== input) {
    input.value = state.selectedSymbol || "";
  }

  const labels = statusCards();
  const strip = document.querySelector(".status-strip");
  strip.innerHTML = "";
  labels.forEach((item) => {
    const card = el("div", `status-card ${item.tone}`);
    card.append(el("strong", "", item.label));
    card.append(el("span", "", item.value));
    strip.append(card);
  });
}

function statusCards() {
  const data = state.data;
  const source = data?.liveSource;
  const adapterStatus = state.adapterStatus;
  return [
    {
      label: state.loading ? "Loading IBKR Data" : data ? data.adapter.providerState : "No Symbol Selected",
      value: data ? `${data.symbol} ${data.lastPrice}` : "Enter a symbol to fetch from IBKR",
      tone: data ? "green" : "muted",
    },
    {
      label: "Backend",
      value: adapterStatus ? adapterStatus.connectionState : "status unavailable",
      tone: adapterStatus ? "blue" : "orange",
    },
    {
      label: "Market Source",
      value: source ? source.provider : "not requested",
      tone: source ? "green" : "muted",
    },
    {
      label: "Saved State",
      value: state.settings?.databasePath ? "SQLite ready" : "settings unavailable",
      tone: state.settings?.databasePath ? "blue" : "orange",
    },
    {
      label: "Alerts",
      value: state.error || "none",
      tone: state.error ? "orange" : "green",
    },
  ];
}

function renderRail() {
  const list = document.querySelector(".watchlist");
  list.innerHTML = "";
  const rows = watchlistRows();
  if (rows.length === 0) {
    list.append(emptyBlock("No symbols saved", "Use the symbol box to add one."));
  } else {
    rows.forEach((item) => {
      const row = el("button", `watch-row ${item.symbol === state.selectedSymbol ? "selected" : ""}`);
      row.type = "button";
      row.addEventListener("click", () => selectSymbol(item.symbol));
      const left = el("span");
      left.append(el("strong", "", item.symbol));
      left.append(el("small", "", item.name || "Saved symbol"));
      const right = el("span", item.isLive ? signedTone(item.change) : "muted");
      right.append(el("strong", "", item.last || "Load"));
      right.append(el("small", "", item.isLive ? `${item.changePercent} ${item.change}` : "click for IBKR quote"));
      row.append(left, right);
      list.append(row);
    });
  }

  const captures = document.querySelector(".capture-list");
  captures.innerHTML = "";
  if (state.activity.length === 0) {
    captures.append(emptyBlock("No activity yet", "Live loads and reviews appear here."));
  } else {
    state.activity.forEach((capture) => {
      const row = el("button", "capture-row");
      row.type = "button";
      row.append(el("span", "", capture.message));
      row.append(el("small", "", capture.timestamp));
      captures.append(row);
    });
  }
}

function watchlistRows() {
  const saved = state.settings?.watchlist || [];
  const rows = saved.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    isLive: false,
  }));

  if (state.data) {
    const existing = rows.find((row) => row.symbol === state.data.symbol);
    const live = {
      symbol: state.data.symbol,
      name: state.data.company,
      last: state.data.lastPrice,
      change: state.data.change,
      changePercent: state.data.changePercent,
      isLive: true,
    };
    if (existing) Object.assign(existing, live);
    else rows.unshift(live);
  }
  return rows;
}

function renderHeader() {
  const data = state.data;
  document.querySelector(".symbol").textContent = data?.symbol || "No symbol";
  document.querySelector(".company").textContent = data
    ? `${data.company} | ${data.venue}`
    : "Select a symbol to request IBKR market data from the Rust backend.";
  document.querySelector(".last-price").textContent = data?.lastPrice || "--";
  document.querySelector(".price-change").textContent = data ? `${data.change} (${data.changePercent})` : "--";
  document.querySelector(".price-change").className = `price-change ${data ? signedTone(data.change) : ""}`;

  const metrics = document.querySelector(".quote-metrics");
  metrics.innerHTML = "";
  const metricRows = data
    ? [["Bid", data.quote.bid], ["Ask", data.quote.ask], ["High", data.quote.high], ["Low", data.quote.low], ["Vol", data.quote.volume], ["Bars", String(data.liveSource.barCount)]]
    : [["Bid", "--"], ["Ask", "--"], ["High", "--"], ["Low", "--"], ["Vol", "--"], ["Bars", "--"]];
  metricRows.forEach(([label, value]) => {
    const metric = el("div", "metric");
    metric.append(el("span", "", label));
    metric.append(el("strong", "", value));
    metrics.append(metric);
  });

  const timeframes = document.querySelector(".timeframes");
  timeframes.innerHTML = "";
  ["1m", "5m", "15m", "1h", "D", "W"].forEach((timeframe) => {
    timeframes.append(button(timeframe === state.activeTimeframe ? "active" : "", timeframe, async () => {
      await patchSettings({ activeTimeframe: timeframe });
      state.activeTimeframe = timeframe;
      if (state.selectedSymbol) await refreshSelected();
      else render();
    }));
  });

  document.querySelector(".clock").textContent = data?.liveSource?.regularMarketTime
    ? `Market ${shortTime(data.liveSource.regularMarketTime)}`
    : new Date().toLocaleTimeString();
  document.querySelectorAll("[data-range]").forEach((range) => {
    range.classList.toggle("active", range.dataset.range === state.activeRange);
  });
  document.querySelectorAll("[data-chart-toggle]").forEach((toggle) => {
    toggle.classList.toggle("active", Boolean(state.toolState[toggle.dataset.chartToggle]));
  });
}

function shortTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return timestamp;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function drawChart() {
  const canvas = document.querySelector("#priceChart");
  const parent = canvas.parentElement.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(420, Math.floor(parent.width * ratio));
  canvas.height = Math.max(260, Math.floor(parent.height * ratio));
  canvas.style.width = `${parent.width}px`;
  canvas.style.height = `${parent.height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071012";
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const data = state.data;
  if (!data?.bars?.length) {
    ctx.fillStyle = "#8c9ba0";
    ctx.font = "14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      state.loading ? "Loading IBKR market data..." : "No IBKR symbol selected",
      width / 2,
      height / 2
    );
    return;
  }

  const top = 18;
  const bottom = 72;
  const left = 14;
  const right = 64;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const levelPrices = state.toolState.indicators ? data.levels.map((level) => level.price) : [];
  const prices = data.bars.flatMap((bar) => [bar.high, bar.low]).concat(levelPrices);
  const min = Math.min(...prices) - 1;
  const max = Math.max(...prices) + 1;
  const y = (priceValue) => top + ((max - priceValue) / (max - min)) * plotHeight;
  const x = (fraction) => left + fraction * plotWidth;

  if (state.toolState.indicators) {
    data.levels.forEach((level) => drawLevel(ctx, level, y, width, left, right));
  }

  const candleWidth = Math.max(3, (plotWidth / data.bars.length) * 0.48);
  data.bars.forEach((bar) => {
    const cx = x(bar.x);
    const up = bar.close >= bar.open;
    const color = up ? "#2bc95f" : "#f24d45";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, y(bar.high));
    ctx.lineTo(cx, y(bar.low));
    ctx.stroke();
    const bodyTop = Math.min(y(bar.open), y(bar.close));
    const bodyHeight = Math.max(2, Math.abs(y(bar.open) - y(bar.close)));
    ctx.fillRect(cx - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    const volumeHeight = Math.max(4, (bar.volume / 720) * 54);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(cx - candleWidth / 2, height - 48 - volumeHeight, candleWidth, volumeHeight);
    ctx.globalAlpha = 1;
  });

  if (state.toolState.markers) {
    data.markers.forEach((marker) => drawMarker(ctx, marker, x, y, width, right));
  }

  ctx.fillStyle = "#8c9ba0";
  ctx.textAlign = "left";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(`${data.symbol} | ${state.activeTimeframe} | ${data.venue}`, left + 2, top + 16);
  ctx.fillStyle = "#33db6d";
  ctx.fillText(`IBKR C ${data.lastPrice} | ${data.changePercent}`, left + 190, top + 16);
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = "rgba(116, 139, 148, 0.16)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i += 1) {
    const gy = 18 + ((height - 90) / 9) * i;
    ctx.beginPath();
    ctx.moveTo(14, gy);
    ctx.lineTo(width - 64, gy);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i += 1) {
    const gx = 14 + ((width - 78) / 11) * i;
    ctx.beginPath();
    ctx.moveTo(gx, 18);
    ctx.lineTo(gx, height - 54);
    ctx.stroke();
  }
}

function drawLevel(ctx, level, y, width, left, right) {
  const py = y(level.price);
  const color = level.kind === "target" ? "#37d46d" : level.kind === "stop" ? "#ff4d45" : level.kind === "bid" ? "#ff6a4b" : level.kind === "ask" ? "#4aa7ff" : "#9aa5ad";
  ctx.strokeStyle = color;
  ctx.setLineDash(level.kind === "target" || level.kind === "stop" ? [4, 3] : []);
  ctx.beginPath();
  ctx.moveTo(left, py);
  ctx.lineTo(width - right, py);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(level.label, width - 4, py - 4);
  ctx.fillText(level.price.toLocaleString(undefined, { minimumFractionDigits: 2 }), width - 4, py + 11);
}

function drawMarker(ctx, marker, x, y, width, right) {
  const mx = x(marker.x);
  const my = y(marker.price);
  const color = marker.kind === "buy" ? "#4ab4ff" : marker.kind === "sell" ? "#81db80" : "#ff5a55";
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(mx, my, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const labelWidth = ctx.measureText(marker.label).width + 16;
  const labelX = Math.min(mx + 10, width - right - labelWidth - 4);
  const labelY = my - 24;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(labelX, labelY, labelWidth, 20);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#dbe9e6";
  ctx.fillText(marker.label, labelX + 8, labelY + 14);
}

function renderRightPanel() {
  const tabs = document.querySelector(".right-tabs");
  tabs.innerHTML = "";
  ["Proposal", "Ticket", "Risk", "Preview"].forEach((tab) => {
    tabs.append(button(tab === state.activeRightTab ? "active" : "", tab, () => {
      state.activeRightTab = tab;
      renderRightPanel();
    }));
  });

  const panel = document.querySelector(".ticket-panel");
  panel.innerHTML = "";
  const title = el("h2", "", rightPanelTitle());
  title.append(el("span", "paper-badge", state.activeWorkspaceMode));
  panel.append(title);

  if (!state.data) {
    panel.append(emptyBlock("No IBKR quote loaded", "Enter a symbol before building a ticket or review."));
    return;
  }

  if (state.activeRightTab === "Proposal") renderProposal(panel);
  if (state.activeRightTab === "Ticket") renderTicket(panel);
  if (state.activeRightTab === "Risk") renderRisk(panel);
  if (state.activeRightTab === "Preview") renderPreview(panel);
}

function rightPanelTitle() {
  return {
    Proposal: "Trade Proposal",
    Ticket: "Order Ticket",
    Risk: "Risk Review",
    Preview: "Paper Preview",
  }[state.activeRightTab];
}

function renderProposal(panel) {
  [
    ["Symbol", state.data.symbol],
    ["IBKR Price", state.data.lastPrice],
    ["Timeframe", state.activeTimeframe],
    ["Range", state.activeRange],
    ["Source", state.data.liveSource.provider],
    ["Fetched", state.data.liveSource.fetchedAt],
  ].forEach(([label, value]) => panel.append(fieldRow(label, value)));
  panel.append(el("div", "broker-preview", "Proposal is local research only until a broker preview route is wired."));
}

function renderTicket(panel) {
  panel.append(selectField("Side", "side", ["Buy", "Sell"]));
  panel.append(inputField("Quantity", "quantity", "number", { min: "1", step: "1" }));
  panel.append(selectField("Order Type", "orderType", ["Limit", "Market"]));
  panel.append(inputField("Limit Price", "limitPrice", "text"));
  panel.append(selectField("Time in Force", "timeInForce", ["Day", "GTC"]));
  panel.append(fieldRow("IBKR Bid", state.data.quote.bid));
  panel.append(fieldRow("IBKR Ask", state.data.quote.ask));
  panel.append(el("div", "broker-preview", `Route preview is gated. Current venue: ${state.data.venue}.`));
}

function renderRisk(panel) {
  const risk = el("section", "risk-summary");
  [
    ["Max Loss (Stop)", state.data.risk.maxLoss, "negative"],
    ["Max Gain (T1)", state.data.risk.maxGain, "positive"],
    ["Risk / Reward", state.data.risk.rewardRisk],
    ["Prob. of Profit", state.data.risk.probability],
    ["Delta (Net)", state.data.risk.deltaNet],
    ["Theta (Daily)", state.data.risk.thetaDaily],
    ["Buying Power Impact", state.data.risk.buyingPower],
    ["Margin Impact", state.data.risk.marginImpact],
  ].forEach(([label, value, tone]) => {
    const row = fieldRow(label, value);
    if (tone) row.classList.add(tone);
    risk.append(row);
  });
  panel.append(risk);
  state.data.risk.warnings.forEach((warning) => panel.append(el("div", "warning-card", warning)));
}

function renderPreview(panel) {
  if (!state.review) {
    panel.append(emptyBlock("No paper review yet", "Use Review Paper to generate a local audit preview."));
    return;
  }
  [
    ["Review ID", state.review.id],
    ["Symbol", state.review.symbol],
    ["Side", state.review.side],
    ["Quantity", String(state.review.quantity)],
    ["Type", state.review.orderType],
    ["Limit", state.review.limitPrice],
    ["Generated", state.review.timestamp],
    ["Status", state.review.status],
  ].forEach(([label, value]) => panel.append(fieldRow(label, value)));
}

function inputField(label, key, type, attrs = {}) {
  const row = el("label", "field-row editable-field");
  row.append(el("span", "", label));
  const input = el("input");
  input.type = type;
  input.value = state.orderForm[key];
  Object.entries(attrs).forEach(([name, value]) => input.setAttribute(name, value));
  input.addEventListener("input", () => {
    state.orderForm[key] = type === "number" ? Number(input.value || 0) : input.value;
  });
  row.append(input);
  return row;
}

function selectField(label, key, options) {
  const row = el("label", "field-row editable-field");
  row.append(el("span", "", label));
  const select = el("select");
  options.forEach((option) => {
    const node = el("option", "", option);
    node.value = option;
    node.selected = state.orderForm[key] === option;
    select.append(node);
  });
  select.addEventListener("change", () => {
    state.orderForm[key] = select.value;
    if (key === "orderType" && select.value === "Market") state.orderForm.limitPrice = "MKT";
    if (key === "orderType" && select.value === "Limit") state.orderForm.limitPrice = state.data.quote.ask;
    renderRightPanel();
  });
  row.append(select);
  return row;
}

function fieldRow(label, value) {
  const row = el("div", "field-row");
  row.append(el("span", "", label));
  row.append(el("strong", "", value ?? "--"));
  return row;
}

function renderDock() {
  const tabs = document.querySelector(".dock-tabs");
  tabs.innerHTML = "";
  ["Positions", "Orders", "Fills", "Options Chain", "Audit", "Diagnostics"].forEach((tab) => {
    tabs.append(button(tab === state.activeDock ? "active" : "", tab, () => {
      state.activeDock = tab;
      renderDock();
    }));
  });

  const content = document.querySelector(".dock-content");
  content.innerHTML = "";
  if (state.activeDock === "Options Chain") renderOptionsDock(content);
  else if (state.activeDock === "Positions") renderArrayDock(content, ["Symbol", "Qty", "Average", "Last", "PnL"], state.data?.positions || [], (item) => [item.symbol, item.quantity, item.average, item.last, item.pnl], "No live positions are connected.");
  else if (state.activeDock === "Orders") renderArrayDock(content, ["ID", "Side", "Qty", "Type", "Status", "Price"], state.data?.orders || [], (item) => [item.id, item.side, item.quantity, item.type, item.status, item.price], "No broker orders are connected.");
  else if (state.activeDock === "Fills") renderArrayDock(content, ["ID", "Side", "Qty", "Price", "Time"], state.data?.fills || [], (item) => [item.id, item.side, item.quantity, item.price, item.time], "No broker fills are connected.");
  else if (state.activeDock === "Audit") renderAuditDock(content);
  else renderDiagnostics(content);
}

function renderOptionsDock(content) {
  if (!state.data) {
    content.append(emptyBlock("No symbol selected", "Options are unavailable until an IBKR quote is loaded."));
    return;
  }
  if (!state.data.optionsChain?.length) {
    content.append(emptyBlock("No IBKR options feed", "The app is not rendering synthetic option prices."));
    return;
  }
  const header = el("div", "chain-header");
  header.append(el("strong", "", `${state.data.symbol} ${state.data.lastPrice}`));
  header.append(el("span", "", "IBKR options feed"));
  content.append(header);
  content.append(simpleTable(
    ["Call Bid", "Call Ask", "Delta", "Strike", "Put Bid", "Put Ask", "Delta", "IV"],
    state.data.optionsChain.map((row) => [row.callBid, row.callAsk, row.callDelta, row.strike, row.putBid, row.putAsk, row.putDelta, row.iv]),
    3
  ));
}

function renderArrayDock(content, headers, rows, mapRow, emptyMessage) {
  if (!rows.length) {
    content.append(emptyBlock(emptyMessage, "This surface is wired, but no live records exist yet."));
    return;
  }
  content.append(simpleTable(headers, rows.map(mapRow)));
}

function renderAuditDock(content) {
  const rows = [];
  if (state.review) rows.push(["paper.review", state.review.status, state.review.timestamp]);
  state.activity.forEach((item) => rows.push(["activity", item.message, item.timestamp]));
  if (!rows.length) {
    content.append(emptyBlock("No audit events yet", "Symbol loads and paper reviews will appear here."));
    return;
  }
  content.append(simpleTable(["Event", "Detail", "Time"], rows));
}

function renderDiagnostics(content) {
  const list = el("div", "diagnostics-list");
  const rows = [
    `Adapter URL: ${adapterBaseUrl}`,
    `Settings DB: ${state.settings?.databasePath || "unavailable"}`,
    `Selected symbol: ${state.selectedSymbol || "none"}`,
    `Workspace: ${state.activeWorkspaceMode} | ${state.activeTimeframe} | ${state.activeRange}`,
  ];
  if (state.adapterStatus) rows.push(`Adapter status: ${state.adapterStatus.connectionState} - ${state.adapterStatus.message}`);
  if (state.data?.liveSource) rows.push(`IBKR source: ${state.data.liveSource.provider} fetched ${state.data.liveSource.fetchedAt}`);
  if (state.error) rows.push(`Last error: ${state.error}`);
  rows.forEach((item) => list.append(el("div", "diagnostic-row", item)));
  content.append(list);
}

function simpleTable(headers, rows, selectedColumn = -1) {
  const table = el("table", "data-table");
  const thead = el("thead");
  const tr = el("tr");
  headers.forEach((header) => tr.append(el("th", "", header)));
  thead.append(tr);
  const tbody = el("tbody");
  rows.forEach((row) => {
    const trBody = el("tr");
    row.forEach((cell, index) => {
      const td = el("td", index === selectedColumn ? "selected-cell" : "", String(cell));
      trBody.append(td);
    });
    tbody.append(trBody);
  });
  table.append(thead, tbody);
  return table;
}

function emptyBlock(title, detail) {
  const block = el("div", "empty-block");
  block.append(el("strong", "", title));
  block.append(el("span", "", detail));
  return block;
}

function render() {
  renderEmptySurface();
}

function bindControls() {
  document.querySelector(".symbol-search").addEventListener("submit", (event) => {
    event.preventDefault();
    selectSymbol(new FormData(event.currentTarget).get("symbol"));
  });
  document.querySelector('[data-action="refresh"]').addEventListener("click", () => refreshSelected());
  document.querySelector('[data-action="help"]').addEventListener("click", () => {
    state.activeDock = "Diagnostics";
    addActivity("Help opened diagnostics.");
    render();
  });
  document.querySelector('[data-action="settings"]').addEventListener("click", () => {
    state.activeDock = "Diagnostics";
    addActivity("Settings database details opened.");
    render();
  });
  document.querySelector('[data-action="add-watchlist"]').addEventListener("click", () => {
    document.querySelector(".symbol-search input").focus();
  });
  document.querySelector('[data-action="clear-activity"]').addEventListener("click", () => {
    state.activity = [];
    renderRail();
    renderDock();
  });
  document.querySelector('[data-action="review-paper"]').addEventListener("click", () => reviewPaper());
  document.querySelectorAll("[data-range]").forEach((range) => {
    range.addEventListener("click", async () => {
      await patchSettings({ activeRange: range.dataset.range });
      render();
    });
  });
  document.querySelectorAll("[data-chart-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const key = toggle.dataset.chartToggle;
      state.toolState[key] = !state.toolState[key];
      renderHeader();
      drawChart();
    });
  });
  document.querySelector('[title="Indicators"]').addEventListener("click", () => {
    state.toolState.indicators = !state.toolState.indicators;
    drawChart();
  });
  document.querySelector('[title="Draw"]').addEventListener("click", () => {
    state.toolState.markers = !state.toolState.markers;
    drawChart();
  });
  document.querySelector('[title="Add"]').addEventListener("click", () => {
    document.querySelector(".symbol-search input").focus();
  });
  document.querySelector('[title="Fullscreen"]').addEventListener("click", () => {
    state.toolState.fullscreen = !state.toolState.fullscreen;
    document.body.classList.toggle("chart-focus", state.toolState.fullscreen);
    drawChart();
  });
  window.addEventListener("resize", () => drawChart());
}

function reviewPaper() {
  if (!state.data) {
    state.error = "Load an IBKR symbol before generating a paper review.";
    render();
    return;
  }
  state.review = {
    id: `PR-${Date.now()}`,
    symbol: state.data.symbol,
    side: state.orderForm.side,
    quantity: state.orderForm.quantity,
    orderType: state.orderForm.orderType,
    limitPrice: state.orderForm.limitPrice,
    timestamp: new Date().toLocaleString(),
    status: "Local paper review generated; no broker order sent.",
  };
  state.activeRightTab = "Preview";
  state.activeDock = "Audit";
  addActivity(`Generated paper review for ${state.data.symbol}.`);
  render();
}

async function boot() {
  bindControls();
  render();
  try {
    await Promise.all([loadSettings(), fetchAdapterStatus().catch(() => null)]);
    render();
    if (state.selectedSymbol) {
      await selectSymbol(state.selectedSymbol, { persist: false, quiet: true });
    }
  } catch (error) {
    state.error = `${error.code || "startupFailed"}: ${error.message}`;
    render();
  } finally {
    window.resolveTradingWorkbenchReady(true);
  }
}

boot();
