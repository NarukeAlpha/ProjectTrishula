const { contextBridge } = require("electron");

function adapterBaseUrl() {
  const arg = process.argv.find((item) => item.startsWith("--adapter-base-url="));
  if (!arg) {
    return "http://127.0.0.1:8765";
  }
  return arg.slice("--adapter-base-url=".length);
}

contextBridge.exposeInMainWorld("tradingBridge", {
  adapterBaseUrl: adapterBaseUrl(),
});
