import AppKit
import Foundation
import SwiftUI

private final class ResponseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var payload: Data?

    func store(_ data: Data?) {
        lock.lock()
        payload = data
        lock.unlock()
    }

    func load() -> Data? {
        lock.lock()
        let data = payload
        lock.unlock()
        return data
    }
}

private struct WorkbenchData: Decodable {
    let workspaceModes: [String]
    let activeWorkspaceMode: String
    let symbol: String
    let company: String
    let venue: String
    let lastPrice: String
    let change: String
    let changePercent: String
    let quote: QuoteData
    let adapter: AdapterData
    let watchlists: [WatchItem]
    let captures: [CaptureItem]
    let activeTimeframe: String
    let bars: [Bar]
    let levels: [PriceLevel]
    let orderTicket: OrderTicket
    let risk: RiskData
    let optionsChain: [OptionRow]
    let diagnostics: [String]
    let liveSource: LiveSource?

    static func load(adapterBaseURL: String?) -> WorkbenchData {
        let baseURL = adapterBaseURL
            ?? ProcessInfo.processInfo.environment["TRADING_ADAPTER_BASE_URL"]
            ?? "http://127.0.0.1:8765"
        guard var components = URLComponents(string: "\(baseURL)/v1/workbench/live") else {
            return Seed.workbench
        }
        components.queryItems = [URLQueryItem(name: "symbol", value: "NVDA")]
        guard let url = components.url else {
            return Seed.workbench
        }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 5

        let responseBox = ResponseBox()
        let semaphore = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                responseBox.store(data)
            }
            semaphore.signal()
        }
        task.resume()
        guard semaphore.wait(timeout: .now() + 6) == .success,
              let loadedData = responseBox.load(),
              let decoded = try? JSONDecoder().decode(WorkbenchData.self, from: loadedData)
        else {
            task.cancel()
            return Seed.workbench
        }
        return decoded
    }
}

private struct QuoteData: Decodable {
    let bid: String
    let ask: String
    let high: String
    let low: String
    let volume: String
    let size: String
}

private struct AdapterData: Decodable {
    let connectionState: String
    let providerState: String
    let freshness: String
    let paperState: String
    let rollback: String
    let adapterHealth: String
    let alerts: Int
    let externalEvidence: String
}

private struct LiveSource: Decodable {
    let provider: String
    let fetchedAt: String
    let regularMarketTime: String
    let barCount: Int
}

private struct OrderTicket: Decodable {
    let side: String
    let quantity: Int
    let orderType: String
    let limitPrice: String
    let timeInForce: String
    let account: String
    let estimatedFill: String
    let route: String
    let venue: String
}

private struct RiskData: Decodable {
    let maxLoss: String
    let maxGain: String
    let rewardRisk: String
    let probability: String
    let deltaNet: String
    let thetaDaily: String
    let buyingPower: String
    let warnings: [String]
}

private struct WatchItem: Decodable, Identifiable {
    let id = UUID()
    let symbol: String
    let name: String
    let last: String
    let change: String
    let isPositive: Bool?

    var positive: Bool {
        isPositive ?? !change.hasPrefix("-")
    }

    private enum CodingKeys: String, CodingKey {
        case symbol
        case name
        case last
        case change
        case isPositive
    }

    init(symbol: String, name: String, last: String, change: String, isPositive: Bool) {
        self.symbol = symbol
        self.name = name
        self.last = last
        self.change = change
        self.isPositive = isPositive
    }
}

private struct CaptureItem: Decodable, Identifiable {
    let id = UUID()
    let name: String
    let timestamp: String

    var time: String { timestamp }

    init(name: String, timestamp: String) {
        self.name = name
        self.timestamp = timestamp
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case timestamp
    }
}

private struct Bar: Decodable, Identifiable {
    let id = UUID()
    let x: Double
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double

    private enum CodingKeys: String, CodingKey {
        case x
        case open
        case high
        case low
        case close
        case volume
    }
}

private struct PriceLevel: Decodable, Identifiable {
    let id: String
    let label: String
    let price: Double
    let kind: String

    var color: Color {
        switch kind {
        case "target":
            .green
        case "ask":
            .blue
        case "bid", "stop":
            .red
        default:
            .gray
        }
    }
}

private struct OptionRow: Decodable, Identifiable {
    let id = UUID()
    let callBid: String
    let callAsk: String
    let callDelta: String
    let strike: String
    let putBid: String
    let putAsk: String
    let putDelta: String
    let iv: String

    private enum CodingKeys: String, CodingKey {
        case callBid
        case callAsk
        case callDelta
        case strike
        case putBid
        case putAsk
        case putDelta
        case iv
    }
}

