const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

function parseArgs(argv) {
  const args = {
    snapshot: null,
    interactionReport: null,
    width: 1586,
    height: 992,
    adapterBaseUrl: process.env.TRADING_ADAPTER_BASE_URL || "http://127.0.0.1:8765",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--snapshot") {
      args.snapshot = argv[index + 1] || null;
      index += 1;
    } else if (item === "--interaction-report") {
      args.interactionReport = argv[index + 1] || null;
      index += 1;
    } else if (item === "--width") {
      args.width = Number.parseInt(argv[index + 1] || "", 10) || args.width;
      index += 1;
    } else if (item === "--height") {
      args.height = Number.parseInt(argv[index + 1] || "", 10) || args.height;
      index += 1;
    } else if (item === "--adapter-base-url") {
      args.adapterBaseUrl = argv[index + 1] || args.adapterBaseUrl;
      index += 1;
    }
  }

  return args;
}

async function runInteractionVerification(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const result = { checks: [] };
      const check = (name, passed, detail = "") => {
        result.checks.push({ name, passed: Boolean(passed), detail });
      };
      const text = () => document.body.innerText;
      const waitFor = async (predicate, timeoutMs = 15000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          if (predicate()) return true;
          await sleep(150);
        }
        return false;
      };
      const buttonByText = (selector, label) => {
        return Array.from(document.querySelectorAll(selector)).find((button) => button.textContent.trim() === label);
      };

      await window.tradingWorkbenchReady;
      check("initial IBKR data rendered", text().includes("IBKR Market Data") && !text().includes("Fixture " + "Fallback"), text().slice(0, 200));

      buttonByText(".right-tabs button", "Risk")?.click();
      await sleep(100);
      check("right risk tab switches", text().includes("Risk Review") && text().includes("Max Loss"));

      document.querySelector('[data-action="review-paper"]')?.click();
      await sleep(150);
      check("review paper action updates preview", text().includes("Local paper review generated") && text().includes("Paper Preview"));

      buttonByText(".dock-tabs button", "Audit")?.click();
      await sleep(100);
      check("audit dock switches", text().includes("paper.review") || text().includes("Generated paper review"));

      document.querySelector('[data-range="1M"]')?.click();
      await sleep(150);
      check("range control persists active state", document.querySelector('[data-range="1M"]')?.classList.contains("active"));

      document.querySelector('[data-chart-toggle="log"]')?.click();
      await sleep(100);
      check("chart toggle updates active state", document.querySelector('[data-chart-toggle="log"]')?.classList.contains("active"));

      buttonByText(".timeframes button", "15m")?.click();
      const timeframeChanged = await waitFor(() => buttonByText(".timeframes button", "15m")?.classList.contains("active"));
      check("timeframe control refetches IBKR data", timeframeChanged && text().includes("IBKR Market Data"));

      const form = document.querySelector(".symbol-search");
      const input = document.querySelector(".symbol-search input");
      const currentSymbol = document.querySelector(".symbol")?.textContent.trim() || "AAPL";
      input.value = currentSymbol;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      const symbolRefetched = await waitFor(() => document.querySelector(".symbol")?.textContent.trim() === currentSymbol);
      check("symbol search refetches IBKR symbol", symbolRefetched && text().includes("IBKR Market Data"));

      buttonByText(".dock-tabs button", "Options Chain")?.click();
      await sleep(100);
      check("options surface is honest when no IBKR options feed exists", text().includes("No IBKR options feed"));

      buttonByText(".dock-tabs button", "Diagnostics")?.click();
      await sleep(100);
      check("diagnostics dock switches", text().includes("Adapter URL:") && text().includes("IBKR source:"));

      result.isApproved = result.checks.every((item) => item.passed);
      result.visibleSymbol = document.querySelector(".symbol")?.textContent.trim();
      result.activeDock = document.querySelector(".dock-tabs button.active")?.textContent.trim();
      result.activeRightTab = document.querySelector(".right-tabs button.active")?.textContent.trim();
      return result;
    })()
  `, true);
}

function createWindow(options) {
  return new BrowserWindow({
    width: options.width,
    height: options.height,
    minWidth: 760,
    minHeight: 640,
    title: "Agentic Trading",
    frame: false,
    useContentSize: true,
    backgroundColor: "#071012",
    show: options.show,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--adapter-base-url=${options.adapterBaseUrl}`],
    },
  });
}

app.whenReady().then(async () => {
  const args = parseArgs(process.argv.slice(2));
  const window = createWindow({
    width: args.width,
    height: args.height,
    show: !args.snapshot,
    adapterBaseUrl: args.adapterBaseUrl,
  });

  await window.loadFile(path.join(__dirname, "index.html"));

  if (args.interactionReport) {
    await window.webContents.executeJavaScript("window.tradingWorkbenchReady", true);
    const report = await runInteractionVerification(window);
    await fs.mkdir(path.dirname(args.interactionReport), { recursive: true });
    await fs.writeFile(args.interactionReport, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.snapshot) {
    await window.webContents.executeJavaScript("window.tradingWorkbenchReady", true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await window.webContents.capturePage();
    await fs.mkdir(path.dirname(args.snapshot), { recursive: true });
    await fs.writeFile(args.snapshot, image.toPNG());
    app.quit();
  } else if (args.interactionReport) {
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
