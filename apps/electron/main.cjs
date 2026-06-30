const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const args = {
    snapshot: null,
    width: 1586,
    height: 992,
    adapterBaseUrl: process.env.TRADING_ADAPTER_BASE_URL || "http://127.0.0.1:8765",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--snapshot") {
      args.snapshot = argv[index + 1] || null;
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

function createWindow(options) {
  return new BrowserWindow({
    width: options.width,
    height: options.height,
    minWidth: 1200,
    minHeight: 850,
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

ipcMain.handle("trading:read-shared-data", async () => {
  const jsonPath = path.join(repoRoot, "frontend/shared/workbench-data.json");
  return fs.readFile(jsonPath, "utf8");
});

app.whenReady().then(async () => {
  const args = parseArgs(process.argv.slice(2));
  const window = createWindow({
    width: args.width,
    height: args.height,
    show: !args.snapshot,
    adapterBaseUrl: args.adapterBaseUrl,
  });

  await window.loadFile(path.join(__dirname, "index.html"));

  if (args.snapshot) {
    await window.webContents.executeJavaScript("window.tradingWorkbenchReady", true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await window.webContents.capturePage();
    await fs.mkdir(path.dirname(args.snapshot), { recursive: true });
    await fs.writeFile(args.snapshot, image.toPNG());
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