private enum Seed {
    static let watchlist: [WatchItem] = [
        WatchItem(symbol: "AAPL", name: "Apple Inc.", last: "195.72", change: "+0.78%", isPositive: true),
        WatchItem(symbol: "MSFT", name: "Microsoft Corp.", last: "420.41", change: "-0.24%", isPositive: false),
        WatchItem(symbol: "NVDA", name: "NVIDIA Corp.", last: "1,213.49", change: "+1.65%", isPositive: true),
        WatchItem(symbol: "AMZN", name: "Amazon.com, Inc.", last: "186.31", change: "+0.08%", isPositive: true),
        WatchItem(symbol: "GOOGL", name: "Alphabet Inc.", last: "171.68", change: "-0.42%", isPositive: false),
        WatchItem(symbol: "META", name: "Meta Platforms", last: "493.07", change: "+0.62%", isPositive: true),
        WatchItem(symbol: "TSLA", name: "Tesla, Inc.", last: "178.83", change: "-1.25%", isPositive: false),
        WatchItem(symbol: "AMD", name: "AMD", last: "166.18", change: "+1.31%", isPositive: true),
        WatchItem(symbol: "NFLX", name: "Netflix, Inc.", last: "652.21", change: "-0.10%", isPositive: false),
        WatchItem(symbol: "AVGO", name: "Broadcom Inc.", last: "1,653.24", change: "+0.93%", isPositive: true)
    ]

    static let captures: [CaptureItem] = [
        CaptureItem(name: "Bull Call Spread NVDA", timestamp: "Jun 25, 10:34 AM"),
        CaptureItem(name: "Earnings Playbook", timestamp: "Jun 20, 4:12 PM"),
        CaptureItem(name: "0DTE Gamma Fade", timestamp: "Jun 19, 11:07 AM"),
        CaptureItem(name: "Meta Breakout Setup", timestamp: "Jun 17, 9:42 AM"),
        CaptureItem(name: "Tesla Put Hedge", timestamp: "Jun 16, 3:21 PM")
    ]

    static let bars: [Bar] = [
        Bar(x: 0.00, open: 1182.00, high: 1190.00, low: 1178.00, close: 1187.50, volume: 210),
        Bar(x: 0.03, open: 1187.50, high: 1194.00, low: 1184.50, close: 1192.60, volume: 225),
        Bar(x: 0.06, open: 1192.60, high: 1199.20, low: 1190.20, close: 1197.80, volume: 240),
        Bar(x: 0.09, open: 1197.80, high: 1201.40, low: 1191.10, close: 1193.20, volume: 220),
        Bar(x: 0.12, open: 1193.20, high: 1203.20, low: 1188.20, close: 1201.25, volume: 300),
        Bar(x: 0.15, open: 1201.25, high: 1208.00, low: 1198.00, close: 1206.40, volume: 320),
        Bar(x: 0.18, open: 1206.40, high: 1215.20, low: 1204.00, close: 1212.10, volume: 360),
        Bar(x: 0.21, open: 1212.10, high: 1218.20, low: 1208.00, close: 1214.60, volume: 340),
        Bar(x: 0.24, open: 1214.60, high: 1217.00, low: 1209.40, close: 1210.31, volume: 310),
        Bar(x: 0.27, open: 1210.31, high: 1219.40, low: 1207.70, close: 1218.80, volume: 380),
        Bar(x: 0.30, open: 1218.80, high: 1223.80, low: 1215.20, close: 1221.10, volume: 390),
        Bar(x: 0.33, open: 1221.10, high: 1225.20, low: 1218.00, close: 1224.20, volume: 420),
        Bar(x: 0.36, open: 1224.20, high: 1228.60, low: 1220.30, close: 1226.75, volume: 470),
        Bar(x: 0.39, open: 1226.75, high: 1229.50, low: 1222.00, close: 1223.60, volume: 440),
        Bar(x: 0.42, open: 1223.60, high: 1227.00, low: 1218.80, close: 1219.20, volume: 410),
        Bar(x: 0.45, open: 1219.20, high: 1221.00, low: 1210.40, close: 1212.60, volume: 500),
        Bar(x: 0.48, open: 1212.60, high: 1218.20, low: 1208.60, close: 1216.40, volume: 430),
        Bar(x: 0.51, open: 1216.40, high: 1222.30, low: 1212.10, close: 1220.80, volume: 410),
        Bar(x: 0.54, open: 1220.80, high: 1223.00, low: 1214.40, close: 1217.60, volume: 460),
        Bar(x: 0.57, open: 1217.60, high: 1221.70, low: 1210.20, close: 1213.40, volume: 490),
        Bar(x: 0.60, open: 1213.40, high: 1217.20, low: 1204.60, close: 1208.30, volume: 530),
        Bar(x: 0.63, open: 1208.30, high: 1214.80, low: 1205.90, close: 1212.90, volume: 450),
        Bar(x: 0.66, open: 1212.90, high: 1220.10, low: 1210.60, close: 1218.80, volume: 470),
        Bar(x: 0.69, open: 1218.80, high: 1225.80, low: 1216.60, close: 1224.60, volume: 520),
        Bar(x: 0.72, open: 1224.60, high: 1228.90, low: 1219.90, close: 1222.10, volume: 500),
        Bar(x: 0.75, open: 1222.10, high: 1224.20, low: 1215.30, close: 1218.90, volume: 480),
        Bar(x: 0.78, open: 1218.90, high: 1226.70, low: 1216.20, close: 1225.80, volume: 550),
        Bar(x: 0.81, open: 1225.80, high: 1230.20, low: 1221.30, close: 1228.10, volume: 620),
        Bar(x: 0.84, open: 1228.10, high: 1232.50, low: 1220.20, close: 1221.60, volume: 680),
        Bar(x: 0.87, open: 1221.60, high: 1225.80, low: 1202.70, close: 1208.40, volume: 720),
        Bar(x: 0.90, open: 1208.40, high: 1215.30, low: 1199.50, close: 1206.80, volume: 570),
        Bar(x: 0.93, open: 1206.80, high: 1217.80, low: 1204.20, close: 1214.20, volume: 510),
        Bar(x: 0.96, open: 1214.20, high: 1220.00, low: 1209.30, close: 1217.90, volume: 540),
        Bar(x: 0.99, open: 1217.90, high: 1221.80, low: 1210.00, close: 1213.49, volume: 515)
    ]

