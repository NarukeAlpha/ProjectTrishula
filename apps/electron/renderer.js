const state = {
  data: null,
  adapterStatus: null,
  activeDock: "Options Chain",
  activeRightTab: "Ticket",
};

window.tradingWorkbenchReady = new Promise((resolve) => {
  window.resolveTradingWorkbenchReady = resolve;
});

function moneyNumber(value) {
  if (typeof value === "number") return value;
  return Number.parseFloat(String(value).replace(/[$,]/g, ""));
}

function formatSigned(value) {
  return String(value).startsWith("-") ? "negative" : "positive";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function fetchAdapterStatus(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/v1/status`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch (_error) {
    return null;
  }
}

async function fetchLiveWorkbench(baseUrl, symbol) {
  try {
    const url = new URL("/v1/workbench/live", baseUrl);
    url.searchParams.set("symbol", symbol);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch (_error) {
    return null;
  }
}

function statusLabel(data) {
  if (data.adapter?.connectionState === "connected") {
    return {
      provider: data.adapter.providerState,
      freshness: data.adapter.freshness,
      adapter: data.adapter.adapterHealth,
      connection: data.adapter.connectionState,
      detail: data.adapter.externalEvidence,
    };
  }
  const status = state.adapterStatus;
  if (!status) {
    return {
      provider: data.adapter.providerState,
      freshness: data.adapter.freshness,
      adapter: data.adapter.adapterHealth,
      connection: "Disconnected",
      detail: "Rust adapter offline",
    };
  }
  const connected = status.connectionState === "connected";
  return {
    provider: connected ? "Rust Fixture" : data.adapter.providerState,
    freshness: status.serverTimeProvenance?.heartbeatStale ? "heartbeat stale" : data.adapter.freshness,
    adapter: connected ? "Adapter Healthy" : "Adapter Pending",
    connection: status.connectionState,
    detail: status.message,
  };
}

function renderTopbar(data) {
  const modes = document.querySelector(".mode-group");
  modes.innerHTML = "";
  data.workspaceModes.forEach((mode) => {
    const button = el("button", mode === data.activeWorkspaceMode ? "active" : "", mode);
    modes.appendChild(button);
  });

  const labels = statusLabel(data);
  const strip = document.querySelector(".status-strip");
  strip.innerHTML = "";
  [
    { label: labels.provider, value: labels.freshness, tone: "muted" },
    { label: data.adapter.paperState, value: data.orderTicket.account, tone: "green" },
    { label: data.adapter.rollback, value: "Live locked", tone: "blue" },
    { label: labels.adapter, value: labels.connection, tone: labels.connection === "connected" ? "green" : "orange" },
    { label: `Alerts ${data.adapter.alerts}`, value: data.adapter.externalEvidence, tone: "orange" },
  ].forEach((item) => {
    const card = el("div", `status-card ${item.tone}`);
    card.append(el("strong", "", item.label));
    card.append(el("span", "", item.value));
    strip.append(card);
  });
}

function renderRail(data) {
  const list = document.querySelector(".watchlist");
  list.innerHTML = "";
  data.watchlists.forEach((item) => {
    const row = el("button", `watch-row ${item.symbol === data.symbol ? "selected" : ""}`);
    const left = el("span");
    left.append(el("strong", "", item.symbol));
    left.append(el("small", "", item.name));
    const right = el("span", formatSigned(item.change));
    right.append(el("strong", "", item.last));
    right.append(el("small", "", `${item.changePercent} ${item.change}`));
    row.append(left, right);
    list.append(row);
  });

  const captures = document.querySelector(".capture-list");
  captures.innerHTML = "";
  data.captures.forEach((capture) => {
    const row = el("button", "capture-row");
    row.append(el("span", "", capture.name));
    row.append(el("small", "", capture.timestamp));
    captures.append(row);
  });
}

function renderHeader(data) {
  document.querySelector(".symbol").textContent = data.symbol;
  document.querySelector(".company").textContent = `${data.company} · ${data.venue}`;
  document.querySelector(".last-price").textContent = data.lastPrice;
  document.querySelector(".price-change").textContent = `${data.change} (${data.changePercent})`;

  const metrics = document.querySelector(".quote-metrics");
  metrics.innerHTML = "";
  [
    ["Bid", data.quote.bid],
    ["Ask", data.quote.ask],
    ["High", data.quote.high],
    ["Low", data.quote.low],
    ["Vol", data.quote.volume],
    ["Size", data.quote.size],
  ].forEach(([label, value]) => {
    const metric = el("div", "metric");
    metric.append(el("span", "", label));
    metric.append(el("strong", "", value));
    metrics.append(metric);
  });

  const timeframes = document.querySelector(".timeframes");
  timeframes.innerHTML = "";
  data.timeframes.forEach((timeframe) => {
    timeframes.append(el("button", timeframe === data.activeTimeframe ? "active" : "", timeframe));
  });
}

function drawChart(data) {
  const canvas = document.querySelector("#priceChart");
  const parent = canvas.parentElement.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(900, Math.floor(parent.width * ratio));
  canvas.height = Math.max(420, Math.floor(parent.height * ratio));
  canvas.style.width = `${parent.width}px`;
  canvas.style.height = `${parent.height}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const top = 18;
  const bottom = 72;
  const left = 14;
  const right = 64;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const prices = data.bars.flatMap((bar) => [bar.high, bar.low]).concat(data.levels.map((level) => level.price));
  const min = Math.min(...prices) - 4;
  const max = Math.max(...prices) + 4;
  const y = (price) => top + (max - price) / (max - min) * plotHeight;
  const x = (fraction) => left + fraction * plotWidth;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071012";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(116, 139, 148, 0.16)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i += 1) {
    const gy = top + (plotHeight / 9) * i;
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(width - right, gy);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i += 1) {
    const gx = left + (plotWidth / 11) * i;
    ctx.beginPath();
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, height - bottom + 18);
    ctx.stroke();
  }

  data.levels.forEach((level) => {
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
  });

  const candleWidth = Math.max(4, plotWidth / data.bars.length * 0.48);
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

  data.markers.forEach((marker) => {
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
  });

  ctx.fillStyle = "#8c9ba0";
  ctx.textAlign = "left";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(`${data.symbol} · ${data.activeTimeframe} · ${data.venue}`, left + 2, top + 16);
  ctx.fillStyle = "#33db6d";
  ctx.fillText(`O ${data.bars[0].open.toLocaleString()}  H ${max.toFixed(2)}  L ${min.toFixed(2)}  C ${data.lastPrice}`, left + 140, top + 16);
}

