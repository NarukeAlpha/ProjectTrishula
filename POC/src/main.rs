use agentic_trading_adapter::{cli, telemetry};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    telemetry::init();
    cli::run().await
}