    static let levels: [PriceLevel] = [
        PriceLevel(id: "target1", label: "Target 1 1,250.00", price: 1250.00, kind: "target"),
        PriceLevel(id: "target2", label: "Target 2 1,240.00", price: 1240.00, kind: "target"),
        PriceLevel(id: "ask", label: "Ask 1,213.58", price: 1213.58, kind: "ask"),
        PriceLevel(id: "bid", label: "Bid 1,213.34", price: 1213.34, kind: "bid"),
        PriceLevel(id: "stop", label: "Stop 1 1,186.00", price: 1186.00, kind: "stop"),
        PriceLevel(id: "invalid", label: "Invalidation 1,168.00", price: 1168.00, kind: "invalidation")
    ]

    static let chain: [OptionRow] = [
        OptionRow(callBid: "48.25", callAsk: "48.75", callDelta: "0.81", strike: "1,150", putBid: "7.85", putAsk: "8.20", putDelta: "-0.19", iv: "55.0%"),
        OptionRow(callBid: "61.15", callAsk: "61.65", callDelta: "0.70", strike: "1,175", putBid: "10.45", putAsk: "10.85", putDelta: "-0.30", iv: "54.1%"),
        OptionRow(callBid: "74.40", callAsk: "74.90", callDelta: "0.58", strike: "1,200", putBid: "13.75", putAsk: "14.15", putDelta: "-0.42", iv: "53.3%"),
        OptionRow(callBid: "88.30", callAsk: "88.80", callDelta: "0.46", strike: "1,225", putBid: "18.05", putAsk: "18.55", putDelta: "-0.54", iv: "52.4%"),
        OptionRow(callBid: "104.10", callAsk: "104.60", callDelta: "0.34", strike: "1,250", putBid: "23.25", putAsk: "23.80", putDelta: "-0.66", iv: "51.6%"),
        OptionRow(callBid: "121.30", callAsk: "121.80", callDelta: "0.24", strike: "1,275", putBid: "29.35", putAsk: "29.95", putDelta: "-0.76", iv: "50.8%"),
        OptionRow(callBid: "139.80", callAsk: "140.30", callDelta: "0.16", strike: "1,300", putBid: "36.30", putAsk: "36.90", putDelta: "-0.84", iv: "49.9%")
    ]

