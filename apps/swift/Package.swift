// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TradingSwiftFrontend",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "TradingSwiftApp", targets: ["TradingSwiftApp"])
    ],
    targets: [
        .executableTarget(name: "TradingSwiftApp")
    ]
)