function renderRightPanel(data) {
  const tabs = document.querySelector(".right-tabs");
  tabs.innerHTML = "";
  ["Proposal", "Ticket", "Risk", "Preview"].forEach((tab) => {
    const button = el("button", tab === state.activeRightTab ? "active" : "", tab);
    button.addEventListener("click", () => {
      state.activeRightTab = tab;
      renderRightPanel(data);
    });
    tabs.append(button);
  });

  const panel = document.querySelector(".ticket-panel");
  panel.innerHTML = "";
  panel.append(el("h2", "", "Order Ticket / Risk Review"));
  const badge = el("span", "paper-badge", "Paper");
  panel.querySelector("h2").append(badge);

  if (state.activeRightTab === "Ticket" || state.activeRightTab === "Proposal") {
    [
      ["Side", data.orderTicket.side],
      ["Quantity", String(data.orderTicket.quantity)],
      ["Order Type", data.orderTicket.orderType],
      ["Limit Price", data.orderTicket.limitPrice],
      ["Time in Force", data.orderTicket.timeInForce],
      ["Account", data.orderTicket.account],
      ["Quote Age", data.orderTicket.quoteAge],
      ["Est. Fill", data.orderTicket.estimatedFill],
    ].forEach(([label, value]) => panel.append(fieldRow(label, value)));
  }

  const risk = el("section", "risk-summary");
  risk.append(el("h3", "", "Risk Summary"));
  [
    ["Max Loss (Stop)", data.risk.maxLoss, "negative"],
    ["Max Gain (T1)", data.risk.maxGain, "positive"],
    ["Risk / Reward", data.risk.rewardRisk],
    ["Prob. of Profit", data.risk.probability],
    ["Delta (Net)", data.risk.deltaNet],
    ["Theta (Daily)", data.risk.thetaDaily],
    ["Buying Power Impact", data.risk.buyingPower],
    ["Margin Impact", data.risk.marginImpact],
  ].forEach(([label, value, tone]) => {
    const row = fieldRow(label, value);
    if (tone) row.classList.add(tone);
    risk.append(row);
  });
  panel.append(risk);

  data.risk.warnings.forEach((warning) => {
    const warningNode = el("div", "warning-card", warning);
    panel.append(warningNode);
  });
  panel.append(el("div", "broker-preview", `Broker Preview · ${data.orderTicket.route} · ${data.orderTicket.venue}`));
}