    static let workbench = WorkbenchData(
        workspaceModes: ["Research", "Paper", "Live Review"],
        activeWorkspaceMode: "Paper",
        symbol: "NVDA",
        company: "NVIDIA Corp.",
        venue: "NASDAQ",
        lastPrice: "1,213.49",
        change: "+19.71",
        changePercent: "+1.65%",
        quote: QuoteData(
            bid: "1,213.34",
            ask: "1,213.58",
            high: "1,227.88",
            low: "1,192.21",
            volume: "42.53M",
            size: "100"
        ),
        adapter: AdapterData(
            connectionState: "fallback",
            providerState: "Fixture Fallback",
            freshness: "backend live route unavailable",
            paperState: "Paper Ready",
            rollback: "Rollback Active",
            adapterHealth: "Backend Offline",
            alerts: 2,
            externalEvidence: "Live backend fetch failed"
        ),
        watchlists: watchlist,
        captures: captures,
        activeTimeframe: "15m",
        bars: bars,
        levels: levels,
        orderTicket: OrderTicket(
            side: "Buy",
            quantity: 4,
            orderType: "Limit",
            limitPrice: "1,232.50",
            timeInForce: "Day",
            account: "Paper (trader.research)",
            estimatedFill: "4 @ 1,232.50",
            route: "SMART",
            venue: "NASDAQ (ARCA)"
        ),
        risk: RiskData(
            maxLoss: "$ -66.00 (-0.54%)",
            maxGain: "$ +124.00 (+1.02%)",
            rewardRisk: "1 : 1.88",
            probability: "62.1%",
            deltaNet: "0.42",
            thetaDaily: "-4.12",
            buyingPower: "$ 4,930.00",
            warnings: [
                "Stop is inside 1.5x ATR (28.42).",
                "Reduced reward vs. historical setup avg.",
                "Price outside NBBO by $0.08 (1 tick)."
            ]
        ),
        optionsChain: chain,
        diagnostics: [
            "Fixture fallback: Rust backend live route unavailable",
            "Run the Rust adapter on 127.0.0.1:8765",
            "Snapshot still renders but is not approved as live"
        ],
        liveSource: nil
    )
}

private struct TradingWorkbenchView: View {
    let data: WorkbenchData
    @State private var activeDock = "Options Chain"
    @State private var activeRightTab = "Ticket"

    var body: some View {
        GeometryReader { proxy in
            let availableWidth = proxy.size.width - 12
            let availableHeight = max(0, proxy.size.height - 96)
            let leftWidth: CGFloat = 286
            let rightWidth: CGFloat = 326
            let centerWidth = max(560, availableWidth - leftWidth - rightWidth - 12)
            VStack(spacing: 0) {
                topBar
                    .frame(width: proxy.size.width)
                HStack(spacing: 6) {
                    leftRail
                        .frame(width: leftWidth)
                    marketWorkspace
                        .frame(width: centerWidth)
                    rightPanel
                        .frame(width: rightWidth)
                }
                .frame(width: availableWidth, height: availableHeight)
                .padding(6)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(minWidth: 1200, minHeight: 850)
        .background(Color(red: 0.027, green: 0.063, blue: 0.071))
    }

    private var topBar: some View {
        VStack(spacing: 0) {
            ZStack {
                HStack(spacing: 8) {
                    Circle().fill(Color(red: 1.0, green: 0.37, blue: 0.34)).frame(width: 12, height: 12)
                    Circle().fill(Color(red: 1.0, green: 0.74, blue: 0.18)).frame(width: 12, height: 12)
                    Circle().fill(Color(red: 0.16, green: 0.78, blue: 0.25)).frame(width: 12, height: 12)
                    Spacer()
                }
                Text("Agentic Trading")
                    .foregroundStyle(.secondary)
                    .font(.system(size: 13, weight: .medium))
            }
            .frame(height: 32)
            .padding(.horizontal, 14)

            HStack(spacing: 12) {
                segmented(data.workspaceModes, selected: data.activeWorkspaceMode)
                    .frame(width: 326)
                Spacer(minLength: 8)
                statusChip(data.adapter.providerState, data.adapter.freshness, .green)
                statusChip(data.adapter.paperState, "Paper account", .green)
                statusChip(data.adapter.rollback, "Live locked", .blue)
                statusChip(data.adapter.adapterHealth, data.adapter.connectionState, .green)
                statusChip("Alerts \(data.adapter.alerts)", data.adapter.externalEvidence, .orange)
                Spacer(minLength: 8)
                circleButton("⌕")
                circleButton("?")
                circleButton("⚙")
            }
            .padding(.horizontal, 10)
            .frame(height: 52)
        }
        .background(Color(red: 0.039, green: 0.071, blue: 0.082))
        .overlay(alignment: .bottom) { Divider().background(lineColor) }
        .accessibilityIdentifier("workbench.topAppBar")
    }

    private var leftRail: some View {
        VStack(spacing: 0) {
            railSection(title: "Watchlists") {
                HStack {
                    Text("Tech Leaders")
                    Spacer()
                    Text("⌄")
                }
                .frame(height: 28)
                .padding(.horizontal, 8)
                .background(Color(red: 0.06, green: 0.095, blue: 0.108))
                .clipShape(RoundedRectangle(cornerRadius: 5))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(lineColor))
                ForEach(data.watchlists) { item in
                    HStack(spacing: 6) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.symbol).fontWeight(.semibold)
                            Text(item.name).foregroundStyle(.secondary).font(.caption2)
                        }
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(item.last)
                            Text(item.change)
                                .foregroundStyle(item.positive ? Color.green : Color.red)
                                .font(.caption2)
                        }
                        .lineLimit(1)
                        .font(.system(size: 10, weight: .semibold))
                        .minimumScaleFactor(0.65)
                        .frame(width: 68, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 5)
                    .background(item.symbol == data.symbol ? Color.green.opacity(0.12) : .clear)
                }
            }
            railSection(title: "Saved Captures") {
                ForEach(data.captures) { capture in
                    HStack(spacing: 6) {
                        Text(capture.name).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(capture.time).foregroundStyle(.secondary).font(.caption2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                            .frame(width: 96, alignment: .trailing)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                Text("Show more (6)")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
            }
            HStack(spacing: 10) {
                Text("TR")
                    .frame(width: 34, height: 34)
                    .background(Color.blue.opacity(0.3))
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("trader.research")
                    Text("Paper · $250,000.00").foregroundStyle(.green).font(.caption2)
                }
                Spacer()
            }
            .padding(10)
        }
        .background(panelColor)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(lineColor))
        .accessibilityIdentifier("workbench.leftRail")
    }

    private var marketWorkspace: some View {
        VStack(spacing: 0) {
            quoteHeader
            chartToolbar
            ChartCanvas(data: data)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(red: 0.027, green: 0.063, blue: 0.071))
            HStack(spacing: 14) {
                ForEach(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"], id: \.self) { Text($0) }
                Spacer()
                Text("10:51:38 ET")
                Text("%")
                Text("log")
                Text("auto")
            }
            .foregroundStyle(.secondary)
            .font(.caption)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .overlay(alignment: .top) { Divider().background(lineColor) }
            bottomDock
                .frame(height: 352)
        }
        .background(panelColor)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(lineColor))
        .accessibilityIdentifier("workbench.marketWorkspace")
    }

    private var quoteHeader: some View {
        HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(data.symbol).font(.system(size: 22, weight: .bold))
                    Text("★").foregroundStyle(.yellow)
                    Text("ⓘ").foregroundStyle(.secondary)
                }
                Text("\(data.company) · \(data.venue)").foregroundStyle(.secondary)
            }
            .frame(width: 150, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(data.lastPrice).font(.system(size: 26, weight: .bold)).foregroundStyle(.green)
                Text("\(data.change) (\(data.changePercent))").foregroundStyle(data.change.hasPrefix("-") ? .red : .green).fontWeight(.semibold)
            }
            .frame(width: 150, alignment: .leading)
            metric("Bid", data.quote.bid)
            metric("Ask", data.quote.ask)
            metric("High", data.quote.high)
            metric("Low", data.quote.low)
            metric("Vol", data.quote.volume)
            metric("Size", data.quote.size)
            Spacer()
        }
        .padding(.horizontal, 14)
        .frame(height: 70)
        .overlay(alignment: .bottom) { Divider().background(lineColor) }
    }

    private var chartToolbar: some View {
        HStack {
            segmented(["1m", "5m", "15m", "1h", "4h", "D", "W"], selected: data.activeTimeframe)
                .frame(width: 280)
            Spacer()
            Text("ƒx Indicators")
            Text("Draw")
            Text("+")
                .frame(width: 28, height: 24)
                .background(Color.blue.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 5))
            Text("⛶")
        }
        .font(.caption)
        .padding(.horizontal, 14)
        .frame(height: 36)
        .overlay(alignment: .bottom) { Divider().background(lineColor) }
    }

    private var bottomDock: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                ForEach(["Positions", "Orders", "Fills", "Options Chain", "Audit", "Diagnostics"], id: \.self) { tab in
                    Button(tab) { activeDock = tab }
                        .buttonStyle(TabButtonStyle(active: activeDock == tab))
                }
                Spacer()
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .overlay(alignment: .bottom) { Divider().background(lineColor) }
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("\(data.symbol)  \(data.lastPrice)  \(data.change) (\(data.changePercent))").foregroundStyle(data.change.hasPrefix("-") ? .red : .green).fontWeight(.semibold)
                    Spacer()
                    Text("Chain · backend derived · Strikes \(data.optionsChain.count)")
                        .foregroundStyle(.secondary)
                }
                optionTable
                HStack {
                    Text("Selected Strategy: Long Call Vertical")
                    Text("Live underlying \(data.lastPrice)")
                    Text("Limit \(data.orderTicket.limitPrice)")
                    Spacer()
                    Text("Max Risk \(data.risk.maxLoss)")
                    Text("Max Gain \(data.risk.maxGain)")
                    Text("POP \(data.risk.probability)")
                    Text("Source \(data.liveSource?.provider ?? "fixture")")
                }
                .foregroundStyle(.secondary)
                .font(.caption2)
            }
            .padding(12)
        }
        .background(Color(red: 0.055, green: 0.094, blue: 0.106))
        .accessibilityIdentifier("workbench.bottomDock")
    }

    private var optionTable: some View {
        Grid(horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(["Call Bid", "Call Ask", "Delta", "Strike", "Put Bid", "Put Ask", "Delta", "IV"], id: \.self) {
                    Text($0).gridCell()
                }
            }
            ForEach(data.optionsChain) { row in
                GridRow {
                    Text(row.callBid).foregroundStyle(.green).gridCell()
                    Text(row.callAsk).foregroundStyle(.green).gridCell()
                    Text(row.callDelta).foregroundStyle(.green.opacity(0.9)).gridCell()
                    Text(row.strike).gridCell(highlight: row.strike == "1,225")
                    Text(row.putBid).foregroundStyle(.orange).gridCell()
                    Text(row.putAsk).foregroundStyle(.orange).gridCell()
                    Text(row.putDelta).foregroundStyle(.red.opacity(0.9)).gridCell()
                    Text(row.iv).foregroundStyle(.blue).gridCell()
                }
            }
        }
        .font(.system(size: 12, design: .monospaced))
    }

    private var rightPanel: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                ForEach(["Proposal", "Ticket", "Risk", "Preview"], id: \.self) { tab in
                    Button(tab) { activeRightTab = tab }
                        .buttonStyle(TabButtonStyle(active: activeRightTab == tab))
                }
            }
            .padding(8)
            .overlay(alignment: .bottom) { Divider().background(lineColor) }
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Order Ticket / Risk Review").font(.headline)
                    Spacer()
                    Text("Paper").foregroundStyle(.green).font(.caption).padding(5).background(Color.green.opacity(0.14)).clipShape(RoundedRectangle(cornerRadius: 5))
                }
                field("Side", data.orderTicket.side)
                field("Quantity", String(data.orderTicket.quantity))
                field("Order Type", data.orderTicket.orderType)
                field("Limit Price", data.orderTicket.limitPrice)
                field("Time in Force", data.orderTicket.timeInForce)
                field("Account", data.orderTicket.account)
                Divider().background(lineColor)
                Text("Risk Summary").foregroundStyle(.secondary).fontWeight(.semibold)
                field("Max Loss (Stop)", data.risk.maxLoss, .red)
                field("Max Gain (T1)", data.risk.maxGain, .green)
                field("Risk / Reward", data.risk.rewardRisk)
                field("Prob. of Profit", data.risk.probability)
                field("Delta (Net)", data.risk.deltaNet)
                field("Theta (Daily)", data.risk.thetaDaily)
                field("Buying Power Impact", data.risk.buyingPower)
                ForEach(data.risk.warnings, id: \.self) { warning($0) }
                warning("Broker Preview · \(data.orderTicket.route) · \(data.orderTicket.venue)")
                Spacer()
            }
            .padding(14)
            HStack(spacing: 12) {
                Button {
                } label: {
                    VStack { Text("Live 🔒"); Text("Disabled in Live Review").font(.caption2) }
                }
                .disabled(true)
                .buttonStyle(DecisionButtonStyle(active: false))
                Button {
                } label: {
                    VStack { Text("Review Paper"); Text("Simulate & Audit").font(.caption2) }
                }
                .buttonStyle(DecisionButtonStyle(active: true))
                .accessibilityIdentifier("workbench.reviewPaperAction")
            }
            .padding(12)
            .overlay(alignment: .top) { Divider().background(lineColor) }
        }
        .background(panelColor)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(lineColor))
        .accessibilityIdentifier("workbench.rightPanel")
    }

    private func railSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).foregroundStyle(.secondary).font(.caption).textCase(.uppercase)
                Spacer()
                Text("+")
            }
            content()
            Spacer(minLength: 0)
        }
        .padding(10)
        .overlay(alignment: .bottom) { Divider().background(lineColor) }
    }

    private func segmented(_ values: [String], selected: String) -> some View {
        HStack(spacing: 4) {
            ForEach(values, id: \.self) { value in
                Text(value)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, minHeight: 24)
                    .background(value == selected ? Color.green.opacity(0.28) : Color(red: 0.078, green: 0.121, blue: 0.137))
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
        }
        .padding(2)
        .background(Color(red: 0.06, green: 0.095, blue: 0.108))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func statusChip(_ title: String, _ detail: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).foregroundStyle(color).fontWeight(.semibold).lineLimit(1)
            Text(detail).foregroundStyle(.secondary).lineLimit(1)
        }
        .font(.caption2)
        .frame(width: 128, height: 32, alignment: .leading)
        .padding(.horizontal, 10)
        .background(Color(red: 0.075, green: 0.115, blue: 0.13))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(lineColor))
    }

    private func circleButton(_ label: String) -> some View {
        Text(label)
            .frame(width: 30, height: 30)
            .background(Color(red: 0.075, green: 0.115, blue: 0.13))
            .clipShape(Circle())
            .overlay(Circle().stroke(lineColor))
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).foregroundStyle(.secondary).font(.caption2)
            Text(value).fontWeight(.semibold)
        }
        .frame(width: 76, alignment: .leading)
        .padding(.leading, 12)
        .overlay(alignment: .leading) { Rectangle().fill(lineColor).frame(width: 1) }
    }

    private func field(_ label: String, _ value: String, _ color: Color = .primary) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).foregroundStyle(color).fontWeight(.semibold).lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .font(.caption)
    }

    private func warning(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(Color.orange.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.orange.opacity(0.35)))
    }

    private var panelColor: Color { Color(red: 0.043, green: 0.078, blue: 0.089) }
    private var lineColor: Color { Color(red: 0.141, green: 0.196, blue: 0.22) }
}