function fieldRow(label, value) {
  const row = el("div", "field-row");
  row.append(el("span", "", label));
  row.append(el("strong", "", value));
  return row;
}

function renderDock(data) {
  const tabs = document.querySelector(".dock-tabs");
  tabs.innerHTML = "";
  ["Positions", "Orders", "Fills", "Options Chain", "Audit", "Diagnostics"].forEach((tab) => {
    const button = el("button", tab === state.activeDock ? "active" : "", tab);
    button.addEventListener("click", () => {
      state.activeDock = tab;
      renderDock(data);
    });
    tabs.append(button);
  });

  const content = document.querySelector(".dock-content");
  content.innerHTML = "";
  if (state.activeDock === "Options Chain") {
    const header = el("div", "chain-header");
    header.append(el("strong", "", `${data.symbol} ${data.lastPrice} ${data.change} (${data.changePercent})`));
    header.append(el("span", "", "Chain · IV Rank 48 · IV 53.2% · DTE 28 · Jul 19, 2024 · Strikes 9"));
    content.append(header);
    content.append(renderOptionsTable(data));
  } else if (state.activeDock === "Positions") {
    content.append(simpleTable(["Symbol", "Qty", "Average", "Last", "PnL"], data.positions.map((item) => [item.symbol, item.quantity, item.average, item.last, item.pnl])));
  } else if (state.activeDock === "Orders") {
    content.append(simpleTable(["ID", "Side", "Qty", "Type", "Status", "Price"], data.orders.map((item) => [item.id, item.side, item.quantity, item.type, item.status, item.price])));
  } else if (state.activeDock === "Fills") {
    content.append(simpleTable(["ID", "Side", "Qty", "Price", "Time"], data.fills.map((item) => [item.id, item.side, item.quantity, item.price, item.time])));
  } else if (state.activeDock === "Audit") {
    content.append(simpleTable(["Event", "Status"], [["preview.route", "accepted"], ["paper.review", "waiting"], ["live.gate", "locked"]]));
  } else {
    const list = el("div", "diagnostics-list", "");
    data.diagnostics.forEach((item) => list.append(el("div", "diagnostic-row", item)));
    content.append(list);
  }
}

function renderOptionsTable(data) {
  return simpleTable(
    ["Call Bid", "Call Ask", "Delta", "Strike", "Put Bid", "Put Ask", "Delta", "IV"],
    data.optionsChain.map((row) => [row.callBid, row.callAsk, row.callDelta, row.strike, row.putBid, row.putAsk, row.putDelta, row.iv]),
    3
  );
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

function render(data) {
  renderTopbar(data);
  renderRail(data);
  renderHeader(data);
  renderRightPanel(data);
  renderDock(data);
  drawChart(data);
}

async function boot() {
  const fallbackData = JSON.parse(await window.tradingBridge.readSharedData());
  const liveData = await fetchLiveWorkbench(window.tradingBridge.adapterBaseUrl, fallbackData.symbol || "NVDA");
  const data = liveData || {
    ...fallbackData,
    adapter: {
      ...fallbackData.adapter,
      providerState: "Fixture Fallback",
      freshness: "backend live route unavailable",
      adapterHealth: "Backend Offline",
      externalEvidence: "Live backend fetch failed",
    },
  };
  state.data = data;
  state.adapterStatus = await fetchAdapterStatus(window.tradingBridge.adapterBaseUrl);
  render(data);
  window.addEventListener("resize", () => drawChart(data));
  window.resolveTradingWorkbenchReady(true);
}

boot();