private struct ChartCanvas: View {
    let data: WorkbenchData

    var body: some View {
        Canvas { context, size in
            let chart = CGRect(x: 14, y: 18, width: size.width - 78, height: size.height - 92)
            let prices = data.bars.flatMap { [$0.high, $0.low] } + data.levels.map(\.price)
            let minPrice = (prices.min() ?? 1160) - 4
            let maxPrice = (prices.max() ?? 1260) + 4
            func x(_ fraction: Double) -> CGFloat { chart.minX + chart.width * fraction }
            func y(_ price: Double) -> CGFloat { chart.minY + chart.height * ((maxPrice - price) / (maxPrice - minPrice)) }

            for index in 0..<10 {
                let yy = chart.minY + chart.height * CGFloat(index) / 9
                var path = Path()
                path.move(to: CGPoint(x: chart.minX, y: yy))
                path.addLine(to: CGPoint(x: chart.maxX, y: yy))
                context.stroke(path, with: .color(Color.white.opacity(0.08)), lineWidth: 1)
            }
            for index in 0..<12 {
                let xx = chart.minX + chart.width * CGFloat(index) / 11
                var path = Path()
                path.move(to: CGPoint(x: xx, y: chart.minY))
                path.addLine(to: CGPoint(x: xx, y: chart.maxY + 18))
                context.stroke(path, with: .color(Color.white.opacity(0.06)), lineWidth: 1)
            }

            for level in data.levels {
                let yy = y(level.price)
                var path = Path()
                path.move(to: CGPoint(x: chart.minX, y: yy))
                path.addLine(to: CGPoint(x: chart.maxX, y: yy))
                context.stroke(path, with: .color(level.color.opacity(0.8)), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                context.draw(Text(level.label).font(.caption2).foregroundStyle(level.color), at: CGPoint(x: size.width - 5, y: yy - 4), anchor: .trailing)
            }

            let candleWidth = max(4, chart.width / CGFloat(max(data.bars.count, 1)) * 0.48)
            for bar in data.bars {
                let xx = x(bar.x)
                let color: Color = bar.close >= bar.open ? .green : .red
                var wick = Path()
                wick.move(to: CGPoint(x: xx, y: y(bar.high)))
                wick.addLine(to: CGPoint(x: xx, y: y(bar.low)))
                context.stroke(wick, with: .color(color), lineWidth: 1)
                let top = min(y(bar.open), y(bar.close))
                let height = max(2, abs(y(bar.open) - y(bar.close)))
                context.fill(Path(CGRect(x: xx - candleWidth / 2, y: top, width: candleWidth, height: height)), with: .color(color))
                let volumeHeight = max(4, CGFloat(bar.volume / 720) * 54)
                context.fill(Path(CGRect(x: xx - candleWidth / 2, y: size.height - 48 - volumeHeight, width: candleWidth, height: volumeHeight)), with: .color(color.opacity(0.42)))
            }

            if let lastBar = data.bars.last {
                marker(context: context, label: "LIVE \(data.lastPrice)", point: CGPoint(x: x(lastBar.x), y: y(lastBar.close)), color: .blue)
                context.draw(Text("\(data.symbol) · \(data.activeTimeframe) · \(data.venue)   O \(lastBar.open, specifier: "%.2f")  H \(lastBar.high, specifier: "%.2f")  L \(lastBar.low, specifier: "%.2f")  C \(data.lastPrice)  \(data.change) (\(data.changePercent))").font(.caption).foregroundStyle(data.change.hasPrefix("-") ? .red : .green), at: CGPoint(x: 16, y: 24), anchor: .leading)
            }
        }
        .accessibilityIdentifier("chart.surface")
    }

    private func marker(context: GraphicsContext, label: String, point: CGPoint, color: Color) {
        context.fill(Path(ellipseIn: CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)), with: .color(color))
        context.draw(Text(label).font(.caption2).foregroundStyle(.white), at: CGPoint(x: point.x + 10, y: point.y - 18), anchor: .leading)
    }
}

private struct TabButtonStyle: ButtonStyle {
    let active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption)
            .fontWeight(.semibold)
            .lineLimit(1)
            .frame(minWidth: 64, minHeight: 24)
            .padding(.horizontal, 6)
            .background(active ? Color.blue.opacity(0.28) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

private struct DecisionButtonStyle: ButtonStyle {
    let active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(active ? .white : .secondary)
            .background(active ? Color.blue.opacity(0.72) : Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? Color.blue : Color.white.opacity(0.12)))
    }
}

private extension View {
    func gridCell(highlight: Bool = false) -> some View {
        self
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: 25, alignment: .trailing)
            .padding(.horizontal, 8)
            .background(highlight ? Color.blue.opacity(0.28) : Color.clear)
            .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1) }
    }
}

@MainActor
private final class TradingSwiftAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let rootView = TradingWorkbenchView(data: WorkbenchData.load(adapterBaseURL: TradingSwiftApp.value(after: "--adapter-base-url")))
        let window = NSWindow(
            contentRect: NSRect(x: 80, y: 80, width: 1_586, height: 992),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Agentic Trading"
        window.minSize = NSSize(width: 1_200, height: 850)
        window.contentView = NSHostingView(rootView: rootView)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
private enum TradingSwiftApp {
    @MainActor
    static func main() {
        if let snapshotPath = value(after: "--snapshot") {
            do {
                try renderSnapshot(
                    to: URL(fileURLWithPath: snapshotPath),
                    width: dimension(after: "--width", defaultValue: 1_586),
                    height: dimension(after: "--height", defaultValue: 992),
                    adapterBaseURL: value(after: "--adapter-base-url")
                )
                exit(EXIT_SUCCESS)
            } catch {
                fputs("TradingSwiftApp snapshot failed: \(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            }
        }

        let app = NSApplication.shared
        let delegate = TradingSwiftAppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    fileprivate static func value(after flag: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: flag),
              CommandLine.arguments.indices.contains(CommandLine.arguments.index(after: index))
        else {
            return nil
        }
        return CommandLine.arguments[CommandLine.arguments.index(after: index)]
    }

    private static func dimension(after flag: String, defaultValue: CGFloat) -> CGFloat {
        guard let raw = value(after: flag),
              let parsed = Double(raw),
              parsed > 0
        else {
            return defaultValue
        }
        return CGFloat(parsed)
    }

    @MainActor
    private static func renderSnapshot(to url: URL, width: CGFloat, height: CGFloat, adapterBaseURL: String?) throws {
        let size = NSSize(width: width, height: height)
        let rootView = TradingWorkbenchView(data: WorkbenchData.load(adapterBaseURL: adapterBaseURL))
            .frame(width: size.width, height: size.height)
        let hostingView = NSHostingView(rootView: rootView)
        hostingView.frame = NSRect(origin: .zero, size: size)

        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Agentic Trading"
        window.contentView = hostingView
        window.layoutIfNeeded()
        hostingView.layoutSubtreeIfNeeded()

        for _ in 0..<8 {
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
            window.layoutIfNeeded()
            hostingView.layoutSubtreeIfNeeded()
            hostingView.displayIfNeeded()
        }

        guard let bitmap = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds) else {
            throw SnapshotError.bitmapCreationFailed
        }
        hostingView.cacheDisplay(in: hostingView.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw SnapshotError.pngEncodingFailed
        }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        _ = window
    }

    private enum SnapshotError: LocalizedError {
        case bitmapCreationFailed
        case pngEncodingFailed

        var errorDescription: String? {
            switch self {
            case .bitmapCreationFailed:
                return "Unable to create native UI snapshot bitmap."
            case .pngEncodingFailed:
                return "Unable to encode native UI snapshot PNG."
            }
        }
    }
}
