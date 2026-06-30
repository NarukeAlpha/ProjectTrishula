pub mod adapter_contract {
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};

    pub const API_VERSION: &str = "ibkr-local-adapter.v1";
    pub const IMPLEMENTATION: &str = "rust-local-adapter";

    const EVENT_REPLAY_CAPACITY: usize = 100;

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Endpoint {
        pub host: String,
        pub port: u16,
        #[serde(rename = "clientID")]
        pub client_id: u32,
        pub environment: BrokerEnvironment,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
    pub enum BrokerEnvironment {
        #[serde(rename = "ibkrPaper")]
        IbkrPaper,
        #[serde(rename = "ibkrLive")]
        IbkrLive,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ServerTimeProvenance {
        pub source: String,
        pub observed_at: Option<String>,
        pub age_milliseconds: Option<u64>,
        pub heartbeat_stale: bool,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AdapterStatus {
        pub api_version: String,
        pub implementation: String,
        pub connection_state: String,
        pub endpoint: Endpoint,
        pub server_time: Option<String>,
        pub server_time_provenance: ServerTimeProvenance,
        pub message: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RuntimePreflight {
        pub api_version: String,
        pub implementation: String,
        pub is_approved: bool,
        pub broker_session_required: bool,
        pub checks: Vec<PreflightCheck>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PreflightCheck {
        pub id: String,
        pub is_approved: bool,
        pub message: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RouteSpec {
        pub method: String,
        pub path: String,
        pub category: String,
        pub area: String,
        pub broker_session_required: bool,
        pub requires_tws_connection: bool,
        pub requires_idempotency_key: bool,
        pub requires_exact_confirmation: bool,
        pub returns_async_acknowledgement: bool,
        pub disconnected_failure_code: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Capabilities {
        pub api_version: String,
        pub implementation: String,
        pub kind: String,
        pub route_count: usize,
        pub routes: Vec<RouteSpec>,
        pub market_data: Vec<String>,
        pub order_capabilities: Vec<String>,
        pub risk_and_safety_gates: Vec<String>,
        pub graph_and_ticket_data: Vec<String>,
        pub event_names: Vec<String>,
        pub failure_codes: Vec<String>,
        pub safety_gates: Vec<String>,
        pub external_evidence_gates: Vec<String>,
        pub real_session_evidence_required: Vec<String>,
        pub event_replay_capacity: usize,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AdapterFailure {
        pub code: String,
        pub message: String,
        #[serde(rename = "requestID", skip_serializing_if = "Option::is_none")]
        pub request_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub retry_after_seconds: Option<u64>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    pub struct EventEnvelope {
        pub event: String,
        #[serde(rename = "receivedAt")]
        pub received_at: String,
        pub payload: Value,
    }

    pub fn now_rfc3339() -> String {
        OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
    }

    pub fn default_endpoint() -> Endpoint {
        Endpoint {
            host: "127.0.0.1".to_string(),
            port: 4002,
            client_id: 42,
            environment: BrokerEnvironment::IbkrPaper,
        }
    }

    pub fn disconnected_status() -> AdapterStatus {
        crate::runtime_state::BrokerSessionSnapshot::disconnected(default_endpoint()).status()
    }

    pub fn runtime_preflight() -> RuntimePreflight {
        RuntimePreflight {
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: true,
            broker_session_required: false,
            checks: vec![
                PreflightCheck {
                    id: "rust-runtime".to_string(),
                    is_approved: true,
                    message: "Rust adapter binary is available.".to_string(),
                },
                PreflightCheck {
                    id: "disconnected-surface".to_string(),
                    is_approved: true,
                    message: "Disconnected HTTP surface is available without a broker session."
                        .to_string(),
                },
                PreflightCheck {
                    id: "wire-version".to_string(),
                    is_approved: true,
                    message: format!("Wire contract remains {API_VERSION}."),
                },
            ],
        }
    }

    pub fn capabilities() -> Capabilities {
        let routes = routes();
        Capabilities {
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            kind: "ibkr-java-wrapper-capabilities".to_string(),
            route_count: routes.len(),
            routes,
            market_data: market_data_capabilities()
                .iter()
                .map(|capability| (*capability).to_string())
                .collect(),
            order_capabilities: order_capabilities()
                .iter()
                .map(|capability| (*capability).to_string())
                .collect(),
            risk_and_safety_gates: risk_and_safety_gates()
                .iter()
                .map(|gate| (*gate).to_string())
                .collect(),
            graph_and_ticket_data: graph_and_ticket_data()
                .iter()
                .map(|capability| (*capability).to_string())
                .collect(),
            event_names: event_names()
                .iter()
                .map(|name| (*name).to_string())
                .collect(),
            failure_codes: failure_codes()
                .iter()
                .map(|code| (*code).to_string())
                .collect(),
            safety_gates: vec![
                "operation-ledger".to_string(),
                "paper-live-environment-split".to_string(),
                "startup-port-gate".to_string(),
                "duplicate-client-id-rejection".to_string(),
                "request-derived-idempotency".to_string(),
                "idempotency-replay-reject".to_string(),
                "callback-backed-server-time".to_string(),
                "heartbeat-stale-fail-closed".to_string(),
                "live-startup-confirmation".to_string(),
                "per-order-live-confirmation".to_string(),
                "reconnect-recovery-before-order-id-allocation".to_string(),
                "audit-receipt-before-acknowledgement".to_string(),
                "stable-failure-taxonomy".to_string(),
                "redacted-observability".to_string(),
            ],
            external_evidence_gates: vec![
                "paper-gateway-stage-c-d-e-f".to_string(),
                "flex-reconciliation".to_string(),
                "live-stage-g-dry-run-or-placement".to_string(),
            ],
            real_session_evidence_required: real_session_evidence_required()
                .iter()
                .map(|gate| (*gate).to_string())
                .collect(),
            event_replay_capacity: EVENT_REPLAY_CAPACITY,
        }
    }

    pub fn routes() -> Vec<RouteSpec> {
        vec![
            route("GET", "/v1/status", "Runtime", false),
            route("GET", "/v1/runtime/preflight", "Runtime", false),
            route("GET", "/v1/capabilities", "Contract", false),
            route("GET", "/v1/accounts", "Account state", true),
            route(
                "GET",
                "/v1/accounts/{accountID}/summary",
                "Account state",
                true,
            ),
            route(
                "GET",
                "/v1/accounts/{accountID}/positions",
                "Account state",
                true,
            ),
            route(
                "GET",
                "/v1/accounts/{accountID}/orders/open",
                "Reconciliation",
                true,
            ),
            route(
                "GET",
                "/v1/accounts/{accountID}/orders/completed",
                "Reconciliation",
                true,
            ),
            route(
                "GET",
                "/v1/accounts/{accountID}/fills",
                "Reconciliation",
                true,
            ),
            route("GET", "/v1/contracts/resolve", "Contracts", true),
            route("GET", "/v1/market-rules/{marketRuleID}", "Contracts", true),
            route("GET", "/v1/quotes/{conID}", "Market data", true),
            route("POST", "/v1/quotes/{conID}/subscribe", "Market data", true),
            route(
                "DELETE",
                "/v1/quotes/{conID}/subscribe",
                "Market data",
                true,
            ),
            route("GET", "/v1/bars/{conID}", "Market data", true),
            route("POST", "/v1/bars/{conID}/stream", "Market data", true),
            route("DELETE", "/v1/bars/{conID}/stream", "Market data", true),
            route("GET", "/v1/ticks/{conID}", "Market data", true),
            route(
                "GET",
                "/v1/options/chains/{underlyingConID}",
                "Options",
                true,
            ),
            route("GET", "/v1/options/contracts/resolve", "Options", true),
            route(
                "GET",
                "/v1/options/contracts/{conID}/details",
                "Options",
                true,
            ),
            route("GET", "/v1/options/quotes/{conID}", "Options", true),
            route("POST", "/v1/options/exercise", "Options", true),
            route("POST", "/v1/orders/preview", "Orders", true),
            route("POST", "/v1/orders/paper", "Orders", true),
            route("POST", "/v1/orders/live", "Orders", true),
            route("POST", "/v1/orders/{brokerOrderID}/modify", "Orders", true),
            route("POST", "/v1/orders/{brokerOrderID}/cancel", "Orders", true),
            route("POST", "/v1/orders/global-cancel", "Orders", true),
            route("WS", "/v1/events", "Events", false),
        ]
    }

    fn route(method: &str, path: &str, area: &str, broker_session_required: bool) -> RouteSpec {
        RouteSpec {
            method: method.to_string(),
            path: path.to_string(),
            category: route_category(method, path, area).to_string(),
            area: area.to_string(),
            broker_session_required,
            requires_tws_connection: broker_session_required,
            requires_idempotency_key: requires_idempotency_key(method, path),
            requires_exact_confirmation: requires_exact_confirmation(method, path),
            returns_async_acknowledgement: returns_async_acknowledgement(method, path),
            disconnected_failure_code: broker_session_required
                .then(|| "disconnectedGateway".to_string()),
        }
    }

    fn route_category(method: &str, path: &str, area: &str) -> &'static str {
        match (method, path, area) {
            ("GET", "/v1/status", _) => "connection",
            (_, _, "Runtime") => "runtime",
            (_, _, "Contract") => "contract",
            (_, _, "Account state") => "accounts",
            (_, _, "Reconciliation") => "reconciliation",
            (_, _, "Contracts") => "contracts",
            (_, _, "Market data") => "marketData",
            (_, _, "Options") => "options",
            (_, _, "Orders") => "orders",
            (_, _, "Events") => "events",
            _ => "unknown",
        }
    }

    fn requires_idempotency_key(method: &str, path: &str) -> bool {
        matches!(
            (method, path),
            ("POST", "/v1/options/exercise")
                | ("POST", "/v1/orders/preview")
                | ("POST", "/v1/orders/paper")
                | ("POST", "/v1/orders/live")
                | ("POST", "/v1/orders/{brokerOrderID}/modify")
        )
    }

    fn requires_exact_confirmation(method: &str, path: &str) -> bool {
        matches!(
            (method, path),
            ("POST", "/v1/options/exercise")
                | ("POST", "/v1/orders/live")
                | ("POST", "/v1/orders/{brokerOrderID}/modify")
                | ("POST", "/v1/orders/global-cancel")
        )
    }

    fn returns_async_acknowledgement(method: &str, path: &str) -> bool {
        matches!(
            (method, path),
            ("POST", "/v1/options/exercise")
                | ("POST", "/v1/orders/paper")
                | ("POST", "/v1/orders/live")
                | ("POST", "/v1/orders/{brokerOrderID}/modify")
                | ("POST", "/v1/orders/global-cancel")
        )
    }

    pub fn market_data_capabilities() -> [&'static str; 10] {
        [
            "stockQuoteSnapshots",
            "quoteSubscriptions",
            "historicalBars",
            "historicalTicks",
            "realTimeBars",
            "optionQuoteSnapshots",
            "optionGreeks",
            "marketDataType",
            "serverTimeProvenance",
            "historicalPacing",
        ]
    }

    pub fn order_capabilities() -> [&'static str; 16] {
        [
            "whatIfPreview",
            "paperMarket",
            "paperLimit",
            "paperStop",
            "paperStopLimit",
            "paperTrailingStop",
            "paperTrailingStopLimit",
            "paperOptionLimit",
            "paperComboLimit",
            "paperBracketOCA",
            "liveLimitGated",
            "liveOptionOrComboGated",
            "orderModification",
            "cancelOrder",
            "paperGlobalCancel",
            "optionExerciseLapse",
        ]
    }

    pub fn risk_and_safety_gates() -> [&'static str; 15] {
        [
            "paperPortAllowlist",
            "liveStartupEnablement",
            "liveStartupConfirmation",
            "requestDerivedIdempotency",
            "accountEnvironmentMatch",
            "brokerPreviewRequired",
            "mappedContractRouteValidation",
            "minimumTickValidation",
            "reconnectRecoveryBeforePlacement",
            "exactLiveOrderConfirmation",
            "exactModificationConfirmation",
            "exactOptionExerciseConfirmation",
            "verifiedOptionPositionBeforeExercise",
            "paperOnlyGlobalCancel",
            "auditAndReconciliationRequired",
        ]
    }

    pub fn graph_and_ticket_data() -> [&'static str; 17] {
        [
            "candles",
            "volume",
            "bidAskOverlay",
            "priceLevelIDs",
            "priceLevelLabels",
            "priceBoundLevelLabels",
            "orderMarkers",
            "riskLevels",
            "quoteFreshness",
            "providerStatus",
            "stockExitTicket",
            "singleLegOptionTicket",
            "optionExitTicket",
            "verticalSpreadTicket",
            "reviewedRoutingGates",
            "liveOrderMarkers",
            "liveTicketGate",
        ]
    }

    pub fn real_session_evidence_required() -> [&'static str; 6] {
        [
            "real Gateway/TWS market data",
            "real Gateway/TWS paper order lifecycle",
            "real Gateway/TWS options and spreads",
            "real Gateway/TWS live dry-run or explicitly approved placement",
            "real Flex reconciliation",
            "native SwiftUI screenshot under full Xcode",
        ]
    }

    pub fn event_names() -> [&'static str; 17] {
        [
            "connection.status",
            "account.summary",
            "position.snapshot",
            "contract.details",
            "quote.snapshot",
            "bars.snapshot",
            "ticks.snapshot",
            "option.chain",
            "option.contract",
            "option.contract-details",
            "option.quote",
            "option.exercise",
            "order.status",
            "order.modify",
            "order.global_cancel",
            "fill.report",
            "adapter.failure",
        ]
    }

    pub fn failure_codes() -> [&'static str; 12] {
        [
            "disconnectedGateway",
            "unauthenticatedGateway",
            "pacingLimit",
            "missingEntitlement",
            "staleData",
            "invalidContract",
            "rejectedOrder",
            "unsupportedOrderType",
            "liveTradingDisabled",
            "livePortRejected",
            "orderNotFound",
            "invalidEventSubscription",
        ]
    }

    pub fn disconnected_failure(request_id: Option<String>) -> AdapterFailure {
        AdapterFailure {
            code: "disconnectedGateway".to_string(),
            message:
                "Broker-facing route rejected because no IBKR Gateway or TWS session is connected."
                    .to_string(),
            request_id,
            retry_after_seconds: None,
        }
    }

    pub fn rejected_order_failure(
        message: impl Into<String>,
        request_id: Option<String>,
    ) -> AdapterFailure {
        AdapterFailure {
            code: "rejectedOrder".to_string(),
            message: message.into(),
            request_id,
            retry_after_seconds: None,
        }
    }

    pub fn invalid_event_subscription_failure(request_id: Option<String>) -> AdapterFailure {
        AdapterFailure {
            code: "invalidEventSubscription".to_string(),
            message: "WebSocket subscription must include action=subscribe, stream quote or bars, a positive conID, and a timeframe for bars.".to_string(),
            request_id,
            retry_after_seconds: None,
        }
    }

    pub fn event_envelope(event: &str, payload: Value) -> EventEnvelope {
        EventEnvelope {
            event: event.to_string(),
            received_at: now_rfc3339(),
            payload,
        }
    }

    pub fn connection_status_event() -> EventEnvelope {
        event_envelope("connection.status", json!(disconnected_status()))
    }

    pub fn failure_event(failure: AdapterFailure) -> EventEnvelope {
        event_envelope("adapter.failure", json!(failure))
    }
}

pub mod runtime_state {
    use crate::adapter_contract::{
        AdapterStatus, BrokerEnvironment, Endpoint, ServerTimeProvenance, API_VERSION,
        IMPLEMENTATION,
    };
    use serde::{Deserialize, Serialize};

    pub const LIVE_TRADING_STARTUP_CONFIRMATION: &str = "ENABLE IBKR LIVE TRADING";
    pub const PAPER_PORTS: [u16; 2] = [4002, 7497];
    pub const LIVE_PORTS: [u16; 2] = [4001, 7496];

    #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub enum ConnectionState {
        Disconnected,
        Connecting,
        Connected,
        Stale,
        Reconnecting,
    }

    impl ConnectionState {
        pub fn as_wire_value(self) -> &'static str {
            match self {
                Self::Disconnected => "disconnected",
                Self::Connecting => "connecting",
                Self::Connected => "connected",
                Self::Stale => "stale",
                Self::Reconnecting => "reconnecting",
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerSessionSnapshot {
        pub endpoint: Endpoint,
        pub connection_state: ConnectionState,
        pub next_valid_id_ready: bool,
        pub server_time: Option<String>,
        pub server_time_provenance: ServerTimeProvenance,
        pub order_id_allocation_available: bool,
        pub message: String,
    }

    impl BrokerSessionSnapshot {
        pub fn disconnected(endpoint: Endpoint) -> Self {
            Self {
                endpoint,
                connection_state: ConnectionState::Disconnected,
                next_valid_id_ready: false,
                server_time: None,
                server_time_provenance: ServerTimeProvenance {
                    source: "unavailable".to_string(),
                    observed_at: None,
                    age_milliseconds: None,
                    heartbeat_stale: false,
                },
                order_id_allocation_available: false,
                message: "Rust local broker adapter is running without a connected broker session."
                    .to_string(),
            }
        }

        pub fn connected(endpoint: Endpoint) -> Self {
            Self {
                endpoint,
                connection_state: ConnectionState::Connected,
                next_valid_id_ready: true,
                server_time: Some("2026-06-13T16:30:00Z".to_string()),
                server_time_provenance: ServerTimeProvenance {
                    source: "twsReqCurrentTime".to_string(),
                    observed_at: Some("2026-06-13T16:30:00.250Z".to_string()),
                    age_milliseconds: Some(250),
                    heartbeat_stale: false,
                },
                order_id_allocation_available: true,
                message:
                    "Fake broker session is callback-backed and ready for broker-facing requests."
                        .to_string(),
            }
        }

        pub fn stale(endpoint: Endpoint) -> Self {
            let mut snapshot = Self::connected(endpoint);
            snapshot.connection_state = ConnectionState::Stale;
            snapshot.server_time_provenance.heartbeat_stale = true;
            snapshot.order_id_allocation_available = false;
            snapshot.message =
                "Fake broker session heartbeat is stale; broker-facing routes fail closed."
                    .to_string();
            snapshot
        }

        pub fn reconnecting(endpoint: Endpoint) -> Self {
            Self {
                endpoint,
                connection_state: ConnectionState::Reconnecting,
                next_valid_id_ready: false,
                server_time: None,
                server_time_provenance: ServerTimeProvenance {
                    source: "unavailable".to_string(),
                    observed_at: None,
                    age_milliseconds: None,
                    heartbeat_stale: true,
                },
                order_id_allocation_available: false,
                message: "Fake broker session is reconnecting; order id allocation is unavailable."
                    .to_string(),
            }
        }

        pub fn status(&self) -> AdapterStatus {
            AdapterStatus {
                api_version: API_VERSION.to_string(),
                implementation: IMPLEMENTATION.to_string(),
                connection_state: self.connection_state.as_wire_value().to_string(),
                endpoint: self.endpoint.clone(),
                server_time: self.server_time.clone(),
                server_time_provenance: self.server_time_provenance.clone(),
                message: self.message.clone(),
            }
        }

        pub fn is_ready(&self) -> bool {
            self.connection_state == ConnectionState::Connected
                && self.next_valid_id_ready
                && self.server_time_provenance.source == "twsReqCurrentTime"
                && !self.server_time_provenance.heartbeat_stale
                && self.server_time.is_some()
                && self.order_id_allocation_available
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct StartupRequest {
        pub endpoint: Endpoint,
        pub live_trading_enabled: bool,
        pub live_trading_confirmation: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct StartupDecision {
        pub is_approved: bool,
        pub endpoint: Endpoint,
        pub messages: Vec<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DuplicateClientDecision {
        pub is_approved: bool,
        pub client_id: u32,
        pub messages: Vec<String>,
    }

    pub fn evaluate_startup(request: StartupRequest) -> StartupDecision {
        let mut messages = Vec::new();
        match request.endpoint.environment {
            BrokerEnvironment::IbkrPaper => {
                if PAPER_PORTS.contains(&request.endpoint.port) {
                    messages.push(format!(
                        "paper endpoint accepted on allowed port {}",
                        request.endpoint.port
                    ));
                } else {
                    messages.push(format!(
                        "paper endpoint rejects non-paper port {}",
                        request.endpoint.port
                    ));
                }
            }
            BrokerEnvironment::IbkrLive => {
                if !request.live_trading_enabled {
                    messages.push("live startup requires enable-live-trading true".to_string());
                }
                if request.live_trading_confirmation.as_deref()
                    != Some(LIVE_TRADING_STARTUP_CONFIRMATION)
                {
                    messages.push(format!(
                        "live startup requires exact confirmation {LIVE_TRADING_STARTUP_CONFIRMATION}"
                    ));
                }
                if LIVE_PORTS.contains(&request.endpoint.port) {
                    messages.push(format!(
                        "live endpoint accepted on allowed port {}",
                        request.endpoint.port
                    ));
                } else {
                    messages.push(format!(
                        "live endpoint rejects non-live port {}",
                        request.endpoint.port
                    ));
                }
            }
        }
        let port_approved = match request.endpoint.environment {
            BrokerEnvironment::IbkrPaper => PAPER_PORTS.contains(&request.endpoint.port),
            BrokerEnvironment::IbkrLive => LIVE_PORTS.contains(&request.endpoint.port),
        };
        let live_gate_approved = request.endpoint.environment == BrokerEnvironment::IbkrPaper
            || (request.live_trading_enabled
                && request.live_trading_confirmation.as_deref()
                    == Some(LIVE_TRADING_STARTUP_CONFIRMATION));
        StartupDecision {
            is_approved: port_approved && live_gate_approved,
            endpoint: request.endpoint,
            messages,
        }
    }

    pub fn evaluate_duplicate_client_id(
        client_id: u32,
        active_client_ids: &[u32],
    ) -> DuplicateClientDecision {
        let is_duplicate = active_client_ids.contains(&client_id);
        DuplicateClientDecision {
            is_approved: !is_duplicate,
            client_id,
            messages: if is_duplicate {
                vec![format!("client id {client_id} is already active")]
            } else {
                vec![format!("client id {client_id} is available")]
            },
        }
    }
}

pub mod broker_protocol {
    use crate::{
        adapter_contract::{
            event_envelope, AdapterStatus, BrokerEnvironment, Endpoint, EventEnvelope, API_VERSION,
        },
        runtime_state::{
            evaluate_duplicate_client_id, evaluate_startup, BrokerSessionSnapshot, ConnectionState,
            StartupRequest, LIVE_TRADING_STARTUP_CONFIRMATION,
        },
    };
    use serde::{Deserialize, Serialize};

    pub const FIXTURE_OBSERVED_AT: &str = "2027-01-15T18:30:00.250Z";
    pub const FIXTURE_SERVER_TIME: &str = "2027-01-15T18:30:00Z";
    pub const FIXTURE_NEXT_VALID_ORDER_ID: i64 = 1901;

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerProtocolEvent {
        pub kind: String,
        pub observed_at: String,
        pub detail: String,
        pub next_valid_order_id: Option<i64>,
        pub server_time: Option<String>,
        pub server_time_source: Option<String>,
        pub account_ids: Vec<String>,
        #[serde(rename = "requestID", skip_serializing_if = "Option::is_none")]
        pub request_id: Option<String>,
    }

    impl BrokerProtocolEvent {
        pub fn connect_requested() -> Self {
            Self::new("connect.requested", "socket connection requested")
        }

        pub fn socket_connected() -> Self {
            Self::new(
                "socket.connected",
                "socket connected; waiting for broker callbacks",
            )
        }

        pub fn next_valid_id(order_id: i64) -> Self {
            Self {
                next_valid_order_id: Some(order_id),
                ..Self::new(
                    "callback.nextValidId",
                    "broker supplied next valid order id",
                )
            }
        }

        pub fn server_time(server_time: &str) -> Self {
            Self {
                server_time: Some(server_time.to_string()),
                server_time_source: Some("twsReqCurrentTime".to_string()),
                ..Self::new(
                    "callback.currentTime",
                    "broker supplied callback-backed server time",
                )
            }
        }

        pub fn managed_accounts(account_ids: &[&str]) -> Self {
            Self {
                account_ids: account_ids
                    .iter()
                    .map(|account_id| account_id.to_string())
                    .collect(),
                ..Self::new(
                    "callback.managedAccounts",
                    "broker supplied managed accounts",
                )
            }
        }

        pub fn managed_account_ids(account_ids: &[String]) -> Self {
            Self {
                account_ids: account_ids.to_vec(),
                ..Self::new(
                    "callback.managedAccounts",
                    "broker supplied managed accounts",
                )
            }
        }

        pub fn heartbeat_stale() -> Self {
            Self::new(
                "heartbeat.stale",
                "server-time heartbeat is stale; order id allocation is locked",
            )
        }

        pub fn read_loop_failure(request_id: &str) -> Self {
            Self {
                request_id: Some(request_id.to_string()),
                ..Self::new(
                    "readLoop.failure",
                    "broker read loop failed; reconnect recovery is required",
                )
            }
        }

        pub fn reconnect_started() -> Self {
            Self::new(
                "reconnect.started",
                "reconnect started; order id allocation remains unavailable",
            )
        }

        pub fn shutdown() -> Self {
            Self::new("socket.shutdown", "broker session shut down")
        }

        fn new(kind: &str, detail: &str) -> Self {
            Self {
                kind: kind.to_string(),
                observed_at: FIXTURE_OBSERVED_AT.to_string(),
                detail: detail.to_string(),
                next_valid_order_id: None,
                server_time: None,
                server_time_source: None,
                account_ids: Vec::new(),
                request_id: None,
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerProtocolFailure {
        pub code: String,
        pub message: String,
        #[serde(rename = "requestID", skip_serializing_if = "Option::is_none")]
        pub request_id: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerSessionManager {
        pub endpoint: Endpoint,
        pub connection_state: ConnectionState,
        pub next_valid_order_id: Option<i64>,
        pub server_time: Option<String>,
        pub server_time_observed_at: Option<String>,
        pub server_time_source: String,
        pub heartbeat_stale: bool,
        pub order_id_allocation_available: bool,
        pub reconnect_generation: u64,
        pub managed_accounts: Vec<String>,
        pub last_failure: Option<BrokerProtocolFailure>,
        pub protocol_events: Vec<BrokerProtocolEvent>,
    }

    impl BrokerSessionManager {
        pub fn disconnected(endpoint: Endpoint) -> Self {
            Self {
                endpoint,
                connection_state: ConnectionState::Disconnected,
                next_valid_order_id: None,
                server_time: None,
                server_time_observed_at: None,
                server_time_source: "unavailable".to_string(),
                heartbeat_stale: false,
                order_id_allocation_available: false,
                reconnect_generation: 0,
                managed_accounts: Vec::new(),
                last_failure: None,
                protocol_events: Vec::new(),
            }
        }

        pub fn from_snapshot(snapshot: BrokerSessionSnapshot) -> Self {
            Self {
                endpoint: snapshot.endpoint,
                connection_state: snapshot.connection_state,
                next_valid_order_id: snapshot
                    .next_valid_id_ready
                    .then_some(FIXTURE_NEXT_VALID_ORDER_ID),
                server_time: snapshot.server_time,
                server_time_observed_at: snapshot.server_time_provenance.observed_at,
                server_time_source: snapshot.server_time_provenance.source,
                heartbeat_stale: snapshot.server_time_provenance.heartbeat_stale,
                order_id_allocation_available: snapshot.order_id_allocation_available,
                reconnect_generation: 0,
                managed_accounts: Vec::new(),
                last_failure: None,
                protocol_events: Vec::new(),
            }
        }

        pub fn apply(&mut self, event: BrokerProtocolEvent) {
            match event.kind.as_str() {
                "connect.requested" | "socket.connected" => {
                    self.connection_state = ConnectionState::Connecting;
                    self.last_failure = None;
                }
                "callback.nextValidId" => {
                    self.next_valid_order_id = event.next_valid_order_id;
                    self.refresh_readiness();
                }
                "callback.currentTime" => {
                    self.server_time = event.server_time.clone();
                    self.server_time_observed_at = Some(event.observed_at.clone());
                    self.server_time_source = event
                        .server_time_source
                        .clone()
                        .unwrap_or_else(|| "unavailable".to_string());
                    self.heartbeat_stale = false;
                    self.refresh_readiness();
                }
                "callback.managedAccounts" => {
                    self.managed_accounts = event.account_ids.clone();
                    self.refresh_readiness();
                }
                "heartbeat.stale" => {
                    self.connection_state = ConnectionState::Stale;
                    self.heartbeat_stale = true;
                    self.order_id_allocation_available = false;
                }
                "readLoop.failure" => {
                    self.connection_state = ConnectionState::Reconnecting;
                    self.next_valid_order_id = None;
                    self.order_id_allocation_available = false;
                    self.heartbeat_stale = true;
                    self.reconnect_generation += 1;
                    self.last_failure = Some(BrokerProtocolFailure {
                        code: "disconnectedGateway".to_string(),
                        message: event.detail.clone(),
                        request_id: event.request_id.clone(),
                    });
                }
                "reconnect.started" => {
                    self.connection_state = ConnectionState::Reconnecting;
                    self.next_valid_order_id = None;
                    self.order_id_allocation_available = false;
                    self.heartbeat_stale = true;
                    self.reconnect_generation += 1;
                }
                "socket.shutdown" => {
                    self.connection_state = ConnectionState::Disconnected;
                    self.next_valid_order_id = None;
                    self.server_time = None;
                    self.server_time_observed_at = None;
                    self.server_time_source = "unavailable".to_string();
                    self.heartbeat_stale = false;
                    self.order_id_allocation_available = false;
                    self.managed_accounts.clear();
                }
                _ => {}
            }
            self.protocol_events.push(event);
        }

        pub fn snapshot(&self) -> BrokerSessionSnapshot {
            BrokerSessionSnapshot {
                endpoint: self.endpoint.clone(),
                connection_state: self.connection_state,
                next_valid_id_ready: self.next_valid_order_id.is_some(),
                server_time: self.server_time.clone(),
                server_time_provenance: crate::adapter_contract::ServerTimeProvenance {
                    source: self.server_time_source.clone(),
                    observed_at: self.server_time_observed_at.clone(),
                    age_milliseconds: self.server_time_observed_at.as_ref().map(|_| 250),
                    heartbeat_stale: self.heartbeat_stale,
                },
                order_id_allocation_available: self.order_id_allocation_available,
                message: self.status_message(),
            }
        }

        pub fn status(&self) -> AdapterStatus {
            self.snapshot().status()
        }

        pub fn connection_event(&self) -> EventEnvelope {
            event_envelope("connection.status", serde_json::json!(self.status()))
        }

        pub fn callback_event_names(&self) -> Vec<String> {
            self.protocol_events
                .iter()
                .map(|event| event.kind.clone())
                .collect()
        }

        fn refresh_readiness(&mut self) {
            if matches!(
                self.connection_state,
                ConnectionState::Disconnected
                    | ConnectionState::Reconnecting
                    | ConnectionState::Stale
            ) {
                return;
            }
            let ready = self.next_valid_order_id.is_some()
                && self.server_time.is_some()
                && self.server_time_source == "twsReqCurrentTime"
                && !self.heartbeat_stale;
            self.connection_state = if ready {
                ConnectionState::Connected
            } else {
                ConnectionState::Connecting
            };
            self.order_id_allocation_available = ready;
        }

        fn status_message(&self) -> String {
            match self.connection_state {
                ConnectionState::Disconnected => {
                    "Rust broker protocol session is disconnected.".to_string()
                }
                ConnectionState::Connecting => {
                    "Rust broker protocol session is waiting for callback-backed readiness."
                        .to_string()
                }
                ConnectionState::Connected => {
                    "Rust broker protocol session is callback-backed and order-id ready."
                        .to_string()
                }
                ConnectionState::Stale => {
                    "Rust broker protocol heartbeat is stale; broker-facing routes fail closed."
                        .to_string()
                }
                ConnectionState::Reconnecting => {
                    "Rust broker protocol session is reconnecting; order-id allocation is unavailable."
                        .to_string()
                }
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerHealthCheckTrace {
        pub expected_api_version: String,
        pub expected_endpoint: Endpoint,
        pub status: AdapterStatus,
        pub is_ready: bool,
        pub approvals: Vec<String>,
        pub rejections: Vec<String>,
    }

    pub fn health_check(
        expected_endpoint: Endpoint,
        status: AdapterStatus,
    ) -> BrokerHealthCheckTrace {
        let mut approvals = Vec::new();
        let mut rejections = Vec::new();
        require(
            status.api_version == API_VERSION,
            format!("adapter status API version matches {API_VERSION}"),
            format!(
                "adapter status API version is {}, expected {API_VERSION}",
                status.api_version
            ),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.endpoint.host == expected_endpoint.host,
            format!("adapter endpoint host matches {}", expected_endpoint.host),
            format!(
                "adapter endpoint host is {}, expected {}",
                status.endpoint.host, expected_endpoint.host
            ),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.endpoint.port == expected_endpoint.port,
            format!("adapter endpoint port matches {}", expected_endpoint.port),
            format!(
                "adapter endpoint port is {}, expected {}",
                status.endpoint.port, expected_endpoint.port
            ),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.endpoint.client_id == expected_endpoint.client_id,
            format!(
                "adapter endpoint client id matches {}",
                expected_endpoint.client_id
            ),
            format!(
                "adapter endpoint client id is {}, expected {}",
                status.endpoint.client_id, expected_endpoint.client_id
            ),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.endpoint.environment == expected_endpoint.environment,
            format!(
                "adapter endpoint environment matches {}",
                environment_label(expected_endpoint.environment)
            ),
            format!(
                "adapter endpoint environment is {}, expected {}",
                environment_label(status.endpoint.environment),
                environment_label(expected_endpoint.environment)
            ),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.connection_state == "connected",
            "adapter connectionState is connected".to_string(),
            format!(
                "adapter connectionState is {}, expected connected",
                status.connection_state
            ),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.server_time.is_some(),
            "adapter status includes callback-backed serverTime".to_string(),
            "adapter status serverTime is missing".to_string(),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.server_time_provenance.source == "twsReqCurrentTime",
            "adapter serverTimeProvenance source is twsReqCurrentTime".to_string(),
            format!(
                "adapter serverTimeProvenance source is {}, expected twsReqCurrentTime",
                status.server_time_provenance.source
            ),
            &mut approvals,
            &mut rejections,
        );
        require(
            status.server_time_provenance.observed_at.is_some(),
            "adapter serverTimeProvenance includes observedAt".to_string(),
            "adapter serverTimeProvenance observedAt is missing".to_string(),
            &mut approvals,
            &mut rejections,
        );
        require(
            !status.server_time_provenance.heartbeat_stale,
            "adapter server-time heartbeat is fresh".to_string(),
            "adapter server-time heartbeat is stale".to_string(),
            &mut approvals,
            &mut rejections,
        );

        BrokerHealthCheckTrace {
            expected_api_version: API_VERSION.to_string(),
            expected_endpoint,
            status,
            is_ready: rejections.is_empty(),
            approvals,
            rejections,
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerSessionEvidence {
        pub startup_accepts: bool,
        pub duplicate_client_rejected: bool,
        pub disconnected: BrokerSessionSnapshot,
        pub connecting: BrokerSessionSnapshot,
        pub connected: BrokerSessionSnapshot,
        pub stale: BrokerSessionSnapshot,
        pub reconnecting: BrokerSessionSnapshot,
        pub read_loop_failure: BrokerProtocolFailure,
        pub health_ready: BrokerHealthCheckTrace,
        pub health_rejects_disconnected: BrokerHealthCheckTrace,
        pub health_rejects_wrong_endpoint: BrokerHealthCheckTrace,
        pub connection_event: EventEnvelope,
        pub protocol_event_names: Vec<String>,
    }

    pub fn deterministic_session_evidence() -> BrokerSessionEvidence {
        let endpoint = crate::adapter_contract::default_endpoint();
        let startup_accepts = evaluate_startup(StartupRequest {
            endpoint: endpoint.clone(),
            live_trading_enabled: false,
            live_trading_confirmation: None,
        })
        .is_approved;
        let duplicate_client_rejected = !evaluate_duplicate_client_id(42, &[1, 42]).is_approved;

        let disconnected = BrokerSessionManager::disconnected(endpoint.clone());

        let mut connecting_manager = BrokerSessionManager::disconnected(endpoint.clone());
        connecting_manager.apply(BrokerProtocolEvent::connect_requested());
        connecting_manager.apply(BrokerProtocolEvent::socket_connected());

        let mut connected_manager = connecting_manager.clone();
        connected_manager.apply(BrokerProtocolEvent::next_valid_id(
            FIXTURE_NEXT_VALID_ORDER_ID,
        ));
        connected_manager.apply(BrokerProtocolEvent::server_time(FIXTURE_SERVER_TIME));
        connected_manager.apply(BrokerProtocolEvent::managed_accounts(&["DU1234567"]));

        let mut stale_manager = connected_manager.clone();
        stale_manager.apply(BrokerProtocolEvent::heartbeat_stale());

        let mut reconnecting_manager = connected_manager.clone();
        reconnecting_manager.apply(BrokerProtocolEvent::read_loop_failure("read-loop-smoke"));
        let read_loop_failure = reconnecting_manager
            .last_failure
            .clone()
            .expect("read-loop failure");

        let wrong_endpoint = Endpoint {
            port: 4001,
            client_id: 43,
            environment: BrokerEnvironment::IbkrLive,
            ..endpoint.clone()
        };

        BrokerSessionEvidence {
            startup_accepts,
            duplicate_client_rejected,
            disconnected: disconnected.snapshot(),
            connecting: connecting_manager.snapshot(),
            connected: connected_manager.snapshot(),
            stale: stale_manager.snapshot(),
            reconnecting: reconnecting_manager.snapshot(),
            read_loop_failure,
            health_ready: health_check(endpoint.clone(), connected_manager.status()),
            health_rejects_disconnected: health_check(endpoint.clone(), disconnected.status()),
            health_rejects_wrong_endpoint: health_check(endpoint, {
                let mut status = connected_manager.status();
                status.endpoint = wrong_endpoint;
                status
            }),
            connection_event: connected_manager.connection_event(),
            protocol_event_names: connected_manager.callback_event_names(),
        }
    }

    pub fn connected_fixture_session(endpoint: Endpoint) -> BrokerSessionSnapshot {
        let mut manager = BrokerSessionManager::disconnected(endpoint);
        manager.apply(BrokerProtocolEvent::connect_requested());
        manager.apply(BrokerProtocolEvent::socket_connected());
        manager.apply(BrokerProtocolEvent::next_valid_id(
            FIXTURE_NEXT_VALID_ORDER_ID,
        ));
        manager.apply(BrokerProtocolEvent::server_time(FIXTURE_SERVER_TIME));
        manager.apply(BrokerProtocolEvent::managed_accounts(&[
            "DU1234567",
            "U1234567",
        ]));
        manager.snapshot()
    }

    fn require(
        condition: bool,
        approval: String,
        rejection: String,
        approvals: &mut Vec<String>,
        rejections: &mut Vec<String>,
    ) {
        if condition {
            approvals.push(approval);
        } else {
            rejections.push(rejection);
        }
    }

    fn environment_label(environment: BrokerEnvironment) -> &'static str {
        match environment {
            BrokerEnvironment::IbkrPaper => "ibkrPaper",
            BrokerEnvironment::IbkrLive => "ibkrLive",
        }
    }

    pub fn live_startup_confirmation() -> &'static str {
        LIVE_TRADING_STARTUP_CONFIRMATION
    }
}

pub mod tws_wire {
    use crate::{
        adapter_contract::{BrokerEnvironment, Endpoint},
        broker_callback_router::BrokerCallback,
        broker_protocol::{BrokerProtocolEvent, BrokerSessionManager},
        broker_read_model::{
            AccountStateCallback, AccountSummary, BrokerAccountReference, BrokerInstrument,
            FillReport, OrderLinkage, OrderStatusSnapshot, PositionSnapshot,
        },
        market_read_model::{
            ContractDetails, ContractIdentity, HistoricalBarsResponse, HistoricalTicksResponse,
            MarketDataCallback, MarketRule, OptionChainSnapshot, OptionContract,
            OptionQuoteSnapshot, QuoteSnapshot,
        },
        order_routing::{
            BrokerOrderPreview, CancelResponse, GlobalCancelAcknowledgement,
            OptionExerciseAcknowledgement, OrderPlacementAcknowledgement, OrderRoutingCallback,
        },
        runtime_state::BrokerSessionSnapshot,
    };
    use serde::{de::DeserializeOwned, Deserialize, Serialize};
    use std::collections::HashMap;
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};

    pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
    pub const OUT_START_API: &str = "71";
    pub const OUT_REQ_MANAGED_ACCOUNTS: &str = "17";
    pub const OUT_REQ_CURRENT_TIME: &str = "49";
    pub const IN_ERROR: &str = "4";
    pub const IN_NEXT_VALID_ID: &str = "9";
    pub const IN_MANAGED_ACCOUNTS: &str = "15";
    pub const IN_CURRENT_TIME: &str = "49";
    pub const IN_AGENTIC_DOMAIN_CALLBACK: &str = "9900";
    pub const IN_AGENTIC_CALLBACK_RECORD: &str = "9901";
    pub const IN_AGENTIC_FIELD_CALLBACK: &str = "9902";
    pub const START_API_VERSION: &str = "2";
    pub const REQUEST_VERSION: &str = "1";

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsWireError {
        pub code: String,
        pub message: String,
    }

    impl TwsWireError {
        fn new(code: &str, message: impl Into<String>) -> Self {
            Self {
                code: code.to_string(),
                message: message.into(),
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsFrame {
        pub fields: Vec<String>,
    }

    impl TwsFrame {
        pub fn new(fields: Vec<String>) -> Result<Self, TwsWireError> {
            if fields.is_empty() {
                return Err(TwsWireError::new(
                    "emptyFrame",
                    "TWS frame must include a message id field.",
                ));
            }
            if fields.iter().any(|field| field.as_bytes().contains(&0)) {
                return Err(TwsWireError::new(
                    "invalidField",
                    "TWS fields cannot contain embedded NUL bytes.",
                ));
            }
            Ok(Self { fields })
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FrameDecode {
        pub frames: Vec<TwsFrame>,
        pub remaining_bytes: usize,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum TwsOutboundRequest {
        StartApi { client_id: u32 },
        ReqManagedAccounts,
        ReqCurrentTime,
    }

    impl TwsOutboundRequest {
        pub fn fields(&self) -> Vec<String> {
            match self {
                Self::StartApi { client_id } => vec![
                    OUT_START_API.to_string(),
                    START_API_VERSION.to_string(),
                    client_id.to_string(),
                    String::new(),
                ],
                Self::ReqManagedAccounts => {
                    vec![
                        OUT_REQ_MANAGED_ACCOUNTS.to_string(),
                        REQUEST_VERSION.to_string(),
                    ]
                }
                Self::ReqCurrentTime => {
                    vec![
                        OUT_REQ_CURRENT_TIME.to_string(),
                        REQUEST_VERSION.to_string(),
                    ]
                }
            }
        }

        pub fn encode_prefixed(&self) -> Result<Vec<u8>, TwsWireError> {
            encode_prefixed_fields(&self.fields())
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum TwsCallback {
        NextValidId {
            order_id: i64,
        },
        CurrentTime {
            epoch_seconds: i64,
            server_time: String,
        },
        ManagedAccounts {
            account_ids: Vec<String>,
        },
        Error {
            request_id: i64,
            code: i32,
            message: String,
        },
        Domain {
            callback: Box<BrokerCallback>,
        },
        CallbackRecord {
            method: String,
            callback: Box<BrokerCallback>,
        },
        FieldRecord {
            method: String,
            callback: Box<BrokerCallback>,
        },
        Unknown {
            message_id: String,
            fields: Vec<String>,
        },
    }

    impl TwsCallback {
        pub fn to_protocol_event(&self) -> Option<BrokerProtocolEvent> {
            match self.to_broker_callback()? {
                BrokerCallback::Protocol { event } => Some(event),
                BrokerCallback::Account { .. }
                | BrokerCallback::MarketData { .. }
                | BrokerCallback::OrderRouting { .. } => None,
            }
        }

        pub fn to_broker_callback(&self) -> Option<BrokerCallback> {
            match self {
                Self::NextValidId { order_id } => Some(BrokerCallback::Protocol {
                    event: BrokerProtocolEvent::next_valid_id(*order_id),
                }),
                Self::CurrentTime { server_time, .. } => Some(BrokerCallback::Protocol {
                    event: BrokerProtocolEvent::server_time(server_time),
                }),
                Self::ManagedAccounts { account_ids } => Some(BrokerCallback::Protocol {
                    event: BrokerProtocolEvent::managed_account_ids(account_ids),
                }),
                Self::Error {
                    request_id,
                    code,
                    message: _,
                } if matches!(code, 1100 | 1300) => Some(BrokerCallback::Protocol {
                    event: BrokerProtocolEvent::read_loop_failure(&format!(
                        "tws-error-{request_id}-{code}"
                    )),
                }),
                Self::Domain { callback } => Some((**callback).clone()),
                Self::CallbackRecord { callback, .. } => Some((**callback).clone()),
                Self::FieldRecord { callback, .. } => Some((**callback).clone()),
                Self::Error { .. } | Self::Unknown { .. } => None,
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsWireEvidence {
        pub start_api_fields: Vec<String>,
        pub req_managed_accounts_fields: Vec<String>,
        pub req_current_time_fields: Vec<String>,
        pub decoded_callbacks: Vec<TwsCallback>,
        pub split_decode_frame_count: usize,
        pub partial_remaining_bytes: usize,
        pub session: BrokerSessionSnapshot,
        pub reconnecting_after_error: BrokerSessionSnapshot,
        pub malformed_error: TwsWireError,
    }

    pub fn encode_prefixed_fields(fields: &[String]) -> Result<Vec<u8>, TwsWireError> {
        let frame = TwsFrame::new(fields.to_vec())?;
        let payload = encode_payload(&frame.fields);
        let payload_len: u32 = payload
            .len()
            .try_into()
            .map_err(|_| TwsWireError::new("frameTooLarge", "TWS frame exceeds u32 length."))?;
        let mut output = Vec::with_capacity(4 + payload.len());
        output.extend_from_slice(&payload_len.to_be_bytes());
        output.extend_from_slice(&payload);
        Ok(output)
    }

    pub fn encode_payload(fields: &[String]) -> Vec<u8> {
        let mut payload = Vec::new();
        for field in fields {
            payload.extend_from_slice(field.as_bytes());
            payload.push(0);
        }
        payload
    }

    pub fn domain_callback_fields(callback: &BrokerCallback) -> Result<Vec<String>, TwsWireError> {
        let payload = serde_json::to_string(callback).map_err(|error| {
            TwsWireError::new(
                "invalidDomainCallback",
                format!("TWS domain callback envelope could not be encoded: {error}"),
            )
        })?;
        Ok(vec![
            IN_AGENTIC_DOMAIN_CALLBACK.to_string(),
            REQUEST_VERSION.to_string(),
            payload,
        ])
    }

    pub fn callback_record_fields<T: Serialize>(
        method: &str,
        payload: &T,
    ) -> Result<Vec<String>, TwsWireError> {
        if method.trim().is_empty() {
            return Err(TwsWireError::new(
                "invalidCallbackRecord",
                "TWS callback record method cannot be empty.",
            ));
        }
        let payload = serde_json::to_string(payload).map_err(|error| {
            TwsWireError::new(
                "invalidCallbackRecord",
                format!("TWS callback record payload could not be encoded: {error}"),
            )
        })?;
        Ok(vec![
            IN_AGENTIC_CALLBACK_RECORD.to_string(),
            REQUEST_VERSION.to_string(),
            method.to_string(),
            payload,
        ])
    }

    pub fn field_callback_fields<I, K, V>(
        method: &str,
        fields: I,
    ) -> Result<Vec<String>, TwsWireError>
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        if method.trim().is_empty() {
            return Err(TwsWireError::new(
                "invalidFieldCallback",
                "TWS field callback method cannot be empty.",
            ));
        }

        let mut output = vec![
            IN_AGENTIC_FIELD_CALLBACK.to_string(),
            REQUEST_VERSION.to_string(),
            method.to_string(),
        ];
        for (key, value) in fields {
            let key = key.as_ref();
            if key.trim().is_empty() {
                return Err(TwsWireError::new(
                    "invalidFieldCallback",
                    "TWS field callback keys cannot be empty.",
                ));
            }
            output.push(key.to_string());
            output.push(value.as_ref().to_string());
        }
        Ok(output)
    }

    pub fn decode_prefixed_frames(input: &[u8]) -> Result<FrameDecode, TwsWireError> {
        let mut frames = Vec::new();
        let mut cursor = 0;
        while input.len().saturating_sub(cursor) >= 4 {
            let length = u32::from_be_bytes(
                input[cursor..cursor + 4]
                    .try_into()
                    .expect("four byte frame length"),
            ) as usize;
            if length > MAX_FRAME_BYTES {
                return Err(TwsWireError::new(
                    "frameTooLarge",
                    format!("TWS frame length {length} exceeds {MAX_FRAME_BYTES}."),
                ));
            }
            let payload_start = cursor + 4;
            let payload_end = payload_start + length;
            if input.len() < payload_end {
                break;
            }
            frames.push(TwsFrame::new(decode_payload(
                &input[payload_start..payload_end],
            )?)?);
            cursor = payload_end;
        }

        Ok(FrameDecode {
            frames,
            remaining_bytes: input.len() - cursor,
        })
    }

    pub fn decode_payload(payload: &[u8]) -> Result<Vec<String>, TwsWireError> {
        if payload.is_empty() {
            return Err(TwsWireError::new(
                "emptyPayload",
                "TWS payload cannot be empty.",
            ));
        }
        if payload.last() != Some(&0) {
            return Err(TwsWireError::new(
                "missingTrailingNul",
                "TWS payload must end with a NUL field delimiter.",
            ));
        }

        let mut fields = Vec::new();
        for field in payload[..payload.len() - 1].split(|byte| *byte == 0) {
            fields.push(
                std::str::from_utf8(field)
                    .map_err(|error| {
                        TwsWireError::new(
                            "invalidUtf8",
                            format!("TWS field is not valid UTF-8: {error}"),
                        )
                    })?
                    .to_string(),
            );
        }
        Ok(fields)
    }

    pub fn decode_callback(frame: &TwsFrame) -> Result<TwsCallback, TwsWireError> {
        let message_id = required_field(&frame.fields, 0, "message id")?;
        match message_id {
            IN_NEXT_VALID_ID => Ok(TwsCallback::NextValidId {
                order_id: parse_i64(versioned_payload_field(&frame.fields, 1)?, "order id")?,
            }),
            IN_CURRENT_TIME => {
                let epoch_seconds = parse_i64(
                    versioned_payload_field(&frame.fields, 1)?,
                    "current time epoch seconds",
                )?;
                Ok(TwsCallback::CurrentTime {
                    epoch_seconds,
                    server_time: epoch_to_rfc3339(epoch_seconds)?,
                })
            }
            IN_MANAGED_ACCOUNTS => Ok(TwsCallback::ManagedAccounts {
                account_ids: versioned_payload_field(&frame.fields, 1)?
                    .split(',')
                    .filter_map(|account_id| {
                        let trimmed = account_id.trim();
                        (!trimmed.is_empty()).then(|| trimmed.to_string())
                    })
                    .collect(),
            }),
            IN_ERROR => {
                let payload_offset = if frame.fields.len() >= 5 { 2 } else { 1 };
                Ok(TwsCallback::Error {
                    request_id: parse_i64(
                        required_field(&frame.fields, payload_offset, "request id")?,
                        "request id",
                    )?,
                    code: parse_i32(
                        required_field(&frame.fields, payload_offset + 1, "error code")?,
                        "error code",
                    )?,
                    message: required_field(&frame.fields, payload_offset + 2, "error message")?
                        .to_string(),
                })
            }
            IN_AGENTIC_DOMAIN_CALLBACK => {
                let payload = versioned_payload_field(&frame.fields, 1)?;
                let callback =
                    serde_json::from_str::<BrokerCallback>(payload).map_err(|error| {
                        TwsWireError::new(
                            "invalidDomainCallback",
                            format!("TWS domain callback envelope is invalid: {error}"),
                        )
                    })?;
                Ok(TwsCallback::Domain {
                    callback: Box::new(callback),
                })
            }
            IN_AGENTIC_CALLBACK_RECORD => {
                let method = required_field(&frame.fields, 2, "callback record method")?;
                let payload = required_field(&frame.fields, 3, "callback record payload")?;
                let callback = decode_callback_record(method, payload)?;
                Ok(TwsCallback::CallbackRecord {
                    method: method.to_string(),
                    callback: Box::new(callback),
                })
            }
            IN_AGENTIC_FIELD_CALLBACK => {
                let method = required_field(&frame.fields, 2, "field callback method")?;
                let callback = decode_field_callback(method, &frame.fields[3..])?;
                Ok(TwsCallback::FieldRecord {
                    method: method.to_string(),
                    callback: Box::new(callback),
                })
            }
            other => Ok(TwsCallback::Unknown {
                message_id: other.to_string(),
                fields: frame.fields.clone(),
            }),
        }
    }

    pub fn deterministic_wire_evidence(endpoint: Endpoint) -> TwsWireEvidence {
        let start_api = TwsOutboundRequest::StartApi {
            client_id: endpoint.client_id,
        };
        let req_managed_accounts = TwsOutboundRequest::ReqManagedAccounts;
        let req_current_time = TwsOutboundRequest::ReqCurrentTime;

        let mut stream = Vec::new();
        stream.extend(
            encode_prefixed_fields(&[
                IN_NEXT_VALID_ID.to_string(),
                REQUEST_VERSION.to_string(),
                "1901".to_string(),
            ])
            .expect("nextValidId frame"),
        );
        stream.extend(
            encode_prefixed_fields(&[
                IN_CURRENT_TIME.to_string(),
                REQUEST_VERSION.to_string(),
                "1800037800".to_string(),
            ])
            .expect("currentTime frame"),
        );
        stream.extend(
            encode_prefixed_fields(&[
                IN_MANAGED_ACCOUNTS.to_string(),
                REQUEST_VERSION.to_string(),
                "DU1234567,U1234567".to_string(),
            ])
            .expect("managedAccounts frame"),
        );

        let split = stream.len() - 3;
        let partial_decode = decode_prefixed_frames(&stream[..split]).expect("partial decode");
        let full_decode = decode_prefixed_frames(&stream).expect("full decode");
        let decoded_callbacks = full_decode
            .frames
            .iter()
            .map(decode_callback)
            .collect::<Result<Vec<_>, _>>()
            .expect("callbacks");

        let mut session = BrokerSessionManager::disconnected(endpoint);
        session.apply(BrokerProtocolEvent::connect_requested());
        session.apply(BrokerProtocolEvent::socket_connected());
        for callback in &decoded_callbacks {
            if let Some(event) = callback.to_protocol_event() {
                session.apply(event);
            }
        }

        let error_frame = TwsFrame::new(vec![
            IN_ERROR.to_string(),
            "2".to_string(),
            "-1".to_string(),
            "1100".to_string(),
            "Connectivity between IB and TWS has been lost.".to_string(),
        ])
        .expect("error frame");
        let error_callback = decode_callback(&error_frame).expect("error callback");
        let mut reconnecting = session.clone();
        if let Some(event) = error_callback.to_protocol_event() {
            reconnecting.apply(event);
        }

        TwsWireEvidence {
            start_api_fields: start_api.fields(),
            req_managed_accounts_fields: req_managed_accounts.fields(),
            req_current_time_fields: req_current_time.fields(),
            decoded_callbacks,
            split_decode_frame_count: full_decode.frames.len(),
            partial_remaining_bytes: partial_decode.remaining_bytes,
            session: session.snapshot(),
            reconnecting_after_error: reconnecting.snapshot(),
            malformed_error: decode_payload(&[b'9', 0, b'1', 0, b'1', b'9', b'0', b'1'])
                .expect_err("missing trailing NUL"),
        }
    }

    fn required_field<'a>(
        fields: &'a [String],
        index: usize,
        label: &str,
    ) -> Result<&'a str, TwsWireError> {
        fields
            .get(index)
            .map(String::as_str)
            .ok_or_else(|| TwsWireError::new("missingField", format!("TWS frame missing {label}.")))
    }

    fn versioned_payload_field(
        fields: &[String],
        version_index: usize,
    ) -> Result<&str, TwsWireError> {
        if fields.len() > version_index + 1 {
            required_field(fields, version_index + 1, "payload field")
        } else {
            required_field(fields, version_index, "payload field")
        }
    }

    fn parse_i64(value: &str, label: &str) -> Result<i64, TwsWireError> {
        value.parse::<i64>().map_err(|error| {
            TwsWireError::new(
                "invalidInteger",
                format!("TWS {label} value '{value}' is invalid: {error}"),
            )
        })
    }

    fn parse_i32(value: &str, label: &str) -> Result<i32, TwsWireError> {
        value.parse::<i32>().map_err(|error| {
            TwsWireError::new(
                "invalidInteger",
                format!("TWS {label} value '{value}' is invalid: {error}"),
            )
        })
    }

    fn decode_callback_record(method: &str, payload: &str) -> Result<BrokerCallback, TwsWireError> {
        match method {
            "accountSummary" => Ok(BrokerCallback::Account {
                callback: AccountStateCallback::AccountSummary {
                    summary: decode_record_payload::<AccountSummary>(method, payload)?,
                },
            }),
            "position" => Ok(BrokerCallback::Account {
                callback: AccountStateCallback::Position {
                    position: decode_record_payload::<PositionSnapshot>(method, payload)?,
                },
            }),
            "openOrder" | "orderStatus" => Ok(BrokerCallback::Account {
                callback: AccountStateCallback::OrderStatus {
                    status: decode_record_payload::<OrderStatusSnapshot>(method, payload)?,
                },
            }),
            "execDetails" => Ok(BrokerCallback::Account {
                callback: AccountStateCallback::Fill {
                    fill: decode_record_payload::<FillReport>(method, payload)?,
                },
            }),
            "commissionReport" => {
                let payload = decode_record_payload::<CommissionReportPayload>(method, payload)?;
                Ok(BrokerCallback::Account {
                    callback: AccountStateCallback::CommissionReport {
                        broker_order_id: payload.broker_order_id,
                        execution_id: payload.execution_id,
                        commission: payload.commission,
                        commission_reported_at: payload.commission_reported_at,
                        reported_at: payload.reported_at,
                    },
                })
            }
            "contractDetails" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::ContractDetails {
                    details: Box::new(decode_record_payload::<ContractDetails>(method, payload)?),
                },
            }),
            "marketRule" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::MarketRule {
                    market_rule: decode_record_payload::<MarketRule>(method, payload)?,
                },
            }),
            "tickPrice" | "tickSize" | "tickSnapshot" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::Quote {
                    quote: Box::new(decode_record_payload::<QuoteSnapshot>(method, payload)?),
                },
            }),
            "historicalData" | "realtimeBar" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::HistoricalBars {
                    bars: Box::new(decode_record_payload::<HistoricalBarsResponse>(
                        method, payload,
                    )?),
                },
            }),
            "historicalTicks" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::HistoricalTicks {
                    ticks: Box::new(decode_record_payload::<HistoricalTicksResponse>(
                        method, payload,
                    )?),
                },
            }),
            "securityDefinitionOptionParameter" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::OptionChain {
                    chain: Box::new(decode_record_payload::<OptionChainSnapshot>(
                        method, payload,
                    )?),
                },
            }),
            "optionContract" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::OptionContract {
                    contract: Box::new(decode_record_payload::<OptionContract>(method, payload)?),
                },
            }),
            "optionContractDetails" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::OptionDetails {
                    details: Box::new(decode_record_payload::<ContractDetails>(method, payload)?),
                },
            }),
            "tickOptionComputation" | "optionQuote" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::OptionQuote {
                    quote: Box::new(decode_record_payload::<OptionQuoteSnapshot>(
                        method, payload,
                    )?),
                },
            }),
            "whatIfPreview" => Ok(BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::Preview {
                    preview: Box::new(decode_record_payload::<BrokerOrderPreview>(
                        method, payload,
                    )?),
                },
            }),
            "placeOrderAcknowledgement" => Ok(BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::PlacementAcknowledgement {
                    acknowledgement: Box::new(decode_record_payload::<
                        OrderPlacementAcknowledgement,
                    >(method, payload)?),
                },
            }),
            "modifyOrderAcknowledgement" => Ok(BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::ModificationAcknowledgement {
                    acknowledgement: Box::new(decode_record_payload::<
                        OrderPlacementAcknowledgement,
                    >(method, payload)?),
                },
            }),
            "cancelOrderResponse" => Ok(BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::CancelResponse {
                    response: Box::new(decode_record_payload::<CancelResponse>(method, payload)?),
                },
            }),
            "globalCancelAcknowledgement" => Ok(BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::GlobalCancelAcknowledgement {
                    acknowledgement: Box::new(
                        decode_record_payload::<GlobalCancelAcknowledgement>(method, payload)?,
                    ),
                },
            }),
            "exerciseOptionsAcknowledgement" => Ok(BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::OptionExerciseAcknowledgement {
                    acknowledgement: Box::new(decode_record_payload::<
                        OptionExerciseAcknowledgement,
                    >(method, payload)?),
                },
            }),
            other => Err(TwsWireError::new(
                "unsupportedCallbackRecord",
                format!("TWS callback record method {other} is not mapped to a broker callback."),
            )),
        }
    }

    fn decode_record_payload<T: DeserializeOwned>(
        method: &str,
        payload: &str,
    ) -> Result<T, TwsWireError> {
        serde_json::from_str(payload).map_err(|error| {
            TwsWireError::new(
                "invalidCallbackRecord",
                format!("TWS callback record payload for {method} is invalid: {error}"),
            )
        })
    }

    fn decode_field_callback(
        method: &str,
        raw_fields: &[String],
    ) -> Result<BrokerCallback, TwsWireError> {
        let fields = parse_field_pairs(method, raw_fields)?;
        match method {
            "accountSummary" => Ok(BrokerCallback::Account {
                callback: AccountStateCallback::AccountSummary {
                    summary: AccountSummary {
                        account: account_reference_from_fields(method, &fields)?,
                        net_liquidation: required_callback_field(
                            method,
                            &fields,
                            "netLiquidation",
                        )?
                        .to_string(),
                        buying_power: required_callback_field(method, &fields, "buyingPower")?
                            .to_string(),
                        currency: required_callback_field(method, &fields, "currency")?.to_string(),
                        captured_at: required_callback_field(method, &fields, "capturedAt")?
                            .to_string(),
                    },
                },
            }),
            "position" => Ok(BrokerCallback::Account {
                callback: AccountStateCallback::Position {
                    position: PositionSnapshot {
                        account_id: required_callback_field(method, &fields, "accountID")?
                            .to_string(),
                        instrument: broker_instrument_from_fields(method, &fields)?,
                        quantity: required_callback_field(method, &fields, "quantity")?.to_string(),
                        average_cost: required_callback_field(method, &fields, "averageCost")?
                            .to_string(),
                        captured_at: required_callback_field(method, &fields, "capturedAt")?
                            .to_string(),
                    },
                },
            }),
            "openOrder" | "orderStatus" => Ok(BrokerCallback::Account {
                callback: AccountStateCallback::OrderStatus {
                    status: OrderStatusSnapshot {
                        broker_order_id: required_callback_field(method, &fields, "brokerOrderID")?
                            .to_string(),
                        permanent_id: optional_callback_field(&fields, "permanentID"),
                        client_id: parse_i32(
                            required_callback_field(method, &fields, "clientID")?,
                            "client id",
                        )?,
                        intent_id: required_callback_field(method, &fields, "intentID")?
                            .to_string(),
                        account_id: required_callback_field(method, &fields, "accountID")?
                            .to_string(),
                        environment: parse_environment(required_callback_field(
                            method,
                            &fields,
                            "environment",
                        )?)?,
                        status: required_callback_field(method, &fields, "status")?.to_string(),
                        submitted_at: required_callback_field(method, &fields, "submittedAt")?
                            .to_string(),
                        updated_at: required_callback_field(method, &fields, "updatedAt")?
                            .to_string(),
                        filled_quantity: required_callback_field(
                            method,
                            &fields,
                            "filledQuantity",
                        )?
                        .to_string(),
                        remaining_quantity: required_callback_field(
                            method,
                            &fields,
                            "remainingQuantity",
                        )?
                        .to_string(),
                        average_fill_price: optional_callback_field(&fields, "averageFillPrice"),
                        linkage: linkage_from_fields(&fields),
                    },
                },
            }),
            "tickPrice" | "tickSize" | "tickSnapshot" => Ok(BrokerCallback::MarketData {
                callback: MarketDataCallback::Quote {
                    quote: Box::new(QuoteSnapshot {
                        contract: contract_identity_from_fields(method, &fields)?,
                        market_data_type: required_callback_field(
                            method,
                            &fields,
                            "marketDataType",
                        )?
                        .to_string(),
                        bid: required_callback_field(method, &fields, "bid")?.to_string(),
                        ask: required_callback_field(method, &fields, "ask")?.to_string(),
                        last: optional_callback_field(&fields, "last"),
                        bid_size: optional_callback_field(&fields, "bidSize"),
                        ask_size: optional_callback_field(&fields, "askSize"),
                        last_size: optional_callback_field(&fields, "lastSize"),
                        quote_timestamp: required_callback_field(
                            method,
                            &fields,
                            "quoteTimestamp",
                        )?
                        .to_string(),
                        captured_at: required_callback_field(method, &fields, "capturedAt")?
                            .to_string(),
                    }),
                },
            }),
            "placeOrderAcknowledgement" => Ok(BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::PlacementAcknowledgement {
                    acknowledgement: Box::new(OrderPlacementAcknowledgement {
                        request_id: required_callback_field(method, &fields, "requestID")?
                            .to_string(),
                        idempotency_key: required_callback_field(
                            method,
                            &fields,
                            "idempotencyKey",
                        )?
                        .to_string(),
                        broker_order_id: required_callback_field(method, &fields, "brokerOrderID")?
                            .to_string(),
                        account_id: required_callback_field(method, &fields, "accountID")?
                            .to_string(),
                        environment: parse_environment(required_callback_field(
                            method,
                            &fields,
                            "environment",
                        )?)?,
                        status: required_callback_field(method, &fields, "status")?.to_string(),
                        acknowledged_at: required_callback_field(
                            method,
                            &fields,
                            "acknowledgedAt",
                        )?
                        .to_string(),
                        lifecycle_state_source: required_callback_field(
                            method,
                            &fields,
                            "lifecycleStateSource",
                        )?
                        .to_string(),
                        message: required_callback_field(method, &fields, "message")?.to_string(),
                    }),
                },
            }),
            other => Err(TwsWireError::new(
                "unsupportedFieldCallback",
                format!("TWS field callback method {other} is not mapped to a broker callback."),
            )),
        }
    }

    fn parse_field_pairs(
        method: &str,
        raw_fields: &[String],
    ) -> Result<HashMap<String, String>, TwsWireError> {
        if !raw_fields.len().is_multiple_of(2) {
            return Err(TwsWireError::new(
                "invalidFieldCallback",
                format!("TWS field callback {method} has an odd key/value field count."),
            ));
        }

        let mut fields = HashMap::new();
        for pair in raw_fields.chunks_exact(2) {
            let key = pair[0].trim();
            if key.is_empty() {
                return Err(TwsWireError::new(
                    "invalidFieldCallback",
                    format!("TWS field callback {method} includes an empty field key."),
                ));
            }
            if fields.insert(key.to_string(), pair[1].clone()).is_some() {
                return Err(TwsWireError::new(
                    "invalidFieldCallback",
                    format!("TWS field callback {method} repeats field key {key}."),
                ));
            }
        }
        Ok(fields)
    }

    fn required_callback_field<'a>(
        method: &str,
        fields: &'a HashMap<String, String>,
        key: &str,
    ) -> Result<&'a str, TwsWireError> {
        fields
            .get(key)
            .filter(|value| !value.trim().is_empty())
            .map(String::as_str)
            .ok_or_else(|| {
                TwsWireError::new(
                    "missingField",
                    format!("TWS field callback {method} missing {key}."),
                )
            })
    }

    fn optional_callback_field(fields: &HashMap<String, String>, key: &str) -> Option<String> {
        fields
            .get(key)
            .filter(|value| !value.trim().is_empty())
            .cloned()
    }

    fn account_reference_from_fields(
        method: &str,
        fields: &HashMap<String, String>,
    ) -> Result<BrokerAccountReference, TwsWireError> {
        let environment =
            parse_environment(required_callback_field(method, fields, "environment")?)?;
        Ok(BrokerAccountReference {
            account_id: required_callback_field(method, fields, "accountID")?.to_string(),
            display_name: required_callback_field(method, fields, "displayName")?.to_string(),
            environment,
            is_paper_trading: environment == BrokerEnvironment::IbkrPaper,
            is_live_trading: environment == BrokerEnvironment::IbkrLive,
            trading_permissions: csv_field_values(optional_callback_field(fields, "permissions")),
        })
    }

    fn broker_instrument_from_fields(
        method: &str,
        fields: &HashMap<String, String>,
    ) -> Result<BrokerInstrument, TwsWireError> {
        Ok(BrokerInstrument {
            con_id: parse_i64(required_callback_field(method, fields, "conID")?, "con id")?,
            symbol: required_callback_field(method, fields, "symbol")?.to_string(),
            security_type: required_callback_field(method, fields, "securityType")?.to_string(),
            currency: required_callback_field(method, fields, "currency")?.to_string(),
            exchange: required_callback_field(method, fields, "exchange")?.to_string(),
            expiry: optional_callback_field(fields, "expiry"),
            right: optional_callback_field(fields, "right"),
            strike: optional_callback_field(fields, "strike"),
        })
    }

    fn contract_identity_from_fields(
        method: &str,
        fields: &HashMap<String, String>,
    ) -> Result<ContractIdentity, TwsWireError> {
        Ok(ContractIdentity {
            con_id: parse_i64(required_callback_field(method, fields, "conID")?, "con id")?,
            symbol: required_callback_field(method, fields, "symbol")?.to_string(),
            security_type: required_callback_field(method, fields, "securityType")?.to_string(),
            exchange: required_callback_field(method, fields, "exchange")?.to_string(),
            primary_exchange: optional_callback_field(fields, "primaryExchange"),
            currency: required_callback_field(method, fields, "currency")?.to_string(),
            local_symbol: optional_callback_field(fields, "localSymbol"),
            trading_class: optional_callback_field(fields, "tradingClass"),
            multiplier: optional_callback_field(fields, "multiplier"),
            timezone_identifier: optional_callback_field(fields, "timezoneIdentifier"),
        })
    }

    fn linkage_from_fields(fields: &HashMap<String, String>) -> Option<OrderLinkage> {
        let parent_broker_order_id = optional_callback_field(fields, "parentBrokerOrderID");
        let oca_group = optional_callback_field(fields, "ocaGroup");
        (parent_broker_order_id.is_some() || oca_group.is_some()).then_some(OrderLinkage {
            parent_broker_order_id,
            oca_group,
        })
    }

    fn parse_environment(value: &str) -> Result<BrokerEnvironment, TwsWireError> {
        match value {
            "ibkrPaper" => Ok(BrokerEnvironment::IbkrPaper),
            "ibkrLive" => Ok(BrokerEnvironment::IbkrLive),
            other => Err(TwsWireError::new(
                "invalidEnvironment",
                format!("TWS broker environment '{other}' is unsupported."),
            )),
        }
    }

    fn csv_field_values(value: Option<String>) -> Vec<String> {
        value
            .into_iter()
            .flat_map(|value| {
                value
                    .split(',')
                    .filter_map(|entry| {
                        let trimmed = entry.trim();
                        (!trimmed.is_empty()).then(|| trimmed.to_string())
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CommissionReportPayload {
        #[serde(rename = "brokerOrderID")]
        broker_order_id: String,
        #[serde(rename = "executionID", alias = "executionId")]
        execution_id: String,
        commission: String,
        commission_reported_at: String,
        reported_at: String,
    }

    fn epoch_to_rfc3339(epoch_seconds: i64) -> Result<String, TwsWireError> {
        OffsetDateTime::from_unix_timestamp(epoch_seconds)
            .map_err(|error| {
                TwsWireError::new(
                    "invalidCurrentTime",
                    format!("TWS currentTime epoch seconds are invalid: {error}"),
                )
            })?
            .format(&Rfc3339)
            .map_err(|error| {
                TwsWireError::new(
                    "invalidCurrentTime",
                    format!("TWS currentTime could not be formatted: {error}"),
                )
            })
    }
}

pub mod tws_transport {
    use crate::{
        adapter_contract::Endpoint,
        broker_protocol::{BrokerProtocolEvent, BrokerSessionManager},
        broker_read_model::{AccountStateFixture, PAPER_ACCOUNT_ID},
        http_interface,
        market_read_model::{MarketDataFixture, AAPL_CON_ID},
        order_routing,
        runtime_state::{evaluate_startup, BrokerSessionSnapshot, StartupDecision, StartupRequest},
        tws_wire::{self, TwsCallback, TwsFrame, TwsOutboundRequest, TwsWireError},
    };
    use serde::{Deserialize, Serialize};
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

    const STARTUP_REQUEST_COUNT: usize = 3;

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsTransportError {
        pub code: String,
        pub message: String,
    }

    impl TwsTransportError {
        fn connect(error: std::io::Error) -> Self {
            Self {
                code: "transportConnectFailed".to_string(),
                message: error.to_string(),
            }
        }

        fn read(error: std::io::Error) -> Self {
            Self {
                code: "transportReadFailed".to_string(),
                message: error.to_string(),
            }
        }

        fn write(error: std::io::Error) -> Self {
            Self {
                code: "transportWriteFailed".to_string(),
                message: error.to_string(),
            }
        }

        fn wire(error: TwsWireError) -> Self {
            Self {
                code: error.code,
                message: error.message,
            }
        }

        fn task(error: tokio::task::JoinError) -> Self {
            Self {
                code: "transportTaskFailed".to_string(),
                message: error.to_string(),
            }
        }

        fn startup_rejected(decision: &StartupDecision) -> Self {
            Self {
                code: "startupRejected".to_string(),
                message: decision.messages.join("; "),
            }
        }
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub enum TwsTransportTermination {
        Ready,
        Reconnecting,
        MaxCallbacks,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsTransportTranscript {
        pub endpoint: Endpoint,
        pub sent_request_fields: Vec<Vec<String>>,
        pub callbacks: Vec<TwsCallback>,
        pub session: BrokerSessionSnapshot,
        pub termination: TwsTransportTermination,
        pub bytes_written: usize,
        pub bytes_read: usize,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsTransportEvidence {
        pub ready_session: TwsTransportTranscript,
        pub reconnecting_session: TwsTransportTranscript,
        pub gateway_observed_ready_requests: Vec<Vec<String>>,
        pub gateway_observed_reconnect_requests: Vec<Vec<String>>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsTcpStartupEvidence {
        pub endpoint: Endpoint,
        pub listener_address: String,
        pub transcript: TwsTransportTranscript,
        pub gateway_observed_requests: Vec<Vec<String>>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsBrokerStartupConfig {
        pub endpoint: Endpoint,
        pub live_trading_enabled: bool,
        pub live_trading_confirmation: Option<String>,
        pub max_callbacks: usize,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsBrokerStartupEvidence {
        pub startup_decision: StartupDecision,
        pub connect_address: String,
        pub transcript: TwsTransportTranscript,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub gateway_observed_requests: Option<Vec<Vec<String>>>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct TwsAppStateCallbackStreamEvidence {
        pub endpoint: Endpoint,
        pub startup: TwsTransportTranscript,
        pub post_ready_callbacks: Vec<TwsCallback>,
        pub gateway_observed_requests: Vec<Vec<String>>,
        pub app_state_status: crate::adapter_contract::AdapterStatus,
        pub projected_summary_net_liquidation: Option<String>,
        pub projected_quote_bid: Option<String>,
        pub projected_order_acknowledgements: Vec<String>,
        pub event_replay_names: Vec<String>,
        pub post_ready_bytes_read: usize,
    }

    pub async fn run_startup_handshake<S>(
        stream: &mut S,
        endpoint: Endpoint,
        max_callbacks: usize,
    ) -> Result<TwsTransportTranscript, TwsTransportError>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let mut session = BrokerSessionManager::disconnected(endpoint.clone());
        session.apply(BrokerProtocolEvent::connect_requested());
        session.apply(BrokerProtocolEvent::socket_connected());

        let requests = vec![
            TwsOutboundRequest::StartApi {
                client_id: endpoint.client_id,
            },
            TwsOutboundRequest::ReqManagedAccounts,
            TwsOutboundRequest::ReqCurrentTime,
        ];
        let mut sent_request_fields = Vec::new();
        let mut bytes_written = 0;
        for request in requests {
            let fields = request.fields();
            let encoded = request.encode_prefixed().map_err(TwsTransportError::wire)?;
            stream
                .write_all(&encoded)
                .await
                .map_err(TwsTransportError::write)?;
            bytes_written += encoded.len();
            sent_request_fields.push(fields);
        }
        stream.flush().await.map_err(TwsTransportError::write)?;

        let mut callbacks = Vec::new();
        let mut bytes_read = 0;
        let mut termination = TwsTransportTermination::MaxCallbacks;
        for _ in 0..max_callbacks {
            let (frame, frame_bytes) = read_frame(stream).await?;
            bytes_read += frame_bytes;
            let callback = tws_wire::decode_callback(&frame).map_err(TwsTransportError::wire)?;
            if let Some(event) = callback.to_protocol_event() {
                session.apply(event);
            }
            callbacks.push(callback);

            let snapshot = session.snapshot();
            if snapshot.is_ready() && !session.managed_accounts.is_empty() {
                termination = TwsTransportTermination::Ready;
                break;
            }
            if snapshot.connection_state.as_wire_value() == "reconnecting" {
                termination = TwsTransportTermination::Reconnecting;
                break;
            }
        }

        Ok(TwsTransportTranscript {
            endpoint,
            sent_request_fields,
            callbacks,
            session: session.snapshot(),
            termination,
            bytes_written,
            bytes_read,
        })
    }

    pub async fn deterministic_transport_evidence(
        endpoint: Endpoint,
    ) -> Result<TwsTransportEvidence, TwsTransportError> {
        let (ready_session, gateway_observed_ready_requests) =
            run_gateway_fixture(endpoint.clone(), ready_callback_fields()).await?;
        let (reconnecting_session, gateway_observed_reconnect_requests) =
            run_gateway_fixture(endpoint, reconnect_callback_fields()).await?;

        Ok(TwsTransportEvidence {
            ready_session,
            reconnecting_session,
            gateway_observed_ready_requests,
            gateway_observed_reconnect_requests,
        })
    }

    pub async fn connect_and_run_startup(
        endpoint: Endpoint,
        max_callbacks: usize,
    ) -> Result<TwsTransportTranscript, TwsTransportError> {
        let address = format!("{}:{}", endpoint.host, endpoint.port);
        connect_and_run_startup_to_address(endpoint, &address, max_callbacks).await
    }

    async fn connect_and_run_startup_to_address(
        endpoint: Endpoint,
        address: &str,
        max_callbacks: usize,
    ) -> Result<TwsTransportTranscript, TwsTransportError> {
        let mut stream = tokio::net::TcpStream::connect(address)
            .await
            .map_err(TwsTransportError::connect)?;
        run_startup_handshake(&mut stream, endpoint, max_callbacks).await
    }

    pub async fn run_configured_startup(
        config: TwsBrokerStartupConfig,
    ) -> Result<TwsBrokerStartupEvidence, TwsTransportError> {
        let startup_decision = evaluate_startup(StartupRequest {
            endpoint: config.endpoint.clone(),
            live_trading_enabled: config.live_trading_enabled,
            live_trading_confirmation: config.live_trading_confirmation.clone(),
        });
        if !startup_decision.is_approved {
            return Err(TwsTransportError::startup_rejected(&startup_decision));
        }

        let connect_address = format!("{}:{}", config.endpoint.host, config.endpoint.port);
        let transcript = connect_and_run_startup_to_address(
            config.endpoint,
            &connect_address,
            config.max_callbacks,
        )
        .await?;

        Ok(TwsBrokerStartupEvidence {
            startup_decision,
            connect_address,
            transcript,
            gateway_observed_requests: None,
        })
    }

    pub async fn deterministic_configured_startup_evidence(
        config: TwsBrokerStartupConfig,
    ) -> Result<TwsBrokerStartupEvidence, TwsTransportError> {
        let startup_decision = evaluate_startup(StartupRequest {
            endpoint: config.endpoint.clone(),
            live_trading_enabled: config.live_trading_enabled,
            live_trading_confirmation: config.live_trading_confirmation.clone(),
        });
        if !startup_decision.is_approved {
            return Err(TwsTransportError::startup_rejected(&startup_decision));
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(TwsTransportError::connect)?;
        let connect_address = listener
            .local_addr()
            .map_err(TwsTransportError::connect)?
            .to_string();
        let gateway = tokio::spawn(async move {
            let (mut gateway_stream, _) =
                listener.accept().await.map_err(TwsTransportError::read)?;
            let observed_requests =
                observe_startup_and_write_callbacks(&mut gateway_stream, ready_callback_fields())
                    .await?;
            gateway_stream
                .shutdown()
                .await
                .map_err(TwsTransportError::write)?;
            Ok::<Vec<Vec<String>>, TwsTransportError>(observed_requests)
        });

        let transcript = connect_and_run_startup_to_address(
            config.endpoint,
            &connect_address,
            config.max_callbacks,
        )
        .await?;
        let gateway_observed_requests = gateway.await.map_err(TwsTransportError::task)??;

        Ok(TwsBrokerStartupEvidence {
            startup_decision,
            connect_address,
            transcript,
            gateway_observed_requests: Some(gateway_observed_requests),
        })
    }

    pub async fn deterministic_tcp_startup_evidence(
        endpoint: Endpoint,
    ) -> Result<TwsTcpStartupEvidence, TwsTransportError> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(TwsTransportError::connect)?;
        let listener_address = listener
            .local_addr()
            .map_err(TwsTransportError::connect)?
            .to_string();
        let local_addr = listener.local_addr().map_err(TwsTransportError::connect)?;
        let tcp_endpoint = Endpoint {
            host: local_addr.ip().to_string(),
            port: local_addr.port(),
            ..endpoint
        };
        let gateway = tokio::spawn(async move {
            let (mut gateway_stream, _) =
                listener.accept().await.map_err(TwsTransportError::read)?;
            let observed_requests =
                observe_startup_and_write_callbacks(&mut gateway_stream, ready_callback_fields())
                    .await?;
            gateway_stream
                .shutdown()
                .await
                .map_err(TwsTransportError::write)?;
            Ok::<Vec<Vec<String>>, TwsTransportError>(observed_requests)
        });

        let transcript = connect_and_run_startup(tcp_endpoint.clone(), 8).await?;
        let gateway_observed_requests = gateway.await.map_err(TwsTransportError::task)??;

        Ok(TwsTcpStartupEvidence {
            endpoint: tcp_endpoint,
            listener_address,
            transcript,
            gateway_observed_requests,
        })
    }

    pub async fn deterministic_app_state_callback_stream_evidence(
        endpoint: Endpoint,
    ) -> Result<TwsAppStateCallbackStreamEvidence, TwsTransportError> {
        let callback_fields = app_state_projection_callback_fields()?;
        deterministic_app_state_callback_stream_from_fields(endpoint, callback_fields).await
    }

    pub async fn deterministic_app_state_field_callback_stream_evidence(
        endpoint: Endpoint,
    ) -> Result<TwsAppStateCallbackStreamEvidence, TwsTransportError> {
        let callback_fields = app_state_projection_field_callback_fields()?;
        deterministic_app_state_callback_stream_from_fields(endpoint, callback_fields).await
    }

    async fn deterministic_app_state_callback_stream_from_fields(
        endpoint: Endpoint,
        callback_fields: Vec<Vec<String>>,
    ) -> Result<TwsAppStateCallbackStreamEvidence, TwsTransportError> {
        let (mut client_stream, mut gateway_stream) = tokio::io::duplex(65_536);
        let gateway = tokio::spawn(async move {
            let mut observed_requests = Vec::new();
            for _ in 0..STARTUP_REQUEST_COUNT {
                let (frame, _) = read_frame(&mut gateway_stream).await?;
                observed_requests.push(frame.fields);
            }
            for fields in ready_callback_fields() {
                write_fields(&mut gateway_stream, &fields).await?;
            }
            for fields in callback_fields {
                write_fields(&mut gateway_stream, &fields).await?;
            }
            gateway_stream
                .shutdown()
                .await
                .map_err(TwsTransportError::write)?;
            Ok::<Vec<Vec<String>>, TwsTransportError>(observed_requests)
        });

        let startup = run_startup_handshake(&mut client_stream, endpoint.clone(), 8).await?;
        let mut state = http_interface::AppState::with_broker_session(startup.session.clone());
        let mut post_ready_callbacks = Vec::new();
        let mut post_ready_bytes_read = 0;
        for _ in 0..4 {
            let (frame, frame_bytes) = read_frame(&mut client_stream).await?;
            post_ready_bytes_read += frame_bytes;
            let callback = tws_wire::decode_callback(&frame).map_err(TwsTransportError::wire)?;
            state.record_tws_callback(&callback);
            post_ready_callbacks.push(callback);
        }
        let gateway_observed_requests = gateway.await.map_err(TwsTransportError::task)??;
        let account_snapshot = state.account_state.snapshot();
        let market_snapshot = state.market_state.snapshot();
        let order_routing_snapshot = state.order_routing_state.snapshot();
        let event_replay_names = state
            .event_hub
            .replay()
            .iter()
            .map(|event| event.event.clone())
            .collect();

        Ok(TwsAppStateCallbackStreamEvidence {
            endpoint,
            startup,
            post_ready_callbacks,
            gateway_observed_requests,
            app_state_status: state.broker_session.status(),
            projected_summary_net_liquidation: account_snapshot
                .summary_for_account(PAPER_ACCOUNT_ID)
                .map(|summary| summary.net_liquidation),
            projected_quote_bid: market_snapshot
                .quote_for_con_id(AAPL_CON_ID)
                .map(|quote| quote.bid),
            projected_order_acknowledgements: order_routing_snapshot
                .placement_acknowledgements
                .iter()
                .map(|ack| ack.broker_order_id.clone())
                .collect(),
            event_replay_names,
            post_ready_bytes_read,
        })
    }

    async fn run_gateway_fixture(
        endpoint: Endpoint,
        callback_fields: Vec<Vec<String>>,
    ) -> Result<(TwsTransportTranscript, Vec<Vec<String>>), TwsTransportError> {
        let (mut client_stream, mut gateway_stream) = tokio::io::duplex(4096);
        let gateway = tokio::spawn(async move {
            let observed_requests =
                observe_startup_and_write_callbacks(&mut gateway_stream, callback_fields).await?;
            gateway_stream
                .shutdown()
                .await
                .map_err(TwsTransportError::write)?;
            Ok::<Vec<Vec<String>>, TwsTransportError>(observed_requests)
        });

        let transcript = run_startup_handshake(&mut client_stream, endpoint, 8).await?;
        let observed_requests = gateway.await.map_err(TwsTransportError::task)??;
        Ok((transcript, observed_requests))
    }

    async fn observe_startup_and_write_callbacks<S>(
        stream: &mut S,
        callback_fields: Vec<Vec<String>>,
    ) -> Result<Vec<Vec<String>>, TwsTransportError>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let mut observed_requests = Vec::new();
        for _ in 0..STARTUP_REQUEST_COUNT {
            let (frame, _) = read_frame(stream).await?;
            observed_requests.push(frame.fields);
        }
        for fields in callback_fields {
            write_fields(stream, &fields).await?;
        }
        Ok(observed_requests)
    }

    async fn read_frame<R>(reader: &mut R) -> Result<(TwsFrame, usize), TwsTransportError>
    where
        R: AsyncRead + Unpin,
    {
        let mut length_bytes = [0_u8; 4];
        reader
            .read_exact(&mut length_bytes)
            .await
            .map_err(TwsTransportError::read)?;
        let length = u32::from_be_bytes(length_bytes) as usize;
        if length > tws_wire::MAX_FRAME_BYTES {
            return Err(TwsTransportError {
                code: "frameTooLarge".to_string(),
                message: format!(
                    "TWS frame length {length} exceeds {}.",
                    tws_wire::MAX_FRAME_BYTES
                ),
            });
        }

        let mut payload = vec![0_u8; length];
        reader
            .read_exact(&mut payload)
            .await
            .map_err(TwsTransportError::read)?;
        let fields = tws_wire::decode_payload(&payload).map_err(TwsTransportError::wire)?;
        let frame = TwsFrame::new(fields).map_err(TwsTransportError::wire)?;
        Ok((frame, 4 + length))
    }

    async fn write_fields<W>(writer: &mut W, fields: &[String]) -> Result<(), TwsTransportError>
    where
        W: AsyncWrite + Unpin,
    {
        let encoded = tws_wire::encode_prefixed_fields(fields).map_err(TwsTransportError::wire)?;
        writer
            .write_all(&encoded)
            .await
            .map_err(TwsTransportError::write)?;
        writer.flush().await.map_err(TwsTransportError::write)
    }

    fn ready_callback_fields() -> Vec<Vec<String>> {
        vec![
            vec![
                tws_wire::IN_NEXT_VALID_ID.to_string(),
                tws_wire::REQUEST_VERSION.to_string(),
                "1901".to_string(),
            ],
            vec![
                tws_wire::IN_CURRENT_TIME.to_string(),
                tws_wire::REQUEST_VERSION.to_string(),
                "1800037800".to_string(),
            ],
            vec![
                tws_wire::IN_MANAGED_ACCOUNTS.to_string(),
                tws_wire::REQUEST_VERSION.to_string(),
                "DU1234567,U1234567".to_string(),
            ],
        ]
    }

    fn reconnect_callback_fields() -> Vec<Vec<String>> {
        vec![vec![
            tws_wire::IN_ERROR.to_string(),
            "2".to_string(),
            "-1".to_string(),
            "1100".to_string(),
            "Connectivity between IB and TWS has been lost.".to_string(),
        ]]
    }

    fn app_state_projection_callback_fields() -> Result<Vec<Vec<String>>, TwsTransportError> {
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let mut summary = account_fixture.summaries[0].clone();
        summary.net_liquidation = "275000.11".to_string();
        summary.buying_power = "130000.22".to_string();
        summary.captured_at = "2027-01-15T18:32:00Z".to_string();
        let mut order_status = account_fixture.open_orders[0].clone();
        order_status.remaining_quantity = "2".to_string();
        order_status.updated_at = "2027-01-15T18:32:01Z".to_string();
        let mut quote = market_fixture.quote.clone();
        quote.bid = "210.01".to_string();
        quote.ask = "210.05".to_string();
        quote.quote_timestamp = "2027-01-15T18:32:02Z".to_string();
        quote.captured_at = "2027-01-15T18:32:02.100Z".to_string();
        let paper_order = order_routing::paper_order_body();
        let paper_idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let mut acknowledgement =
            order_routing::paper_acknowledgement(&paper_order, Some(&paper_idempotency_key), false)
                .map_err(|message| TwsTransportError {
                    code: "deterministicCallbackFailed".to_string(),
                    message,
                })?;
        acknowledgement.broker_order_id = "IBKR-STREAM-CB-9002".to_string();
        acknowledgement.acknowledged_at = "2027-01-15T18:32:03Z".to_string();

        Ok(vec![
            tws_wire::callback_record_fields("accountSummary", &summary)
                .map_err(TwsTransportError::wire)?,
            tws_wire::callback_record_fields("orderStatus", &order_status)
                .map_err(TwsTransportError::wire)?,
            tws_wire::callback_record_fields("tickPrice", &quote)
                .map_err(TwsTransportError::wire)?,
            tws_wire::callback_record_fields("placeOrderAcknowledgement", &acknowledgement)
                .map_err(TwsTransportError::wire)?,
        ])
    }

    fn app_state_projection_field_callback_fields() -> Result<Vec<Vec<String>>, TwsTransportError> {
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let mut order_status = account_fixture.open_orders[0].clone();
        order_status.remaining_quantity = "1".to_string();
        order_status.updated_at = "2027-01-15T18:34:01Z".to_string();
        let paper_order = order_routing::paper_order_body();
        let paper_idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let mut acknowledgement =
            order_routing::paper_acknowledgement(&paper_order, Some(&paper_idempotency_key), false)
                .map_err(|message| TwsTransportError {
                    code: "deterministicCallbackFailed".to_string(),
                    message,
                })?;
        acknowledgement.broker_order_id = "IBKR-STREAM-FIELD-9004".to_string();
        acknowledgement.acknowledged_at = "2027-01-15T18:34:03Z".to_string();

        Ok(vec![
            tws_wire::field_callback_fields(
                "accountSummary",
                [
                    ("accountID", PAPER_ACCOUNT_ID.to_string()),
                    ("displayName", "IBKR Paper Stream Field".to_string()),
                    ("environment", "ibkrPaper".to_string()),
                    ("permissions", "stocks,options,paper-orders".to_string()),
                    ("netLiquidation", "285000.33".to_string()),
                    ("buyingPower", "142000.44".to_string()),
                    ("currency", "USD".to_string()),
                    ("capturedAt", "2027-01-15T18:34:00Z".to_string()),
                ],
            )
            .map_err(TwsTransportError::wire)?,
            tws_wire::field_callback_fields(
                "orderStatus",
                [
                    ("brokerOrderID", order_status.broker_order_id.clone()),
                    (
                        "permanentID",
                        order_status.permanent_id.clone().unwrap_or_default(),
                    ),
                    ("clientID", order_status.client_id.to_string()),
                    ("intentID", order_status.intent_id.clone()),
                    ("accountID", order_status.account_id.clone()),
                    ("environment", "ibkrPaper".to_string()),
                    ("status", order_status.status.clone()),
                    ("submittedAt", order_status.submitted_at.clone()),
                    ("updatedAt", order_status.updated_at.clone()),
                    ("filledQuantity", order_status.filled_quantity.clone()),
                    ("remainingQuantity", order_status.remaining_quantity.clone()),
                    (
                        "averageFillPrice",
                        order_status.average_fill_price.clone().unwrap_or_default(),
                    ),
                    ("parentBrokerOrderID", String::new()),
                    ("ocaGroup", String::new()),
                ],
            )
            .map_err(TwsTransportError::wire)?,
            tws_wire::field_callback_fields(
                "tickPrice",
                [
                    ("conID", market_fixture.quote.contract.con_id.to_string()),
                    ("symbol", market_fixture.quote.contract.symbol.clone()),
                    (
                        "securityType",
                        market_fixture.quote.contract.security_type.clone(),
                    ),
                    ("exchange", market_fixture.quote.contract.exchange.clone()),
                    (
                        "primaryExchange",
                        market_fixture
                            .quote
                            .contract
                            .primary_exchange
                            .clone()
                            .unwrap_or_default(),
                    ),
                    ("currency", market_fixture.quote.contract.currency.clone()),
                    (
                        "localSymbol",
                        market_fixture
                            .quote
                            .contract
                            .local_symbol
                            .clone()
                            .unwrap_or_default(),
                    ),
                    (
                        "tradingClass",
                        market_fixture
                            .quote
                            .contract
                            .trading_class
                            .clone()
                            .unwrap_or_default(),
                    ),
                    (
                        "timezoneIdentifier",
                        market_fixture
                            .quote
                            .contract
                            .timezone_identifier
                            .clone()
                            .unwrap_or_default(),
                    ),
                    (
                        "marketDataType",
                        market_fixture.quote.market_data_type.clone(),
                    ),
                    ("bid", "212.01".to_string()),
                    ("ask", "212.05".to_string()),
                    ("last", "212.03".to_string()),
                    ("bidSize", "140".to_string()),
                    ("askSize", "240".to_string()),
                    ("lastSize", "70".to_string()),
                    ("quoteTimestamp", "2027-01-15T18:34:02Z".to_string()),
                    ("capturedAt", "2027-01-15T18:34:02.100Z".to_string()),
                ],
            )
            .map_err(TwsTransportError::wire)?,
            tws_wire::field_callback_fields(
                "placeOrderAcknowledgement",
                [
                    ("requestID", acknowledgement.request_id.clone()),
                    ("idempotencyKey", acknowledgement.idempotency_key.clone()),
                    ("brokerOrderID", acknowledgement.broker_order_id.clone()),
                    ("accountID", acknowledgement.account_id.clone()),
                    ("environment", "ibkrPaper".to_string()),
                    ("status", acknowledgement.status.clone()),
                    ("acknowledgedAt", acknowledgement.acknowledged_at.clone()),
                    (
                        "lifecycleStateSource",
                        acknowledgement.lifecycle_state_source.clone(),
                    ),
                    ("message", acknowledgement.message.clone()),
                ],
            )
            .map_err(TwsTransportError::wire)?,
        ])
    }
}

pub mod broker_read_model {
    use crate::adapter_contract::{event_envelope, BrokerEnvironment, EventEnvelope};
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    pub const PAPER_ACCOUNT_ID: &str = "DU1234567";
    pub const LIVE_ACCOUNT_ID: &str = "U1234567";

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerAccountReference {
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub display_name: String,
        pub environment: BrokerEnvironment,
        pub is_paper_trading: bool,
        pub is_live_trading: bool,
        pub trading_permissions: Vec<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountSummary {
        pub account: BrokerAccountReference,
        pub net_liquidation: String,
        pub buying_power: String,
        pub currency: String,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerInstrument {
        #[serde(rename = "conID")]
        pub con_id: i64,
        pub symbol: String,
        pub security_type: String,
        pub currency: String,
        pub exchange: String,
        pub expiry: Option<String>,
        pub right: Option<String>,
        pub strike: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PositionSnapshot {
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub instrument: BrokerInstrument,
        pub quantity: String,
        pub average_cost: String,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderLinkage {
        #[serde(rename = "parentBrokerOrderID")]
        pub parent_broker_order_id: Option<String>,
        pub oca_group: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderStatusSnapshot {
        #[serde(rename = "brokerOrderID")]
        pub broker_order_id: String,
        #[serde(rename = "permanentID")]
        pub permanent_id: Option<String>,
        #[serde(rename = "clientID")]
        pub client_id: i32,
        #[serde(rename = "intentID")]
        pub intent_id: String,
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub environment: BrokerEnvironment,
        pub status: String,
        pub submitted_at: String,
        pub updated_at: String,
        pub filled_quantity: String,
        pub remaining_quantity: String,
        pub average_fill_price: Option<String>,
        pub linkage: Option<OrderLinkage>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FillOrderId {
        pub raw_value: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Fill {
        pub id: String,
        #[serde(rename = "orderID")]
        pub order_id: FillOrderId,
        pub symbol: String,
        pub side: String,
        pub quantity: String,
        pub price: String,
        pub filled_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FillReport {
        #[serde(rename = "brokerOrderID")]
        pub broker_order_id: String,
        #[serde(rename = "accountID", skip_serializing_if = "Option::is_none")]
        pub account_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub environment: Option<BrokerEnvironment>,
        pub fill: Fill,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub commission: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub commission_reported_at: Option<String>,
        pub currency: String,
        pub reported_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderLifecycleRecord {
        #[serde(rename = "brokerOrderID")]
        pub broker_order_id: String,
        #[serde(rename = "requestID")]
        pub request_id: String,
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub environment: BrokerEnvironment,
        pub status_timeline: Vec<OrderStatusSnapshot>,
        pub fills: Vec<FillReport>,
        pub commission_reported_fill_count: usize,
        pub latest_commission_reported_at: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FlexBrokerFillExport {
        #[serde(rename = "brokerOrderID")]
        pub broker_order_id: String,
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub environment: BrokerEnvironment,
        pub execution_id: String,
        pub symbol: String,
        pub side: String,
        pub quantity: String,
        pub price: String,
        pub currency: String,
        pub commission: String,
        pub commission_reported_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountStateFixture {
        pub accounts: Vec<BrokerAccountReference>,
        pub summaries: Vec<AccountSummary>,
        pub positions: Vec<PositionSnapshot>,
        pub open_orders: Vec<OrderStatusSnapshot>,
        pub completed_orders: Vec<OrderStatusSnapshot>,
        pub fills: Vec<FillReport>,
        pub lifecycle_records: Vec<OrderLifecycleRecord>,
        pub initial_fill_event: EventEnvelope,
        pub commission_update_event: EventEnvelope,
        pub event_transcript: Vec<EventEnvelope>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum AccountStateCallback {
        ManagedAccounts {
            accounts: Vec<BrokerAccountReference>,
        },
        AccountSummary {
            summary: AccountSummary,
        },
        Position {
            position: PositionSnapshot,
        },
        OrderStatus {
            status: OrderStatusSnapshot,
        },
        Fill {
            fill: FillReport,
        },
        CommissionReport {
            #[serde(rename = "brokerOrderID")]
            broker_order_id: String,
            execution_id: String,
            commission: String,
            commission_reported_at: String,
            reported_at: String,
        },
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountStateCallbackEvidence {
        pub callback_count: usize,
        pub event_names: Vec<String>,
        pub account_state: AccountStateFixture,
        pub flex_export_rows: Vec<FlexBrokerFillExport>,
    }

    impl Default for AccountStateFixture {
        fn default() -> Self {
            Self::callback_backed()
        }
    }

    impl AccountStateFixture {
        pub fn callback_backed() -> Self {
            let fixture = Self::deterministic();
            Self::from_broker_callbacks(&fixture.broker_callback_transcript())
        }

        pub fn deterministic_callback_evidence() -> AccountStateCallbackEvidence {
            let transcript = Self::deterministic().broker_callback_transcript();
            let account_state = Self::from_broker_callbacks(&transcript);
            let event_names = account_state
                .event_transcript
                .iter()
                .map(|event| event.event.clone())
                .collect();
            let flex_export_rows = account_state.flex_export_rows(PAPER_ACCOUNT_ID);
            AccountStateCallbackEvidence {
                callback_count: transcript.len(),
                event_names,
                account_state,
                flex_export_rows,
            }
        }

        pub fn deterministic() -> Self {
            let paper_account = account(
                PAPER_ACCOUNT_ID,
                "IBKR Paper",
                BrokerEnvironment::IbkrPaper,
                true,
                false,
                ["stocks", "options", "paper-orders"],
            );
            let live_account = account(
                LIVE_ACCOUNT_ID,
                "IBKR Live",
                BrokerEnvironment::IbkrLive,
                false,
                true,
                ["stocks", "options", "live-preview"],
            );
            let captured_at = "2027-01-15T18:30:00.000Z";
            let submitted_at = "2027-01-15T18:30:00.250Z";
            let fill_time = "2027-01-15T18:30:01.250Z";
            let commission_time = "2027-01-15T18:30:02.500Z";
            let intent_id = "11111111-1111-1111-1111-111111111111";

            let summaries = vec![
                AccountSummary {
                    account: paper_account.clone(),
                    net_liquidation: "125000.50".to_string(),
                    buying_power: "500000.00".to_string(),
                    currency: "USD".to_string(),
                    captured_at: captured_at.to_string(),
                },
                AccountSummary {
                    account: live_account.clone(),
                    net_liquidation: "250000.00".to_string(),
                    buying_power: "100000.00".to_string(),
                    currency: "USD".to_string(),
                    captured_at: captured_at.to_string(),
                },
            ];

            let positions = vec![
                PositionSnapshot {
                    account_id: PAPER_ACCOUNT_ID.to_string(),
                    instrument: BrokerInstrument {
                        con_id: 265598,
                        symbol: "AAPL".to_string(),
                        security_type: "STK".to_string(),
                        currency: "USD".to_string(),
                        exchange: "SMART".to_string(),
                        expiry: None,
                        right: None,
                        strike: None,
                    },
                    quantity: "12".to_string(),
                    average_cost: "197.25".to_string(),
                    captured_at: captured_at.to_string(),
                },
                PositionSnapshot {
                    account_id: PAPER_ACCOUNT_ID.to_string(),
                    instrument: BrokerInstrument {
                        con_id: 76792991,
                        symbol: "AAPL".to_string(),
                        security_type: "OPT".to_string(),
                        currency: "USD".to_string(),
                        exchange: "SMART".to_string(),
                        expiry: Some("20270115".to_string()),
                        right: Some("C".to_string()),
                        strike: Some("210".to_string()),
                    },
                    quantity: "1".to_string(),
                    average_cost: "3.40".to_string(),
                    captured_at: captured_at.to_string(),
                },
                PositionSnapshot {
                    account_id: LIVE_ACCOUNT_ID.to_string(),
                    instrument: BrokerInstrument {
                        con_id: 272093,
                        symbol: "MSFT".to_string(),
                        security_type: "STK".to_string(),
                        currency: "USD".to_string(),
                        exchange: "SMART".to_string(),
                        expiry: None,
                        right: None,
                        strike: None,
                    },
                    quantity: "5".to_string(),
                    average_cost: "430.10".to_string(),
                    captured_at: captured_at.to_string(),
                },
            ];

            let submitted = order_status(
                "1000",
                "perm-1000",
                intent_id,
                PAPER_ACCOUNT_ID,
                BrokerEnvironment::IbkrPaper,
                "submitted",
                submitted_at,
                submitted_at,
                "0",
                "2",
                None,
                None,
            );
            let filled = order_status(
                "1000",
                "perm-1000",
                intent_id,
                PAPER_ACCOUNT_ID,
                BrokerEnvironment::IbkrPaper,
                "filled",
                submitted_at,
                fill_time,
                "2",
                "0",
                Some("208.12"),
                None,
            );
            let open_child = order_status(
                "1001",
                "perm-1001",
                intent_id,
                PAPER_ACCOUNT_ID,
                BrokerEnvironment::IbkrPaper,
                "submitted",
                submitted_at,
                "2027-01-15T18:30:01.000Z",
                "0",
                "2",
                None,
                Some(OrderLinkage {
                    parent_broker_order_id: Some("1000".to_string()),
                    oca_group: Some("bracket-11111111".to_string()),
                }),
            );

            let initial_fill = fill_report(
                "1000",
                PAPER_ACCOUNT_ID,
                BrokerEnvironment::IbkrPaper,
                "22222222-2222-2222-2222-222222222222",
                intent_id,
                "AAPL",
                "buy",
                "2",
                "208.12",
                fill_time,
                None,
                None,
                "2027-01-15T18:30:02.250Z",
            );
            let commissioned_fill = fill_report(
                "1000",
                PAPER_ACCOUNT_ID,
                BrokerEnvironment::IbkrPaper,
                "22222222-2222-2222-2222-222222222222",
                intent_id,
                "AAPL",
                "buy",
                "2",
                "208.12",
                fill_time,
                Some("1.25"),
                Some(commission_time),
                "2027-01-15T18:30:02.750Z",
            );
            let second_fill = fill_report(
                "1002",
                PAPER_ACCOUNT_ID,
                BrokerEnvironment::IbkrPaper,
                "44444444-4444-4444-4444-444444444444",
                "55555555-5555-5555-5555-555555555555",
                "AAPL",
                "sell",
                "1",
                "209.37",
                "2027-01-15T19:30:01.250Z",
                Some("1.00"),
                Some("2027-01-15T19:30:02.500Z"),
                "2027-01-15T19:30:02.750Z",
            );

            let initial_fill_event = event_envelope("fill.report", json!(initial_fill));
            let commission_update_event = event_envelope(
                "fill.report",
                json!({
                    "commissionEventUpdate": true,
                    "fill": commissioned_fill
                }),
            );
            let event_transcript = vec![
                event_envelope("account.summary", json!(summaries[0])),
                event_envelope("position.snapshot", json!(positions[0])),
                event_envelope("order.status", json!(submitted)),
                initial_fill_event.clone(),
                commission_update_event.clone(),
            ];

            Self {
                accounts: vec![paper_account, live_account],
                summaries,
                positions,
                open_orders: vec![open_child],
                completed_orders: vec![filled.clone()],
                fills: vec![commissioned_fill.clone(), second_fill],
                lifecycle_records: vec![OrderLifecycleRecord {
                    broker_order_id: "1000".to_string(),
                    request_id: intent_id.to_string(),
                    account_id: PAPER_ACCOUNT_ID.to_string(),
                    environment: BrokerEnvironment::IbkrPaper,
                    status_timeline: vec![submitted, filled],
                    fills: vec![commissioned_fill],
                    commission_reported_fill_count: 1,
                    latest_commission_reported_at: Some(commission_time.to_string()),
                }],
                initial_fill_event,
                commission_update_event,
                event_transcript,
            }
        }

        pub fn broker_callback_transcript(&self) -> Vec<AccountStateCallback> {
            let mut callbacks = vec![AccountStateCallback::ManagedAccounts {
                accounts: self.accounts.clone(),
            }];
            callbacks.extend(
                self.summaries
                    .iter()
                    .cloned()
                    .map(|summary| AccountStateCallback::AccountSummary { summary }),
            );
            callbacks.extend(
                self.positions
                    .iter()
                    .cloned()
                    .map(|position| AccountStateCallback::Position { position }),
            );
            callbacks.extend(self.lifecycle_records.iter().flat_map(|record| {
                record
                    .status_timeline
                    .iter()
                    .cloned()
                    .map(|status| AccountStateCallback::OrderStatus { status })
            }));
            callbacks.extend(
                self.open_orders
                    .iter()
                    .cloned()
                    .map(|status| AccountStateCallback::OrderStatus { status }),
            );

            let initial_fill =
                serde_json::from_value::<FillReport>(self.initial_fill_event.payload.clone())
                    .expect("deterministic initial fill event");
            callbacks.push(AccountStateCallback::Fill {
                fill: initial_fill.clone(),
            });
            let commissioned_fill = serde_json::from_value::<FillReport>(
                self.commission_update_event
                    .payload
                    .get("fill")
                    .cloned()
                    .expect("deterministic commission update fill"),
            )
            .expect("deterministic commission update fill payload");
            callbacks.push(AccountStateCallback::CommissionReport {
                broker_order_id: commissioned_fill.broker_order_id.clone(),
                execution_id: commissioned_fill.fill.id.clone(),
                commission: commissioned_fill
                    .commission
                    .clone()
                    .expect("deterministic commission amount"),
                commission_reported_at: commissioned_fill
                    .commission_reported_at
                    .clone()
                    .expect("deterministic commission timestamp"),
                reported_at: commissioned_fill.reported_at.clone(),
            });
            callbacks.extend(
                self.fills
                    .iter()
                    .filter(|fill| {
                        fill.fill.id != initial_fill.fill.id
                            || fill.broker_order_id != initial_fill.broker_order_id
                    })
                    .cloned()
                    .map(|fill| AccountStateCallback::Fill { fill }),
            );
            callbacks
        }

        pub fn from_broker_callbacks(callbacks: &[AccountStateCallback]) -> Self {
            let mut accumulator = AccountStateAccumulator::default();
            for callback in callbacks {
                accumulator.apply(callback.clone());
            }
            accumulator.finish()
        }

        pub fn summary_for_account(&self, account_id: &str) -> Option<AccountSummary> {
            self.summaries
                .iter()
                .find(|summary| summary.account.account_id == account_id)
                .cloned()
        }

        pub fn positions_for_account(&self, account_id: &str) -> Vec<PositionSnapshot> {
            self.positions
                .iter()
                .filter(|position| position.account_id == account_id)
                .cloned()
                .collect()
        }

        pub fn open_orders_for_account(&self, account_id: &str) -> Vec<OrderStatusSnapshot> {
            self.open_orders
                .iter()
                .filter(|order| order.account_id == account_id)
                .cloned()
                .collect()
        }

        pub fn completed_orders_for_account(&self, account_id: &str) -> Vec<OrderStatusSnapshot> {
            self.completed_orders
                .iter()
                .filter(|order| order.account_id == account_id)
                .cloned()
                .collect()
        }

        pub fn fills_for_account(&self, account_id: &str) -> Vec<FillReport> {
            self.fills
                .iter()
                .filter(|fill| fill.account_id.as_deref() == Some(account_id))
                .cloned()
                .collect()
        }

        pub fn flex_export_rows(&self, account_id: &str) -> Vec<FlexBrokerFillExport> {
            self.fills_for_account(account_id)
                .into_iter()
                .filter_map(|fill| {
                    Some(FlexBrokerFillExport {
                        broker_order_id: fill.broker_order_id,
                        account_id: fill.account_id?,
                        environment: fill.environment?,
                        execution_id: fill.fill.id,
                        symbol: fill.fill.symbol,
                        side: fill.fill.side,
                        quantity: fill.fill.quantity,
                        price: fill.fill.price,
                        currency: fill.currency,
                        commission: fill.commission?,
                        commission_reported_at: fill.commission_reported_at?,
                    })
                })
                .collect()
        }

        pub fn paper_live_accounts_are_distinct(&self) -> bool {
            let paper = self
                .accounts
                .iter()
                .find(|account| account.environment == BrokerEnvironment::IbkrPaper);
            let live = self
                .accounts
                .iter()
                .find(|account| account.environment == BrokerEnvironment::IbkrLive);
            matches!(
                (paper, live),
                (Some(paper), Some(live))
                    if paper.account_id.starts_with("DU")
                        && live.account_id.starts_with('U')
                        && paper.is_paper_trading
                        && !paper.is_live_trading
                        && live.is_live_trading
                        && !live.is_paper_trading
                        && paper.trading_permissions.contains(&"paper-orders".to_string())
                        && live.trading_permissions.contains(&"live-preview".to_string())
            )
        }

        pub fn summaries_are_account_scoped(&self) -> bool {
            self.summaries.iter().all(|summary| {
                !summary.account.account_id.is_empty()
                    && summary.currency == "USD"
                    && !summary.net_liquidation.starts_with('-')
                    && !summary.buying_power.starts_with('-')
            })
        }

        pub fn positions_include_option_exercise_source(&self) -> bool {
            self.positions.iter().any(|position| {
                position.account_id == PAPER_ACCOUNT_ID
                    && position.instrument.security_type == "OPT"
                    && position.instrument.right.as_deref() == Some("C")
                    && position.instrument.strike.as_deref() == Some("210")
                    && position.quantity != "0"
            })
        }

        pub fn reconciliation_is_account_scoped(&self) -> bool {
            self.open_orders
                .iter()
                .chain(self.completed_orders.iter())
                .all(|order| order.account_id == PAPER_ACCOUNT_ID)
                && self.fills_for_account(PAPER_ACCOUNT_ID).iter().all(|fill| {
                    fill.account_id.as_deref() == Some(PAPER_ACCOUNT_ID)
                        && fill.environment == Some(BrokerEnvironment::IbkrPaper)
                })
        }

        pub fn has_parent_oca_linkage(&self) -> bool {
            self.open_orders.iter().any(|order| {
                order.linkage.as_ref().is_some_and(|linkage| {
                    linkage.parent_broker_order_id.as_deref() == Some("1000")
                        && linkage.oca_group.as_deref() == Some("bracket-11111111")
                })
            })
        }

        pub fn lifecycle_is_sorted_and_commissioned(&self) -> bool {
            self.lifecycle_records.iter().all(|record| {
                let statuses_sorted = record
                    .status_timeline
                    .windows(2)
                    .all(|pair| pair[0].updated_at <= pair[1].updated_at);
                let fills_sorted = record
                    .fills
                    .windows(2)
                    .all(|pair| pair[0].reported_at <= pair[1].reported_at);
                statuses_sorted
                    && fills_sorted
                    && record.commission_reported_fill_count
                        == record
                            .fills
                            .iter()
                            .filter(|fill| fill.commission_reported_at.is_some())
                            .count()
                    && record.latest_commission_reported_at.as_deref()
                        == Some("2027-01-15T18:30:02.500Z")
            })
        }

        pub fn late_commission_update_republishes_fill(&self) -> bool {
            let initial = self
                .initial_fill_event
                .payload
                .get("commission")
                .is_none_or(|value| value.is_null());
            let update = self
                .commission_update_event
                .payload
                .get("commissionEventUpdate")
                == Some(&json!(true))
                && self
                    .commission_update_event
                    .payload
                    .pointer("/fill/commissionReportedAt")
                    .is_some_and(|value| value == "2027-01-15T18:30:02.500Z");
            initial && update
        }

        pub fn has_replayable_events(&self) -> bool {
            let names = self
                .event_transcript
                .iter()
                .map(|event| event.event.as_str())
                .collect::<Vec<_>>();
            [
                "account.summary",
                "position.snapshot",
                "order.status",
                "fill.report",
            ]
            .iter()
            .all(|name| names.contains(name))
        }

        pub fn flex_export_matches_fixture(&self) -> bool {
            let rows = self.flex_export_rows(PAPER_ACCOUNT_ID);
            rows.len() == 2
                && rows.iter().all(|row| {
                    row.account_id == PAPER_ACCOUNT_ID
                        && row.environment == BrokerEnvironment::IbkrPaper
                        && row.symbol == "AAPL"
                        && row.currency == "USD"
                        && !row.commission.is_empty()
                })
                && rows
                    .iter()
                    .map(|row| row.commission.as_str())
                    .collect::<Vec<_>>()
                    == ["1.25", "1.00"]
        }
    }

    #[derive(Clone, Debug)]
    pub struct AccountStateStore {
        state: Arc<Mutex<AccountStateFixture>>,
    }

    impl Default for AccountStateStore {
        fn default() -> Self {
            Self::from_fixture(AccountStateFixture::default())
        }
    }

    impl AccountStateStore {
        pub fn from_fixture(fixture: AccountStateFixture) -> Self {
            Self {
                state: Arc::new(Mutex::new(fixture)),
            }
        }

        pub fn from_callbacks(callbacks: &[AccountStateCallback]) -> Self {
            Self::from_fixture(AccountStateFixture::from_broker_callbacks(callbacks))
        }

        pub fn record(&self, callback: AccountStateCallback) -> Vec<EventEnvelope> {
            let mut state = self.state.lock().expect("account state lock poisoned");
            let mut callbacks = state.broker_callback_transcript();
            callbacks.push(callback.clone());
            let rebuilt = AccountStateFixture::from_broker_callbacks(&callbacks);
            let events = account_events_for_callback(&callback, &rebuilt);
            *state = rebuilt;
            events
        }

        pub fn snapshot(&self) -> AccountStateFixture {
            self.state
                .lock()
                .expect("account state lock poisoned")
                .clone()
        }
    }

    #[derive(Default)]
    struct AccountStateAccumulator {
        accounts: Vec<BrokerAccountReference>,
        summaries: Vec<AccountSummary>,
        positions: Vec<PositionSnapshot>,
        latest_orders: HashMap<String, OrderStatusSnapshot>,
        status_timeline: HashMap<String, Vec<OrderStatusSnapshot>>,
        fills: HashMap<(String, String), FillReport>,
        initial_fill_event: Option<EventEnvelope>,
        commission_update_event: Option<EventEnvelope>,
        event_transcript: Vec<EventEnvelope>,
    }

    impl AccountStateAccumulator {
        fn apply(&mut self, callback: AccountStateCallback) {
            match callback {
                AccountStateCallback::ManagedAccounts { accounts } => {
                    self.accounts = accounts;
                }
                AccountStateCallback::AccountSummary { summary } => {
                    self.event_transcript
                        .push(event_envelope("account.summary", json!(summary)));
                    upsert_by(&mut self.summaries, summary, |summary| {
                        summary.account.account_id.clone()
                    });
                }
                AccountStateCallback::Position { position } => {
                    self.event_transcript
                        .push(event_envelope("position.snapshot", json!(position)));
                    upsert_by(&mut self.positions, position, |position| {
                        format!("{}:{}", position.account_id, position.instrument.con_id)
                    });
                }
                AccountStateCallback::OrderStatus { status } => {
                    self.event_transcript
                        .push(event_envelope("order.status", json!(status)));
                    self.latest_orders
                        .insert(status.broker_order_id.clone(), status.clone());
                    self.status_timeline
                        .entry(status.broker_order_id.clone())
                        .or_default()
                        .push(status);
                }
                AccountStateCallback::Fill { fill } => {
                    let event = event_envelope("fill.report", json!(fill));
                    if self.initial_fill_event.is_none() {
                        self.initial_fill_event = Some(event.clone());
                    }
                    self.event_transcript.push(event);
                    self.fills
                        .insert((fill.broker_order_id.clone(), fill.fill.id.clone()), fill);
                }
                AccountStateCallback::CommissionReport {
                    broker_order_id,
                    execution_id,
                    commission,
                    commission_reported_at,
                    reported_at,
                } => {
                    if let Some(fill) = self
                        .fills
                        .get_mut(&(broker_order_id.clone(), execution_id.clone()))
                    {
                        fill.commission = Some(commission);
                        fill.commission_reported_at = Some(commission_reported_at);
                        fill.reported_at = reported_at;
                        let event = event_envelope(
                            "fill.report",
                            json!({
                                "commissionEventUpdate": true,
                                "fill": fill
                            }),
                        );
                        self.commission_update_event = Some(event.clone());
                        self.event_transcript.push(event);
                    }
                }
            }
        }

        fn finish(mut self) -> AccountStateFixture {
            for statuses in self.status_timeline.values_mut() {
                statuses.sort_by(|left, right| left.updated_at.cmp(&right.updated_at));
            }
            let mut latest_orders = self.latest_orders.into_values().collect::<Vec<_>>();
            latest_orders.sort_by(|left, right| left.broker_order_id.cmp(&right.broker_order_id));
            let (completed_orders, open_orders): (Vec<_>, Vec<_>) =
                latest_orders.into_iter().partition(|order| {
                    matches!(order.status.as_str(), "filled" | "cancelled" | "inactive")
                        || order.remaining_quantity == "0"
                });
            let mut fills = self.fills.into_values().collect::<Vec<_>>();
            fills.sort_by(|left, right| left.reported_at.cmp(&right.reported_at));
            let lifecycle_records = self
                .status_timeline
                .into_iter()
                .filter_map(|(broker_order_id, status_timeline)| {
                    let latest = status_timeline.last()?;
                    let record_fills = fills
                        .iter()
                        .filter(|fill| fill.broker_order_id == broker_order_id)
                        .cloned()
                        .collect::<Vec<_>>();
                    if record_fills.is_empty() {
                        return None;
                    }
                    let commission_reported_fill_count = record_fills
                        .iter()
                        .filter(|fill| fill.commission_reported_at.is_some())
                        .count();
                    let latest_commission_reported_at = record_fills
                        .iter()
                        .filter_map(|fill| fill.commission_reported_at.clone())
                        .max();
                    Some(OrderLifecycleRecord {
                        broker_order_id,
                        request_id: latest.intent_id.clone(),
                        account_id: latest.account_id.clone(),
                        environment: latest.environment,
                        status_timeline,
                        fills: record_fills,
                        commission_reported_fill_count,
                        latest_commission_reported_at,
                    })
                })
                .collect();

            AccountStateFixture {
                accounts: self.accounts,
                summaries: self.summaries,
                positions: self.positions,
                open_orders,
                completed_orders,
                fills,
                lifecycle_records,
                initial_fill_event: self
                    .initial_fill_event
                    .unwrap_or_else(|| event_envelope("fill.report", json!({ "missing": true }))),
                commission_update_event: self.commission_update_event.unwrap_or_else(|| {
                    event_envelope("fill.report", json!({ "commissionEventUpdate": false }))
                }),
                event_transcript: self.event_transcript,
            }
        }
    }

    fn upsert_by<T, F>(values: &mut Vec<T>, value: T, key: F)
    where
        F: Fn(&T) -> String,
    {
        let value_key = key(&value);
        if let Some(existing) = values
            .iter_mut()
            .find(|existing| key(existing) == value_key)
        {
            *existing = value;
        } else {
            values.push(value);
        }
    }

    fn account_events_for_callback(
        callback: &AccountStateCallback,
        rebuilt: &AccountStateFixture,
    ) -> Vec<EventEnvelope> {
        match callback {
            AccountStateCallback::ManagedAccounts { .. } => Vec::new(),
            AccountStateCallback::AccountSummary { summary } => {
                vec![event_envelope("account.summary", json!(summary))]
            }
            AccountStateCallback::Position { position } => {
                vec![event_envelope("position.snapshot", json!(position))]
            }
            AccountStateCallback::OrderStatus { status } => {
                vec![event_envelope("order.status", json!(status))]
            }
            AccountStateCallback::Fill { fill } => vec![event_envelope("fill.report", json!(fill))],
            AccountStateCallback::CommissionReport {
                broker_order_id,
                execution_id,
                ..
            } => rebuilt
                .fills
                .iter()
                .find(|fill| {
                    &fill.broker_order_id == broker_order_id && &fill.fill.id == execution_id
                })
                .map(|fill| {
                    vec![event_envelope(
                        "fill.report",
                        json!({
                            "commissionEventUpdate": true,
                            "fill": fill
                        }),
                    )]
                })
                .unwrap_or_default(),
        }
    }

    fn account<const N: usize>(
        account_id: &str,
        display_name: &str,
        environment: BrokerEnvironment,
        is_paper_trading: bool,
        is_live_trading: bool,
        trading_permissions: [&str; N],
    ) -> BrokerAccountReference {
        BrokerAccountReference {
            account_id: account_id.to_string(),
            display_name: display_name.to_string(),
            environment,
            is_paper_trading,
            is_live_trading,
            trading_permissions: trading_permissions
                .iter()
                .map(|permission| (*permission).to_string())
                .collect(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn order_status(
        broker_order_id: &str,
        permanent_id: &str,
        intent_id: &str,
        account_id: &str,
        environment: BrokerEnvironment,
        status: &str,
        submitted_at: &str,
        updated_at: &str,
        filled_quantity: &str,
        remaining_quantity: &str,
        average_fill_price: Option<&str>,
        linkage: Option<OrderLinkage>,
    ) -> OrderStatusSnapshot {
        OrderStatusSnapshot {
            broker_order_id: broker_order_id.to_string(),
            permanent_id: Some(permanent_id.to_string()),
            client_id: 42,
            intent_id: intent_id.to_string(),
            account_id: account_id.to_string(),
            environment,
            status: status.to_string(),
            submitted_at: submitted_at.to_string(),
            updated_at: updated_at.to_string(),
            filled_quantity: filled_quantity.to_string(),
            remaining_quantity: remaining_quantity.to_string(),
            average_fill_price: average_fill_price.map(ToString::to_string),
            linkage,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn fill_report(
        broker_order_id: &str,
        account_id: &str,
        environment: BrokerEnvironment,
        fill_id: &str,
        order_id: &str,
        symbol: &str,
        side: &str,
        quantity: &str,
        price: &str,
        filled_at: &str,
        commission: Option<&str>,
        commission_reported_at: Option<&str>,
        reported_at: &str,
    ) -> FillReport {
        FillReport {
            broker_order_id: broker_order_id.to_string(),
            account_id: Some(account_id.to_string()),
            environment: Some(environment),
            fill: Fill {
                id: fill_id.to_string(),
                order_id: FillOrderId {
                    raw_value: order_id.to_string(),
                },
                symbol: symbol.to_string(),
                side: side.to_string(),
                quantity: quantity.to_string(),
                price: price.to_string(),
                filled_at: filled_at.to_string(),
            },
            commission: commission.map(ToString::to_string),
            commission_reported_at: commission_reported_at.map(ToString::to_string),
            currency: "USD".to_string(),
            reported_at: reported_at.to_string(),
        }
    }
}

pub mod market_read_model {
    use crate::adapter_contract::{event_envelope, now_rfc3339, EventEnvelope, API_VERSION};
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    pub const AAPL_CON_ID: i64 = 265598;
    pub const AAPL_OPTION_CON_ID: i64 = 76792991;

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ContractIdentity {
        #[serde(rename = "conID")]
        pub con_id: i64,
        pub symbol: String,
        pub security_type: String,
        pub exchange: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub primary_exchange: Option<String>,
        pub currency: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub local_symbol: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub trading_class: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub multiplier: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub timezone_identifier: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MinimumTickIncrement {
        pub low_edge: String,
        pub increment: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarketRule {
        #[serde(rename = "marketRuleID")]
        pub market_rule_id: String,
        pub minimum_tick: String,
        pub increments: Vec<MinimumTickIncrement>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ContractDetails {
        pub contract: ContractIdentity,
        #[serde(rename = "marketRuleIDs")]
        pub market_rule_ids: Vec<String>,
        pub minimum_tick: String,
        pub valid_exchanges: Vec<String>,
        pub trading_hours: Option<String>,
        pub liquid_hours: Option<String>,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct QuoteSnapshot {
        pub contract: ContractIdentity,
        pub market_data_type: String,
        pub bid: String,
        pub ask: String,
        pub last: Option<String>,
        pub bid_size: Option<String>,
        pub ask_size: Option<String>,
        pub last_size: Option<String>,
        pub quote_timestamp: String,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Timeframe {
        pub value: u32,
        pub unit: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Bar {
        pub symbol: String,
        pub venue: String,
        pub timeframe: Timeframe,
        pub timestamp: String,
        pub open: String,
        pub high: String,
        pub low: String,
        pub close: String,
        pub volume: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct HistoricalBarsResponse {
        pub contract: ContractIdentity,
        pub timeframe: Timeframe,
        pub request_duration: String,
        pub what_to_show: String,
        pub regular_trading_hours_only: bool,
        pub bars: Vec<Bar>,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct HistoricalTickAttributes {
        pub bid_past_low: Option<bool>,
        pub ask_past_high: Option<bool>,
        pub past_limit: Option<bool>,
        pub unreported: Option<bool>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct HistoricalTick {
        pub kind: String,
        pub time: String,
        pub price: Option<String>,
        pub size: Option<String>,
        pub bid: Option<String>,
        pub ask: Option<String>,
        pub bid_size: Option<String>,
        pub ask_size: Option<String>,
        pub exchange: Option<String>,
        pub special_conditions: Option<String>,
        pub attributes: Option<HistoricalTickAttributes>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct HistoricalTicksResponse {
        pub api_version: String,
        pub contract: ContractIdentity,
        pub start_date_time: String,
        pub end_date_time: String,
        pub requested_tick_count: u16,
        pub what_to_show: String,
        pub regular_trading_hours_only: bool,
        pub ignore_size: bool,
        pub tick_count: usize,
        pub ticks: Vec<HistoricalTick>,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OptionChainSnapshot {
        pub underlying: ContractIdentity,
        pub trading_class: String,
        pub exchange: String,
        pub currency: String,
        pub multiplier: String,
        pub expirations: Vec<String>,
        pub strikes: Vec<String>,
        pub rights: Vec<String>,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OptionContract {
        pub contract: ContractIdentity,
        #[serde(rename = "underlyingConID")]
        pub underlying_con_id: i64,
        pub expiration: String,
        pub strike: String,
        pub right: String,
        pub multiplier: String,
        pub trading_class: String,
        pub exchange: String,
        pub currency: String,
        pub exercise_style: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OptionGreeks {
        pub delta: Option<String>,
        pub gamma: Option<String>,
        pub theta: Option<String>,
        pub vega: Option<String>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OptionQuoteSnapshot {
        pub contract: OptionContract,
        pub market_data_type: String,
        pub bid: String,
        pub ask: String,
        pub last: Option<String>,
        pub bid_size: Option<String>,
        pub ask_size: Option<String>,
        pub last_size: Option<String>,
        pub volume: Option<String>,
        pub open_interest: Option<String>,
        pub implied_volatility: Option<String>,
        pub greeks: Option<OptionGreeks>,
        pub quote_timestamp: String,
        pub captured_at: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct HistoricalPacingEvidence {
        pub active_request_cap: u16,
        pub ten_minute_weight_limit: u16,
        pub duplicate_suppression_seconds: u16,
        pub bid_ask_weight: u8,
        pub retry_after_seconds: u16,
        pub cached_fallback_available: bool,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarketDataFixture {
        pub stock_contract: ContractIdentity,
        pub option_contract: OptionContract,
        pub stock_details: ContractDetails,
        pub option_details: ContractDetails,
        pub market_rule: MarketRule,
        pub quote: QuoteSnapshot,
        pub historical_bars: HistoricalBarsResponse,
        pub historical_ticks: HistoricalTicksResponse,
        pub option_chain: OptionChainSnapshot,
        pub option_quote: OptionQuoteSnapshot,
        pub pacing: HistoricalPacingEvidence,
        pub event_transcript: Vec<EventEnvelope>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum MarketDataCallback {
        ContractDetails { details: Box<ContractDetails> },
        MarketRule { market_rule: MarketRule },
        Quote { quote: Box<QuoteSnapshot> },
        HistoricalBars { bars: Box<HistoricalBarsResponse> },
        HistoricalTicks { ticks: Box<HistoricalTicksResponse> },
        OptionChain { chain: Box<OptionChainSnapshot> },
        OptionContract { contract: Box<OptionContract> },
        OptionDetails { details: Box<ContractDetails> },
        OptionQuote { quote: Box<OptionQuoteSnapshot> },
        HistoricalPacing { pacing: HistoricalPacingEvidence },
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarketDataCallbackEvidence {
        pub callback_count: usize,
        pub event_names: Vec<String>,
        pub market_state: MarketDataFixture,
    }

    #[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub enum MarketDataStreamKind {
        Quote,
        Bars,
    }

    impl MarketDataStreamKind {
        pub fn as_wire_value(self) -> &'static str {
            match self {
                Self::Quote => "quote",
                Self::Bars => "bars",
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarketDataSubscriptionAck {
        pub api_version: String,
        pub stream: String,
        #[serde(rename = "conID")]
        pub con_id: i64,
        pub status: String,
        pub active: bool,
        pub replayed_event_count: usize,
        pub recorded_at: String,
    }

    impl Default for MarketDataFixture {
        fn default() -> Self {
            Self::callback_backed()
        }
    }

    impl MarketDataFixture {
        pub fn callback_backed() -> Self {
            let fixture = Self::deterministic();
            Self::from_broker_callbacks(&fixture.broker_callback_transcript())
        }

        pub fn deterministic_callback_evidence() -> MarketDataCallbackEvidence {
            let transcript = Self::deterministic().broker_callback_transcript();
            let market_state = Self::from_broker_callbacks(&transcript);
            let event_names = market_state
                .event_transcript
                .iter()
                .map(|event| event.event.clone())
                .collect();
            MarketDataCallbackEvidence {
                callback_count: transcript.len(),
                event_names,
                market_state,
            }
        }

        pub fn deterministic() -> Self {
            let captured_at = "2027-01-15T18:30:00.000Z";
            let stock_contract = ContractIdentity {
                con_id: AAPL_CON_ID,
                symbol: "AAPL".to_string(),
                security_type: "STK".to_string(),
                exchange: "SMART".to_string(),
                primary_exchange: Some("NASDAQ".to_string()),
                currency: "USD".to_string(),
                local_symbol: Some("AAPL".to_string()),
                trading_class: Some("NMS".to_string()),
                multiplier: None,
                timezone_identifier: Some("America/New_York".to_string()),
            };
            let option_identity = ContractIdentity {
                con_id: AAPL_OPTION_CON_ID,
                symbol: "AAPL".to_string(),
                security_type: "OPT".to_string(),
                exchange: "SMART".to_string(),
                primary_exchange: None,
                currency: "USD".to_string(),
                local_symbol: Some("AAPL  270115C00210000".to_string()),
                trading_class: Some("AAPL".to_string()),
                multiplier: Some("100".to_string()),
                timezone_identifier: Some("America/New_York".to_string()),
            };
            let option_contract = OptionContract {
                contract: option_identity.clone(),
                underlying_con_id: AAPL_CON_ID,
                expiration: "20270115".to_string(),
                strike: "210".to_string(),
                right: "C".to_string(),
                multiplier: "100".to_string(),
                trading_class: "AAPL".to_string(),
                exchange: "SMART".to_string(),
                currency: "USD".to_string(),
                exercise_style: "american".to_string(),
            };
            let market_rule = MarketRule {
                market_rule_id: "26".to_string(),
                minimum_tick: "0.01".to_string(),
                increments: vec![
                    MinimumTickIncrement {
                        low_edge: "0".to_string(),
                        increment: "0.01".to_string(),
                    },
                    MinimumTickIncrement {
                        low_edge: "1".to_string(),
                        increment: "0.05".to_string(),
                    },
                ],
            };
            let stock_details = ContractDetails {
                contract: stock_contract.clone(),
                market_rule_ids: vec![market_rule.market_rule_id.clone()],
                minimum_tick: market_rule.minimum_tick.clone(),
                valid_exchanges: vec!["SMART".to_string(), "NASDAQ".to_string()],
                trading_hours: Some("20270115:0930-1600".to_string()),
                liquid_hours: Some("20270115:0930-1600".to_string()),
                captured_at: captured_at.to_string(),
            };
            let option_details = ContractDetails {
                contract: option_identity,
                market_rule_ids: vec![market_rule.market_rule_id.clone()],
                minimum_tick: "0.01".to_string(),
                valid_exchanges: vec!["SMART".to_string()],
                trading_hours: Some("20270115:0930-1600".to_string()),
                liquid_hours: Some("20270115:0930-1600".to_string()),
                captured_at: captured_at.to_string(),
            };
            let quote = QuoteSnapshot {
                contract: stock_contract.clone(),
                market_data_type: "delayed".to_string(),
                bid: "208.10".to_string(),
                ask: "208.14".to_string(),
                last: Some("208.12".to_string()),
                bid_size: Some("100".to_string()),
                ask_size: Some("200".to_string()),
                last_size: Some("50".to_string()),
                quote_timestamp: "2027-01-15T18:29:59.500Z".to_string(),
                captured_at: captured_at.to_string(),
            };
            let timeframe = Timeframe {
                value: 5,
                unit: "minute".to_string(),
            };
            let historical_bars = HistoricalBarsResponse {
                contract: stock_contract.clone(),
                timeframe: timeframe.clone(),
                request_duration: "1 D".to_string(),
                what_to_show: "TRADES".to_string(),
                regular_trading_hours_only: true,
                bars: vec![
                    bar(
                        "2027-01-15T18:20:00.000Z",
                        "207.90",
                        "208.20",
                        "207.70",
                        "208.05",
                        "12000",
                    ),
                    bar(
                        "2027-01-15T18:25:00.000Z",
                        "208.05",
                        "208.30",
                        "207.98",
                        "208.12",
                        "15000",
                    ),
                ],
                captured_at: captured_at.to_string(),
            };
            let historical_ticks = HistoricalTicksResponse {
                api_version: API_VERSION.to_string(),
                contract: stock_contract.clone(),
                start_date_time: "20270115 18:29:30 UTC".to_string(),
                end_date_time: "20270115 18:30:00 UTC".to_string(),
                requested_tick_count: 3,
                what_to_show: "BID_ASK".to_string(),
                regular_trading_hours_only: true,
                ignore_size: false,
                tick_count: 3,
                ticks: vec![
                    bid_ask_tick("2027-01-15T18:29:58.000Z", "208.08", "208.13"),
                    trade_tick("2027-01-15T18:29:59.000Z", "208.12", "50"),
                    midpoint_tick("2027-01-15T18:30:00.000Z", "208.12"),
                ],
                captured_at: captured_at.to_string(),
            };
            let option_chain = OptionChainSnapshot {
                underlying: stock_contract,
                trading_class: "AAPL".to_string(),
                exchange: "SMART".to_string(),
                currency: "USD".to_string(),
                multiplier: "100".to_string(),
                expirations: vec!["20270115".to_string(), "20270219".to_string()],
                strikes: vec!["205".to_string(), "210".to_string(), "215".to_string()],
                rights: vec!["C".to_string(), "P".to_string()],
                captured_at: captured_at.to_string(),
            };
            let option_quote = OptionQuoteSnapshot {
                contract: option_contract.clone(),
                market_data_type: "delayed".to_string(),
                bid: "3.35".to_string(),
                ask: "3.45".to_string(),
                last: Some("3.40".to_string()),
                bid_size: Some("15".to_string()),
                ask_size: Some("18".to_string()),
                last_size: Some("1".to_string()),
                volume: Some("125".to_string()),
                open_interest: Some("980".to_string()),
                implied_volatility: Some("0.3125".to_string()),
                greeks: Some(OptionGreeks {
                    delta: Some("0.48".to_string()),
                    gamma: Some("0.034".to_string()),
                    theta: Some("-0.055".to_string()),
                    vega: Some("0.118".to_string()),
                }),
                quote_timestamp: "2027-01-15T18:29:59.600Z".to_string(),
                captured_at: captured_at.to_string(),
            };
            let pacing = HistoricalPacingEvidence {
                active_request_cap: 50,
                ten_minute_weight_limit: 60,
                duplicate_suppression_seconds: 15,
                bid_ask_weight: 2,
                retry_after_seconds: 30,
                cached_fallback_available: true,
            };
            let event_transcript = vec![
                event_envelope("contract.details", json!(stock_details)),
                event_envelope("quote.snapshot", json!(quote)),
                event_envelope("bars.snapshot", json!(historical_bars)),
                event_envelope("ticks.snapshot", json!(historical_ticks)),
                event_envelope("option.chain", json!(option_chain)),
                event_envelope("option.contract", json!(option_contract)),
                event_envelope("option.contract-details", json!(option_details)),
                event_envelope("option.quote", json!(option_quote)),
            ];

            Self {
                stock_contract: stock_details.contract.clone(),
                option_contract,
                stock_details,
                option_details,
                market_rule,
                quote,
                historical_bars,
                historical_ticks,
                option_chain,
                option_quote,
                pacing,
                event_transcript,
            }
        }

        pub fn broker_callback_transcript(&self) -> Vec<MarketDataCallback> {
            vec![
                MarketDataCallback::ContractDetails {
                    details: Box::new(self.stock_details.clone()),
                },
                MarketDataCallback::MarketRule {
                    market_rule: self.market_rule.clone(),
                },
                MarketDataCallback::Quote {
                    quote: Box::new(self.quote.clone()),
                },
                MarketDataCallback::HistoricalBars {
                    bars: Box::new(self.historical_bars.clone()),
                },
                MarketDataCallback::HistoricalTicks {
                    ticks: Box::new(self.historical_ticks.clone()),
                },
                MarketDataCallback::OptionChain {
                    chain: Box::new(self.option_chain.clone()),
                },
                MarketDataCallback::OptionContract {
                    contract: Box::new(self.option_contract.clone()),
                },
                MarketDataCallback::OptionDetails {
                    details: Box::new(self.option_details.clone()),
                },
                MarketDataCallback::OptionQuote {
                    quote: Box::new(self.option_quote.clone()),
                },
                MarketDataCallback::HistoricalPacing {
                    pacing: self.pacing.clone(),
                },
            ]
        }

        pub fn from_broker_callbacks(callbacks: &[MarketDataCallback]) -> Self {
            let mut accumulator = MarketDataAccumulator::default();
            for callback in callbacks {
                accumulator.apply(callback.clone());
            }
            accumulator.finish()
        }

        pub fn contract_for_con_id(&self, con_id: i64) -> Option<ContractIdentity> {
            match con_id {
                AAPL_CON_ID => Some(self.stock_contract.clone()),
                AAPL_OPTION_CON_ID => Some(self.option_contract.contract.clone()),
                _ => None,
            }
        }

        pub fn details_for_con_id(&self, con_id: i64) -> Option<ContractDetails> {
            match con_id {
                AAPL_CON_ID => Some(self.stock_details.clone()),
                AAPL_OPTION_CON_ID => Some(self.option_details.clone()),
                _ => None,
            }
        }

        pub fn market_rule(&self, market_rule_id: &str) -> Option<MarketRule> {
            (market_rule_id == self.market_rule.market_rule_id).then(|| self.market_rule.clone())
        }

        pub fn quote_for_con_id(&self, con_id: i64) -> Option<QuoteSnapshot> {
            match con_id {
                AAPL_CON_ID => Some(self.quote.clone()),
                AAPL_OPTION_CON_ID => Some(QuoteSnapshot {
                    contract: self.option_quote.contract.contract.clone(),
                    market_data_type: self.option_quote.market_data_type.clone(),
                    bid: self.option_quote.bid.clone(),
                    ask: self.option_quote.ask.clone(),
                    last: self.option_quote.last.clone(),
                    bid_size: self.option_quote.bid_size.clone(),
                    ask_size: self.option_quote.ask_size.clone(),
                    last_size: self.option_quote.last_size.clone(),
                    quote_timestamp: self.option_quote.quote_timestamp.clone(),
                    captured_at: self.option_quote.captured_at.clone(),
                }),
                _ => None,
            }
        }

        pub fn bars_for_con_id(&self, con_id: i64) -> Option<HistoricalBarsResponse> {
            (con_id == AAPL_CON_ID).then(|| self.historical_bars.clone())
        }

        pub fn ticks_for_con_id(&self, con_id: i64) -> Option<HistoricalTicksResponse> {
            (con_id == AAPL_CON_ID).then(|| self.historical_ticks.clone())
        }

        pub fn option_chain_for_underlying(
            &self,
            underlying_con_id: i64,
        ) -> Option<OptionChainSnapshot> {
            (underlying_con_id == AAPL_CON_ID).then(|| self.option_chain.clone())
        }

        pub fn option_quote_for_con_id(&self, con_id: i64) -> Option<OptionQuoteSnapshot> {
            (con_id == AAPL_OPTION_CON_ID).then(|| self.option_quote.clone())
        }

        pub fn contract_shapes_are_valid(&self) -> bool {
            self.stock_contract.con_id == AAPL_CON_ID
                && self.stock_contract.security_type == "STK"
                && self.option_contract.contract.security_type == "OPT"
                && self.option_contract.underlying_con_id == AAPL_CON_ID
                && self.stock_details.market_rule_ids == ["26"]
                && self.option_details.minimum_tick == "0.01"
        }

        pub fn market_rule_is_sorted_and_aligned(&self) -> bool {
            self.market_rule.minimum_tick == "0.01"
                && self
                    .market_rule
                    .increments
                    .first()
                    .is_some_and(|increment| {
                        increment.low_edge == "0" && increment.increment == "0.01"
                    })
                && self
                    .market_rule
                    .increments
                    .windows(2)
                    .all(|pair| pair[0].low_edge < pair[1].low_edge)
        }

        pub fn quote_is_fresh_and_ordered(&self) -> bool {
            self.quote.bid <= self.quote.ask
                && self.quote.market_data_type == "delayed"
                && self.quote.quote_timestamp <= self.quote.captured_at
        }

        pub fn bars_and_ticks_are_sorted(&self) -> bool {
            let bars_sorted = self
                .historical_bars
                .bars
                .windows(2)
                .all(|pair| pair[0].timestamp < pair[1].timestamp);
            let ticks_sorted = self
                .historical_ticks
                .ticks
                .windows(2)
                .all(|pair| pair[0].time < pair[1].time);
            bars_sorted
                && ticks_sorted
                && self.historical_ticks.tick_count == self.historical_ticks.ticks.len()
                && self.historical_ticks.requested_tick_count <= 1000
        }

        pub fn pacing_rules_are_fail_closed(&self) -> bool {
            self.pacing.active_request_cap == 50
                && self.pacing.ten_minute_weight_limit == 60
                && self.pacing.duplicate_suppression_seconds == 15
                && self.pacing.bid_ask_weight == 2
                && self.pacing.retry_after_seconds > 0
                && self.pacing.cached_fallback_available
        }

        pub fn option_chain_and_quote_are_complete(&self) -> bool {
            self.option_chain.underlying.con_id == AAPL_CON_ID
                && self
                    .option_chain
                    .expirations
                    .contains(&"20270115".to_string())
                && self.option_chain.strikes.contains(&"210".to_string())
                && self.option_chain.rights == ["C", "P"]
                && self.option_quote.contract.contract.con_id == AAPL_OPTION_CON_ID
                && self.option_quote.bid <= self.option_quote.ask
                && self.option_quote.volume.as_deref() == Some("125")
                && self.option_quote.open_interest.as_deref() == Some("980")
                && self
                    .option_quote
                    .greeks
                    .as_ref()
                    .is_some_and(|greeks| greeks.delta.as_deref() == Some("0.48"))
        }

        pub fn market_events_are_replayable(&self) -> bool {
            let names = self
                .event_transcript
                .iter()
                .map(|event| event.event.as_str())
                .collect::<Vec<_>>();
            [
                "contract.details",
                "quote.snapshot",
                "bars.snapshot",
                "ticks.snapshot",
                "option.chain",
                "option.contract",
                "option.contract-details",
                "option.quote",
            ]
            .iter()
            .all(|name| names.contains(name))
        }

        pub fn market_event_payloads_match(&self, other: &Self) -> bool {
            self.event_transcript.len() == other.event_transcript.len()
                && self
                    .event_transcript
                    .iter()
                    .zip(other.event_transcript.iter())
                    .all(|(left, right)| left.event == right.event && left.payload == right.payload)
        }
    }

    #[derive(Clone, Debug)]
    pub struct MarketDataStore {
        state: Arc<Mutex<MarketDataFixture>>,
    }

    impl Default for MarketDataStore {
        fn default() -> Self {
            Self::from_fixture(MarketDataFixture::default())
        }
    }

    impl MarketDataStore {
        pub fn from_fixture(fixture: MarketDataFixture) -> Self {
            Self {
                state: Arc::new(Mutex::new(fixture)),
            }
        }

        pub fn from_callbacks(callbacks: &[MarketDataCallback]) -> Self {
            Self::from_fixture(MarketDataFixture::from_broker_callbacks(callbacks))
        }

        pub fn record(&self, callback: MarketDataCallback) -> Vec<EventEnvelope> {
            let mut state = self.state.lock().expect("market data state lock poisoned");
            let mut callbacks = state.broker_callback_transcript();
            callbacks.push(callback.clone());
            let rebuilt = MarketDataFixture::from_broker_callbacks(&callbacks);
            let events = market_events_for_callback(&callback);
            *state = rebuilt;
            events
        }

        pub fn snapshot(&self) -> MarketDataFixture {
            self.state
                .lock()
                .expect("market data state lock poisoned")
                .clone()
        }
    }

    #[derive(Clone, Debug, Default)]
    pub struct MarketDataSubscriptionStore {
        active: Arc<Mutex<HashMap<(MarketDataStreamKind, i64), MarketDataSubscriptionAck>>>,
    }

    impl MarketDataSubscriptionStore {
        pub fn subscribe(
            &self,
            stream: MarketDataStreamKind,
            con_id: i64,
            replayed_event_count: usize,
        ) -> MarketDataSubscriptionAck {
            let ack = subscription_ack(stream, con_id, "active", true, replayed_event_count);
            self.active
                .lock()
                .expect("market data subscription lock poisoned")
                .insert((stream, con_id), ack.clone());
            ack
        }

        pub fn unsubscribe(
            &self,
            stream: MarketDataStreamKind,
            con_id: i64,
        ) -> MarketDataSubscriptionAck {
            let mut active = self
                .active
                .lock()
                .expect("market data subscription lock poisoned");
            let status = if active.remove(&(stream, con_id)).is_some() {
                "stopped"
            } else {
                "alreadyStopped"
            };
            subscription_ack(stream, con_id, status, false, 0)
        }

        pub fn snapshot(&self) -> Vec<MarketDataSubscriptionAck> {
            let mut subscriptions = self
                .active
                .lock()
                .expect("market data subscription lock poisoned")
                .values()
                .cloned()
                .collect::<Vec<_>>();
            subscriptions.sort_by(|left, right| {
                left.stream
                    .cmp(&right.stream)
                    .then(left.con_id.cmp(&right.con_id))
            });
            subscriptions
        }

        pub fn is_active(&self, stream: MarketDataStreamKind, con_id: i64) -> bool {
            self.active
                .lock()
                .expect("market data subscription lock poisoned")
                .contains_key(&(stream, con_id))
        }
    }

    fn subscription_ack(
        stream: MarketDataStreamKind,
        con_id: i64,
        status: &str,
        active: bool,
        replayed_event_count: usize,
    ) -> MarketDataSubscriptionAck {
        MarketDataSubscriptionAck {
            api_version: API_VERSION.to_string(),
            stream: stream.as_wire_value().to_string(),
            con_id,
            status: status.to_string(),
            active,
            replayed_event_count,
            recorded_at: now_rfc3339(),
        }
    }

    fn market_events_for_callback(callback: &MarketDataCallback) -> Vec<EventEnvelope> {
        match callback {
            MarketDataCallback::ContractDetails { details } => {
                vec![event_envelope("contract.details", json!(details))]
            }
            MarketDataCallback::MarketRule { .. } => Vec::new(),
            MarketDataCallback::Quote { quote } => {
                vec![event_envelope("quote.snapshot", json!(quote))]
            }
            MarketDataCallback::HistoricalBars { bars } => {
                vec![event_envelope("bars.snapshot", json!(bars))]
            }
            MarketDataCallback::HistoricalTicks { ticks } => {
                vec![event_envelope("ticks.snapshot", json!(ticks))]
            }
            MarketDataCallback::OptionChain { chain } => {
                vec![event_envelope("option.chain", json!(chain))]
            }
            MarketDataCallback::OptionContract { contract } => {
                vec![event_envelope("option.contract", json!(contract))]
            }
            MarketDataCallback::OptionDetails { details } => {
                vec![event_envelope("option.contract-details", json!(details))]
            }
            MarketDataCallback::OptionQuote { quote } => {
                vec![event_envelope("option.quote", json!(quote))]
            }
            MarketDataCallback::HistoricalPacing { .. } => Vec::new(),
        }
    }

    #[derive(Default)]
    struct MarketDataAccumulator {
        stock_details: Option<ContractDetails>,
        option_details: Option<ContractDetails>,
        market_rule: Option<MarketRule>,
        quote: Option<QuoteSnapshot>,
        historical_bars: Option<HistoricalBarsResponse>,
        historical_ticks: Option<HistoricalTicksResponse>,
        option_chain: Option<OptionChainSnapshot>,
        option_contract: Option<OptionContract>,
        option_quote: Option<OptionQuoteSnapshot>,
        pacing: Option<HistoricalPacingEvidence>,
        event_transcript: Vec<EventEnvelope>,
    }

    impl MarketDataAccumulator {
        fn apply(&mut self, callback: MarketDataCallback) {
            match callback {
                MarketDataCallback::ContractDetails { details } => {
                    let details = *details;
                    self.event_transcript
                        .push(event_envelope("contract.details", json!(details)));
                    self.stock_details = Some(details);
                }
                MarketDataCallback::MarketRule { market_rule } => {
                    self.market_rule = Some(market_rule);
                }
                MarketDataCallback::Quote { quote } => {
                    let quote = *quote;
                    self.event_transcript
                        .push(event_envelope("quote.snapshot", json!(quote)));
                    self.quote = Some(quote);
                }
                MarketDataCallback::HistoricalBars { bars } => {
                    let bars = *bars;
                    self.event_transcript
                        .push(event_envelope("bars.snapshot", json!(bars)));
                    self.historical_bars = Some(bars);
                }
                MarketDataCallback::HistoricalTicks { ticks } => {
                    let ticks = *ticks;
                    self.event_transcript
                        .push(event_envelope("ticks.snapshot", json!(ticks)));
                    self.historical_ticks = Some(ticks);
                }
                MarketDataCallback::OptionChain { chain } => {
                    let chain = *chain;
                    self.event_transcript
                        .push(event_envelope("option.chain", json!(chain)));
                    self.option_chain = Some(chain);
                }
                MarketDataCallback::OptionContract { contract } => {
                    let contract = *contract;
                    self.event_transcript
                        .push(event_envelope("option.contract", json!(contract)));
                    self.option_contract = Some(contract);
                }
                MarketDataCallback::OptionDetails { details } => {
                    let details = *details;
                    self.event_transcript
                        .push(event_envelope("option.contract-details", json!(details)));
                    self.option_details = Some(details);
                }
                MarketDataCallback::OptionQuote { quote } => {
                    let quote = *quote;
                    self.event_transcript
                        .push(event_envelope("option.quote", json!(quote)));
                    self.option_quote = Some(quote);
                }
                MarketDataCallback::HistoricalPacing { pacing } => {
                    self.pacing = Some(pacing);
                }
            }
        }

        fn finish(self) -> MarketDataFixture {
            let stock_details = self
                .stock_details
                .expect("stock contract details callback is required");
            let option_contract = self
                .option_contract
                .expect("option contract callback is required");
            MarketDataFixture {
                stock_contract: stock_details.contract.clone(),
                option_contract,
                stock_details,
                option_details: self
                    .option_details
                    .expect("option contract details callback is required"),
                market_rule: self.market_rule.expect("market rule callback is required"),
                quote: self.quote.expect("quote snapshot callback is required"),
                historical_bars: self
                    .historical_bars
                    .expect("historical bars callback is required"),
                historical_ticks: self
                    .historical_ticks
                    .expect("historical ticks callback is required"),
                option_chain: self
                    .option_chain
                    .expect("option chain callback is required"),
                option_quote: self
                    .option_quote
                    .expect("option quote callback is required"),
                pacing: self.pacing.expect("historical pacing callback is required"),
                event_transcript: self.event_transcript,
            }
        }
    }

    fn bar(timestamp: &str, open: &str, high: &str, low: &str, close: &str, volume: &str) -> Bar {
        Bar {
            symbol: "AAPL".to_string(),
            venue: "SMART".to_string(),
            timeframe: Timeframe {
                value: 5,
                unit: "minute".to_string(),
            },
            timestamp: timestamp.to_string(),
            open: open.to_string(),
            high: high.to_string(),
            low: low.to_string(),
            close: close.to_string(),
            volume: volume.to_string(),
        }
    }

    fn bid_ask_tick(time: &str, bid: &str, ask: &str) -> HistoricalTick {
        HistoricalTick {
            kind: "bidAsk".to_string(),
            time: time.to_string(),
            price: None,
            size: None,
            bid: Some(bid.to_string()),
            ask: Some(ask.to_string()),
            bid_size: Some("100".to_string()),
            ask_size: Some("200".to_string()),
            exchange: Some("SMART".to_string()),
            special_conditions: None,
            attributes: Some(HistoricalTickAttributes {
                bid_past_low: Some(false),
                ask_past_high: Some(false),
                past_limit: None,
                unreported: None,
            }),
        }
    }

    fn trade_tick(time: &str, price: &str, size: &str) -> HistoricalTick {
        HistoricalTick {
            kind: "last".to_string(),
            time: time.to_string(),
            price: Some(price.to_string()),
            size: Some(size.to_string()),
            bid: None,
            ask: None,
            bid_size: None,
            ask_size: None,
            exchange: Some("ISLAND".to_string()),
            special_conditions: None,
            attributes: Some(HistoricalTickAttributes {
                bid_past_low: None,
                ask_past_high: None,
                past_limit: Some(false),
                unreported: Some(false),
            }),
        }
    }

    fn midpoint_tick(time: &str, price: &str) -> HistoricalTick {
        HistoricalTick {
            kind: "midpoint".to_string(),
            time: time.to_string(),
            price: Some(price.to_string()),
            size: None,
            bid: None,
            ask: None,
            bid_size: None,
            ask_size: None,
            exchange: None,
            special_conditions: None,
            attributes: None,
        }
    }
}

pub mod order_routing {
    use crate::{
        adapter_contract::{BrokerEnvironment, EventEnvelope},
        broker_read_model::{OrderStatusSnapshot, PositionSnapshot, PAPER_ACCOUNT_ID},
        market_read_model::{AAPL_CON_ID, AAPL_OPTION_CON_ID},
    };
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    pub const PAPER_ORDER_REQUEST_ID: &str = "intent-11111111-1111-1111-1111-111111111111";
    pub const LIVE_ORDER_REQUEST_ID: &str = "intent-22222222-2222-2222-2222-222222222222";
    pub const MODIFY_REQUEST_ID: &str = "intent-33333333-3333-3333-3333-333333333333";
    pub const OPTION_EXERCISE_REQUEST_ID: &str = "intent-44444444-4444-4444-4444-444444444444";
    pub const LIVE_OPTION_ORDER_REQUEST_ID: &str = "intent-550e8400-e29b-41d4-a716-446655440005";
    pub const LIVE_COMBO_ORDER_REQUEST_ID: &str = "intent-550e8400-e29b-41d4-a716-446655440006";
    pub const LIVE_OPTION_CON_ID: i64 = 7_001_001;
    pub const LIVE_COMBO_SHORT_LEG_CON_ID: i64 = 7_001_002;
    pub const PAPER_BROKER_ORDER_ID: &str = "IBKR-2001";
    pub const LIVE_BROKER_ORDER_ID: &str = "IBKR-9001";
    pub const LIVE_OPTION_BROKER_ORDER_ID: &str = "IBKR-2902";
    pub const LIVE_COMBO_BROKER_ORDER_ID: &str = "IBKR-2903";
    pub const MODIFIED_BROKER_ORDER_ID: &str = "IBKR-1001";
    pub const ACKNOWLEDGED_AT: &str = "2027-01-15T18:30:03.000Z";

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerOrderWarning {
        pub code: String,
        pub message: String,
        pub severity: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerOrderPreview {
        #[serde(rename = "intentID")]
        pub intent_id: String,
        pub environment: BrokerEnvironment,
        pub estimated_commission: String,
        pub initial_margin_change: String,
        pub maintenance_margin_change: String,
        pub warnings: Vec<BrokerOrderWarning>,
        pub required_confirmations: Vec<String>,
        pub broker_accepted: bool,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderPlacementAcknowledgement {
        #[serde(rename = "requestID")]
        pub request_id: String,
        pub idempotency_key: String,
        #[serde(rename = "brokerOrderID")]
        pub broker_order_id: String,
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub environment: BrokerEnvironment,
        pub status: String,
        pub acknowledged_at: String,
        pub lifecycle_state_source: String,
        pub message: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OptionExerciseAcknowledgement {
        #[serde(rename = "requestID")]
        pub request_id: String,
        pub idempotency_key: String,
        #[serde(rename = "brokerRequestID")]
        pub broker_request_id: String,
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub environment: BrokerEnvironment,
        pub action: String,
        #[serde(rename = "conID")]
        pub con_id: i64,
        pub symbol: String,
        pub quantity: i64,
        pub override_natural_action: bool,
        pub status: String,
        pub acknowledged_at: String,
        pub lifecycle_state_source: String,
        pub message: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GlobalCancelAcknowledgement {
        #[serde(rename = "requestID")]
        pub request_id: String,
        #[serde(rename = "accountID")]
        pub account_id: String,
        pub environment: BrokerEnvironment,
        pub status: String,
        pub submitted_at: String,
        pub message: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CancelResponse {
        pub status: OrderStatusSnapshot,
        pub audit_events: Vec<Value>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MappedComboLeg {
        #[serde(rename = "conID")]
        pub con_id: i64,
        pub ratio: i64,
        pub action: String,
        pub exchange: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MappedContractHydration {
        #[serde(rename = "requestID")]
        pub request_id: String,
        #[serde(rename = "conID")]
        pub con_id: i64,
        pub symbol: String,
        pub security_type: String,
        pub exchange: String,
        pub primary_exchange: Option<String>,
        pub currency: String,
        pub local_symbol: Option<String>,
        pub trading_class: Option<String>,
        pub multiplier: Option<String>,
        pub expiration: Option<String>,
        pub strike: Option<String>,
        pub right: Option<String>,
        #[serde(rename = "underlyingConID")]
        pub underlying_con_id: Option<String>,
        pub combo_leg_count: usize,
        pub combo_legs: Vec<MappedComboLeg>,
        pub hydrates_con_id: bool,
        pub required_option_fields_present: bool,
        pub uses_process_local_contract_cache: bool,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderSafetyEvidence {
        pub request_id: String,
        pub idempotency_key: String,
        pub paper_order: Value,
        pub live_order: Value,
        pub modification_order: Value,
        pub option_exercise: Value,
        pub global_cancel: Value,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum OrderRoutingCallback {
        Preview {
            preview: Box<BrokerOrderPreview>,
        },
        PlacementAcknowledgement {
            acknowledgement: Box<OrderPlacementAcknowledgement>,
        },
        CancelResponse {
            response: Box<CancelResponse>,
        },
        ModificationAcknowledgement {
            acknowledgement: Box<OrderPlacementAcknowledgement>,
        },
        GlobalCancelAcknowledgement {
            acknowledgement: Box<GlobalCancelAcknowledgement>,
        },
        OptionExerciseAcknowledgement {
            acknowledgement: Box<OptionExerciseAcknowledgement>,
        },
    }

    #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderRoutingCallbackState {
        pub previews: Vec<BrokerOrderPreview>,
        pub placement_acknowledgements: Vec<OrderPlacementAcknowledgement>,
        pub cancel_responses: Vec<CancelResponse>,
        pub modification_acknowledgements: Vec<OrderPlacementAcknowledgement>,
        pub global_cancel_acknowledgements: Vec<GlobalCancelAcknowledgement>,
        pub option_exercise_acknowledgements: Vec<OptionExerciseAcknowledgement>,
        pub event_transcript: Vec<EventEnvelope>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderRoutingCallbackEvidence {
        pub callback_count: usize,
        pub event_names: Vec<String>,
        pub routing_state: OrderRoutingCallbackState,
    }

    impl OrderRoutingCallbackState {
        pub fn from_broker_callbacks(callbacks: &[OrderRoutingCallback]) -> Self {
            let mut state = Self::default();
            for callback in callbacks {
                state.apply_callback(callback.clone());
            }
            state
        }

        pub fn apply_callback(&mut self, callback: OrderRoutingCallback) -> Vec<EventEnvelope> {
            match callback {
                OrderRoutingCallback::Preview { preview } => {
                    self.previews.push(*preview);
                    Vec::new()
                }
                OrderRoutingCallback::PlacementAcknowledgement { acknowledgement } => {
                    let acknowledgement = *acknowledgement;
                    let events = routing_events(&acknowledgement);
                    self.event_transcript.extend(events.clone());
                    self.placement_acknowledgements.push(acknowledgement);
                    events
                }
                OrderRoutingCallback::CancelResponse { response } => {
                    let response = *response;
                    let events = vec![crate::adapter_contract::event_envelope(
                        "order.status",
                        json!(response.status),
                    )];
                    self.event_transcript.extend(events.clone());
                    self.cancel_responses.push(response);
                    events
                }
                OrderRoutingCallback::ModificationAcknowledgement { acknowledgement } => {
                    let acknowledgement = *acknowledgement;
                    let events = vec![crate::adapter_contract::event_envelope(
                        "order.modify",
                        json!(acknowledgement),
                    )];
                    self.event_transcript.extend(events.clone());
                    self.modification_acknowledgements.push(acknowledgement);
                    events
                }
                OrderRoutingCallback::GlobalCancelAcknowledgement { acknowledgement } => {
                    let acknowledgement = *acknowledgement;
                    let events = vec![crate::adapter_contract::event_envelope(
                        "order.global_cancel",
                        json!(acknowledgement),
                    )];
                    self.event_transcript.extend(events.clone());
                    self.global_cancel_acknowledgements.push(acknowledgement);
                    events
                }
                OrderRoutingCallback::OptionExerciseAcknowledgement { acknowledgement } => {
                    let acknowledgement = *acknowledgement;
                    let events = vec![crate::adapter_contract::event_envelope(
                        "option.exercise",
                        json!(acknowledgement),
                    )];
                    self.event_transcript.extend(events.clone());
                    self.option_exercise_acknowledgements.push(acknowledgement);
                    events
                }
            }
        }

        pub fn routing_events_are_replayable(&self) -> bool {
            let names = self
                .event_transcript
                .iter()
                .map(|event| event.event.as_str())
                .collect::<Vec<_>>();
            [
                "order.status",
                "order.modify",
                "order.global_cancel",
                "option.exercise",
            ]
            .iter()
            .all(|name| names.contains(name))
        }
    }

    #[derive(Clone, Debug, Default)]
    pub struct OrderRoutingCallbackStore {
        state: Arc<Mutex<OrderRoutingCallbackState>>,
    }

    impl OrderRoutingCallbackStore {
        pub fn record(&self, callback: OrderRoutingCallback) -> Vec<EventEnvelope> {
            let mut state = self
                .state
                .lock()
                .expect("order routing callback state lock poisoned");
            state.apply_callback(callback)
        }

        pub fn snapshot(&self) -> OrderRoutingCallbackState {
            self.state
                .lock()
                .expect("order routing callback state lock poisoned")
                .clone()
        }
    }

    pub fn idempotency_key_for_request_id(request_id: &str) -> String {
        request_id
            .strip_prefix("intent-")
            .unwrap_or(request_id)
            .to_string()
    }

    pub fn live_confirmation_text(account_id: &str, request_id: &str) -> String {
        format!("PLACE IBKR LIVE ORDER {account_id} {request_id}")
    }

    pub fn modification_confirmation_text(
        environment: BrokerEnvironment,
        account_id: &str,
        broker_order_id: &str,
        request_id: &str,
    ) -> String {
        let environment = match environment {
            BrokerEnvironment::IbkrPaper => "IBKR PAPER",
            BrokerEnvironment::IbkrLive => "IBKR LIVE",
        };
        format!("MODIFY {environment} ORDER {account_id} {broker_order_id} {request_id}")
    }

    pub fn global_cancel_confirmation_text(account_id: &str) -> String {
        format!("GLOBAL CANCEL IBKR PAPER {account_id}")
    }

    pub fn option_confirmation_text(
        action: &str,
        environment: BrokerEnvironment,
        account_id: &str,
        request_id: &str,
    ) -> Result<String, String> {
        let action = match action {
            "exercise" => "EXERCISE",
            "lapse" => "LAPSE",
            other => return Err(format!("unsupported option exercise action {other}")),
        };
        let environment = match environment {
            BrokerEnvironment::IbkrPaper => "IBKR PAPER",
            BrokerEnvironment::IbkrLive => "IBKR LIVE",
        };
        Ok(format!(
            "{action} {environment} OPTION {account_id} {request_id}"
        ))
    }

    pub fn option_action_code(action: &str) -> Option<u8> {
        match action {
            "exercise" => Some(1),
            "lapse" => Some(2),
            _ => None,
        }
    }

    pub fn order_safety_evidence() -> OrderSafetyEvidence {
        OrderSafetyEvidence {
            request_id: PAPER_ORDER_REQUEST_ID.to_string(),
            idempotency_key: idempotency_key_for_request_id(PAPER_ORDER_REQUEST_ID),
            paper_order: paper_order_body(),
            live_order: live_order_body(),
            modification_order: modification_order_body(BrokerEnvironment::IbkrPaper),
            option_exercise: option_exercise_body(BrokerEnvironment::IbkrPaper, "exercise"),
            global_cancel: global_cancel_body(),
        }
    }

    pub fn deterministic_routing_callback_transcript(
        positions: &[PositionSnapshot],
        open_orders: &[OrderStatusSnapshot],
    ) -> Vec<OrderRoutingCallback> {
        let paper_body = paper_order_body();
        let paper_idempotency_key = idempotency_key_for_request_id(PAPER_ORDER_REQUEST_ID);
        let live_body = live_order_body();
        let live_idempotency_key = idempotency_key_for_request_id(LIVE_ORDER_REQUEST_ID);
        let live_option_body = live_option_order_body();
        let live_option_idempotency_key =
            idempotency_key_for_request_id(LIVE_OPTION_ORDER_REQUEST_ID);
        let live_combo_body = live_combo_order_body();
        let live_combo_idempotency_key =
            idempotency_key_for_request_id(LIVE_COMBO_ORDER_REQUEST_ID);
        let modification_body = modification_order_body(BrokerEnvironment::IbkrPaper);
        let modification_idempotency_key = idempotency_key_for_request_id(MODIFY_REQUEST_ID);
        let option_exercise_body = option_exercise_body(BrokerEnvironment::IbkrPaper, "exercise");
        let option_exercise_idempotency_key =
            idempotency_key_for_request_id(OPTION_EXERCISE_REQUEST_ID);

        let mut callbacks = vec![
            OrderRoutingCallback::Preview {
                preview: Box::new(
                    preview_from_mapped_order(&paper_body, Some(&paper_idempotency_key))
                        .expect("deterministic paper preview"),
                ),
            },
            OrderRoutingCallback::PlacementAcknowledgement {
                acknowledgement: Box::new(
                    paper_acknowledgement(&paper_body, Some(&paper_idempotency_key), false)
                        .expect("deterministic paper acknowledgement"),
                ),
            },
            OrderRoutingCallback::PlacementAcknowledgement {
                acknowledgement: Box::new(
                    paper_acknowledgement(&paper_body, Some(&paper_idempotency_key), true)
                        .expect("deterministic duplicate paper acknowledgement"),
                ),
            },
            OrderRoutingCallback::PlacementAcknowledgement {
                acknowledgement: Box::new(
                    live_acknowledgement(&live_body, Some(&live_idempotency_key), false)
                        .expect("deterministic live acknowledgement"),
                ),
            },
            OrderRoutingCallback::PlacementAcknowledgement {
                acknowledgement: Box::new(
                    live_acknowledgement(
                        &live_option_body,
                        Some(&live_option_idempotency_key),
                        false,
                    )
                    .expect("deterministic live option acknowledgement"),
                ),
            },
            OrderRoutingCallback::PlacementAcknowledgement {
                acknowledgement: Box::new(
                    live_acknowledgement(
                        &live_combo_body,
                        Some(&live_combo_idempotency_key),
                        false,
                    )
                    .expect("deterministic live combo acknowledgement"),
                ),
            },
            OrderRoutingCallback::ModificationAcknowledgement {
                acknowledgement: Box::new(
                    modification_acknowledgement(
                        &modification_body,
                        Some(&modification_idempotency_key),
                        MODIFIED_BROKER_ORDER_ID,
                        false,
                    )
                    .expect("deterministic modification acknowledgement"),
                ),
            },
        ];
        if let Some(open_order) = open_orders.first() {
            callbacks.push(OrderRoutingCallback::CancelResponse {
                response: Box::new(cancel_response(open_order.clone())),
            });
        }
        callbacks.extend([
            OrderRoutingCallback::GlobalCancelAcknowledgement {
                acknowledgement: Box::new(
                    global_cancel_acknowledgement(&global_cancel_body())
                        .expect("deterministic global cancel acknowledgement"),
                ),
            },
            OrderRoutingCallback::OptionExerciseAcknowledgement {
                acknowledgement: Box::new(
                    option_exercise_acknowledgement(
                        &option_exercise_body,
                        Some(&option_exercise_idempotency_key),
                        positions,
                        false,
                    )
                    .expect("deterministic option exercise acknowledgement"),
                ),
            },
        ]);
        callbacks
    }

    pub fn deterministic_routing_callback_evidence(
        positions: &[PositionSnapshot],
        open_orders: &[OrderStatusSnapshot],
    ) -> OrderRoutingCallbackEvidence {
        let transcript = deterministic_routing_callback_transcript(positions, open_orders);
        let routing_state = OrderRoutingCallbackState::from_broker_callbacks(&transcript);
        let event_names = routing_state
            .event_transcript
            .iter()
            .map(|event| event.event.clone())
            .collect();
        OrderRoutingCallbackEvidence {
            callback_count: transcript.len(),
            event_names,
            routing_state,
        }
    }

    pub fn paper_order_body() -> Value {
        mapped_order_body(
            PAPER_ORDER_REQUEST_ID,
            PAPER_ACCOUNT_ID,
            BrokerEnvironment::IbkrPaper,
            None,
            None,
        )
    }

    pub fn live_order_body() -> Value {
        mapped_order_body(
            LIVE_ORDER_REQUEST_ID,
            "U1234567",
            BrokerEnvironment::IbkrLive,
            Some(live_confirmation_text("U1234567", LIVE_ORDER_REQUEST_ID)),
            None,
        )
    }

    pub fn live_option_order_body() -> Value {
        live_option_order_body_with(
            "SMART",
            "0.05",
            Some(live_confirmation_text(
                "U1234567",
                LIVE_OPTION_ORDER_REQUEST_ID,
            )),
        )
    }

    pub fn live_option_order_body_with(
        exchange: &str,
        limit_minimum_tick: &str,
        live_confirmation_text: Option<String>,
    ) -> Value {
        json!({
            "requestID": LIVE_OPTION_ORDER_REQUEST_ID,
            "accountID": "U1234567",
            "environment": BrokerEnvironment::IbkrLive,
            "conID": LIVE_OPTION_CON_ID,
            "symbol": "AAPL",
            "securityType": "OPT",
            "exchange": exchange,
            "primaryExchange": "NASDAQ",
            "currency": "USD",
            "localSymbol": "AAPL  270717C00225000",
            "tradingClass": "AAPL",
            "multiplier": "100",
            "expiration": "20270717",
            "strike": "225",
            "right": "C",
            "underlyingConID": AAPL_CON_ID.to_string(),
            "side": "buy",
            "quantity": "1",
            "orderType": "LMT",
            "timeInForce": "day",
            "limitPrice": "2.95",
            "limitMinimumTick": limit_minimum_tick,
            "validExchanges": ["SMART"],
            "liveConfirmationText": live_confirmation_text,
            "transmit": true
        })
    }

    pub fn live_combo_order_body() -> Value {
        live_combo_order_body_with(
            "SMART",
            "0.01",
            Some(live_confirmation_text(
                "U1234567",
                LIVE_COMBO_ORDER_REQUEST_ID,
            )),
        )
    }

    pub fn live_combo_order_body_with(
        exchange: &str,
        limit_minimum_tick: &str,
        live_confirmation_text: Option<String>,
    ) -> Value {
        json!({
            "requestID": LIVE_COMBO_ORDER_REQUEST_ID,
            "accountID": "U1234567",
            "environment": BrokerEnvironment::IbkrLive,
            "conID": 0,
            "symbol": "AAPL",
            "securityType": "BAG",
            "exchange": exchange,
            "currency": "USD",
            "comboLegs": [
                {"conID": LIVE_OPTION_CON_ID, "ratio": 1, "action": "buy", "exchange": "SMART"},
                {"conID": LIVE_COMBO_SHORT_LEG_CON_ID, "ratio": 1, "action": "sell", "exchange": "SMART"}
            ],
            "side": "buy",
            "quantity": "1",
            "orderType": "LMT",
            "timeInForce": "day",
            "limitPrice": "0.05",
            "limitMinimumTick": limit_minimum_tick,
            "validExchanges": ["SMART"],
            "liveConfirmationText": live_confirmation_text,
            "transmit": true
        })
    }

    pub fn live_single_leg_combo_order_body() -> Value {
        let mut body = live_combo_order_body();
        body["comboLegs"] = json!([
            {"conID": LIVE_OPTION_CON_ID, "ratio": 1, "action": "buy", "exchange": "SMART"}
        ]);
        body
    }

    pub fn modification_order_body(environment: BrokerEnvironment) -> Value {
        let (request_id, account_id) = match environment {
            BrokerEnvironment::IbkrPaper => (MODIFY_REQUEST_ID, PAPER_ACCOUNT_ID),
            BrokerEnvironment::IbkrLive => (MODIFY_REQUEST_ID, "U1234567"),
        };
        mapped_order_body(
            request_id,
            account_id,
            environment,
            None,
            Some(modification_confirmation_text(
                environment,
                account_id,
                MODIFIED_BROKER_ORDER_ID,
                request_id,
            )),
        )
    }

    pub fn option_exercise_body(environment: BrokerEnvironment, action: &str) -> Value {
        let account_id = match environment {
            BrokerEnvironment::IbkrPaper => PAPER_ACCOUNT_ID,
            BrokerEnvironment::IbkrLive => "U1234567",
        };
        json!({
            "requestID": OPTION_EXERCISE_REQUEST_ID,
            "accountID": account_id,
            "environment": environment,
            "action": action,
            "conID": AAPL_OPTION_CON_ID,
            "symbol": "AAPL",
            "quantity": 1,
            "overrideNaturalAction": false,
            "confirmationText": option_confirmation_text(action, environment, account_id, OPTION_EXERCISE_REQUEST_ID).unwrap()
        })
    }

    pub fn global_cancel_body() -> Value {
        json!({
            "requestID": "global-cancel-valid",
            "accountID": PAPER_ACCOUNT_ID,
            "environment": BrokerEnvironment::IbkrPaper,
            "confirmationText": global_cancel_confirmation_text(PAPER_ACCOUNT_ID),
            "confirmedAt": ACKNOWLEDGED_AT
        })
    }

    pub fn preview_from_mapped_order(
        body: &Value,
        idempotency_key: Option<&str>,
    ) -> Result<BrokerOrderPreview, String> {
        let order = validate_mapped_order(body, idempotency_key, None)?;
        let initial_margin_change = match order.security_type.as_str() {
            "BAG" => "5",
            "OPT" => "295",
            _ => "416.24",
        };
        Ok(BrokerOrderPreview {
            intent_id: order.request_id,
            environment: order.environment,
            estimated_commission: "1.25".to_string(),
            initial_margin_change: initial_margin_change.to_string(),
            maintenance_margin_change: initial_margin_change.to_string(),
            warnings: Vec::new(),
            required_confirmations: Vec::new(),
            broker_accepted: true,
        })
    }

    pub fn paper_acknowledgement(
        body: &Value,
        idempotency_key: Option<&str>,
        duplicate: bool,
    ) -> Result<OrderPlacementAcknowledgement, String> {
        let order =
            validate_mapped_order(body, idempotency_key, Some(BrokerEnvironment::IbkrPaper))?;
        if !order.account_id.starts_with("DU") {
            return Err("paper placement requires a DU paper account".to_string());
        }
        Ok(acknowledgement(
            order,
            PAPER_BROKER_ORDER_ID,
            duplicate,
            "Paper order accepted for asynchronous processing.",
        ))
    }

    pub fn live_acknowledgement(
        body: &Value,
        idempotency_key: Option<&str>,
        duplicate: bool,
    ) -> Result<OrderPlacementAcknowledgement, String> {
        let order =
            validate_mapped_order(body, idempotency_key, Some(BrokerEnvironment::IbkrLive))?;
        let expected = live_confirmation_text(&order.account_id, &order.request_id);
        if order.live_confirmation_text.as_deref() != Some(expected.as_str()) {
            return Err(format!(
                "live order confirmation must exactly match {expected}"
            ));
        }
        let (broker_order_id, message) = match order.security_type.as_str() {
            "OPT" => (
                LIVE_OPTION_BROKER_ORDER_ID,
                "Live option order accepted for asynchronous processing after exact confirmation.",
            ),
            "BAG" => (
                LIVE_COMBO_BROKER_ORDER_ID,
                "Live combo order accepted for asynchronous processing after exact confirmation.",
            ),
            _ => (
                LIVE_BROKER_ORDER_ID,
                "Live order accepted for asynchronous processing after exact confirmation.",
            ),
        };
        Ok(acknowledgement(order, broker_order_id, duplicate, message))
    }

    pub fn modification_acknowledgement(
        body: &Value,
        idempotency_key: Option<&str>,
        broker_order_id: &str,
        duplicate: bool,
    ) -> Result<OrderPlacementAcknowledgement, String> {
        let order = validate_mapped_order(body, idempotency_key, None)?;
        let expected = modification_confirmation_text(
            order.environment,
            &order.account_id,
            broker_order_id,
            &order.request_id,
        );
        if order.modification_confirmation_text.as_deref() != Some(expected.as_str()) {
            return Err(format!(
                "modification confirmation must exactly match {expected}"
            ));
        }
        Ok(acknowledgement(
            order,
            broker_order_id,
            duplicate,
            "Order modification accepted for asynchronous processing.",
        ))
    }

    pub fn option_exercise_acknowledgement(
        body: &Value,
        idempotency_key: Option<&str>,
        positions: &[PositionSnapshot],
        duplicate: bool,
    ) -> Result<OptionExerciseAcknowledgement, String> {
        let request_id = required_string(body, "requestID")?;
        validate_idempotency(&request_id, idempotency_key)?;
        let account_id = required_string(body, "accountID")?;
        let environment = required_environment(body)?;
        let action = required_string(body, "action")?;
        let Some(_action_code) = option_action_code(&action) else {
            return Err("option exercise action must be exercise or lapse".to_string());
        };
        let con_id = required_i64(body, "conID")?;
        let quantity = required_i64(body, "quantity")?;
        if quantity <= 0 {
            return Err("option exercise quantity must be positive".to_string());
        }
        let override_natural_action =
            optional_bool(body, "overrideNaturalAction")?.unwrap_or(false);
        let expected = option_confirmation_text(&action, environment, &account_id, &request_id)?;
        if required_string(body, "confirmationText")? != expected {
            return Err(format!(
                "option exercise confirmation must exactly match {expected}"
            ));
        }
        let has_position = positions.iter().any(|position| {
            position.account_id == account_id
                && position.instrument.con_id == con_id
                && position.instrument.security_type == "OPT"
                && position.quantity != "0"
        });
        if !has_position {
            return Err("option exercise requires a verified option position".to_string());
        }
        Ok(OptionExerciseAcknowledgement {
            request_id,
            idempotency_key: idempotency_key
                .map(ToString::to_string)
                .unwrap_or_else(|| idempotency_key_for_request_id(OPTION_EXERCISE_REQUEST_ID)),
            broker_request_id: format!("EXERCISE-{con_id}"),
            account_id,
            environment,
            action,
            con_id,
            symbol: optional_string(body, "symbol").unwrap_or_else(|| "AAPL".to_string()),
            quantity,
            override_natural_action,
            status: if duplicate { "duplicate" } else { "accepted" }.to_string(),
            acknowledged_at: ACKNOWLEDGED_AT.to_string(),
            lifecycle_state_source:
                "TWS exerciseOptions acknowledgement plus account/position reconciliation"
                    .to_string(),
            message: "Option exercise/lapse request accepted for asynchronous processing."
                .to_string(),
        })
    }

    pub fn global_cancel_acknowledgement(
        body: &Value,
    ) -> Result<GlobalCancelAcknowledgement, String> {
        let request_id =
            optional_string(body, "requestID").unwrap_or_else(|| "global-cancel".to_string());
        let account_id = required_string(body, "accountID")?;
        let environment = required_environment(body)?;
        if environment != BrokerEnvironment::IbkrPaper {
            return Err("global cancel is limited to IBKR paper".to_string());
        }
        if !account_id.starts_with("DU") {
            return Err("global cancel requires an IBKR paper DU account id".to_string());
        }
        let expected = global_cancel_confirmation_text(&account_id);
        if required_string(body, "confirmationText")? != expected {
            return Err(format!(
                "global cancel confirmation must exactly match {expected}"
            ));
        }
        Ok(GlobalCancelAcknowledgement {
            request_id,
            account_id,
            environment,
            status: "accepted".to_string(),
            submitted_at: ACKNOWLEDGED_AT.to_string(),
            message: "IBKR paper global cancel submitted after exact confirmation.".to_string(),
        })
    }

    pub fn cancel_response(status: OrderStatusSnapshot) -> CancelResponse {
        CancelResponse {
            audit_events: vec![json!({
                "category": "ibkr.order.cancel",
                "brokerOrderID": status.broker_order_id,
                "accountID": status.account_id,
                "environment": status.environment,
                "status": "cancelled",
            })],
            status: OrderStatusSnapshot {
                status: "cancelled".to_string(),
                remaining_quantity: "0".to_string(),
                updated_at: ACKNOWLEDGED_AT.to_string(),
                ..status
            },
        }
    }

    pub fn routing_events(ack: &OrderPlacementAcknowledgement) -> Vec<EventEnvelope> {
        vec![crate::adapter_contract::event_envelope(
            "order.status",
            json!({
                "brokerOrderID": ack.broker_order_id,
                "accountID": ack.account_id,
                "environment": ack.environment,
                "status": ack.status,
                "updatedAt": ack.acknowledged_at,
                "lifecycleStateSource": ack.lifecycle_state_source
            }),
        )]
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct ValidatedMappedOrder {
        request_id: String,
        idempotency_key: String,
        account_id: String,
        environment: BrokerEnvironment,
        security_type: String,
        live_confirmation_text: Option<String>,
        modification_confirmation_text: Option<String>,
    }

    fn mapped_order_body(
        request_id: &str,
        account_id: &str,
        environment: BrokerEnvironment,
        live_confirmation_text: Option<String>,
        modification_confirmation_text: Option<String>,
    ) -> Value {
        json!({
            "requestID": request_id,
            "accountID": account_id,
            "environment": environment,
            "contract": {
                "conID": AAPL_CON_ID,
                "symbol": "AAPL",
                "securityType": "STK",
                "exchange": "SMART",
                "primaryExchange": "NASDAQ",
                "currency": "USD",
                "localSymbol": "AAPL",
                "tradingClass": "NMS"
            },
            "side": "buy",
            "quantity": "2",
            "orderType": "LMT",
            "timeInForce": "day",
            "limitPrice": "208.12",
            "marketRuleID": "26",
            "limitMinimumTick": "0.01",
            "validExchanges": ["SMART", "NASDAQ"],
            "liveConfirmationText": live_confirmation_text,
            "modificationConfirmationText": modification_confirmation_text,
            "transmit": true,
            "transmitMode": "singleOrderImmediate"
        })
    }

    fn acknowledgement(
        order: ValidatedMappedOrder,
        broker_order_id: &str,
        duplicate: bool,
        message: &str,
    ) -> OrderPlacementAcknowledgement {
        OrderPlacementAcknowledgement {
            request_id: order.request_id,
            idempotency_key: order.idempotency_key,
            broker_order_id: broker_order_id.to_string(),
            account_id: order.account_id,
            environment: order.environment,
            status: if duplicate { "duplicate" } else { "accepted" }.to_string(),
            acknowledged_at: ACKNOWLEDGED_AT.to_string(),
            lifecycle_state_source: "/v1/events and reconciliation endpoints".to_string(),
            message: message.to_string(),
        }
    }

    fn validate_mapped_order(
        body: &Value,
        idempotency_key: Option<&str>,
        expected_environment: Option<BrokerEnvironment>,
    ) -> Result<ValidatedMappedOrder, String> {
        let request_id = required_string(body, "requestID")?;
        let idempotency_key = validate_idempotency(&request_id, idempotency_key)?;
        let account_id = required_string(body, "accountID")?;
        let environment = required_environment(body)?;
        if let Some(expected_environment) = expected_environment {
            if environment != expected_environment {
                return Err(format!(
                    "mapped order environment must be {}",
                    environment_wire_value(expected_environment)
                ));
            }
        }
        let hydration = mapped_contract_hydration(body)?;
        if hydration.security_type == "BAG" {
            let expected_combo = hydration.combo_legs.iter().any(|leg| {
                leg.con_id == LIVE_OPTION_CON_ID && leg.ratio == 1 && leg.action == "BUY"
            }) && hydration.combo_legs.iter().any(|leg| {
                leg.con_id == LIVE_COMBO_SHORT_LEG_CON_ID && leg.ratio == 1 && leg.action == "SELL"
            });
            if !expected_combo {
                return Err(
                    "mapped combo order is not in the deterministic route fixture".to_string(),
                );
            }
        } else if hydration.con_id != AAPL_CON_ID
            && hydration.con_id != AAPL_OPTION_CON_ID
            && hydration.con_id != LIVE_OPTION_CON_ID
        {
            return Err(
                "mapped order contract is not in the deterministic route fixture".to_string(),
            );
        }
        let order_type = required_string(body, "orderType")?;
        if !matches!(
            order_type.as_str(),
            "MKT" | "LMT" | "STP" | "STP_LMT" | "TRAIL" | "TRAIL_LIMIT"
        ) {
            return Err(format!("unsupported mapped order type {order_type}"));
        }
        let quantity = required_decimal_string(body, "quantity")?;
        if quantity.starts_with('-') || quantity == "0" {
            return Err("mapped order quantity must be positive".to_string());
        }
        if order_type == "LMT" {
            let limit_price = required_decimal_string(body, "limitPrice")?;
            if decimal_units(&limit_price).is_none_or(|units| units <= 0) {
                return Err("mapped limit price must be positive".to_string());
            }
            let limit_minimum_tick = required_decimal_string(body, "limitMinimumTick")?;
            if decimal_units(&limit_minimum_tick).is_none_or(|units| units <= 0) {
                return Err("mapped order requires positive limit tick evidence".to_string());
            }
            if !tick_aligned(&limit_price, &limit_minimum_tick) {
                return Err("mapped limit price is not aligned to minimum tick".to_string());
            }
            if hydration.security_type != "BAG"
                && hydration.security_type != "OPT"
                && optional_string(body, "marketRuleID").as_deref() != Some("26")
            {
                return Err(
                    "mapped stock order requires marketRuleID 26 for deterministic route validation"
                        .to_string(),
                );
            }
        }
        let valid_exchanges = body
            .get("validExchanges")
            .and_then(|value| value.as_array())
            .ok_or_else(|| "mapped order requires validExchanges".to_string())?;
        let exchange = contract_string(body, "exchange")
            .ok_or_else(|| "mapped order requires contract exchange".to_string())?;
        let exchange_allowed = valid_exchanges.iter().any(|value| {
            value
                .as_str()
                .is_some_and(|valid_exchange| valid_exchange.eq_ignore_ascii_case(&exchange))
        });
        if !exchange_allowed {
            return Err("mapped order route validation requires SMART exchange".to_string());
        }
        if optional_bool(body, "transmit")? != Some(true) {
            return Err("mapped order transmit must decode as JSON true".to_string());
        }
        Ok(ValidatedMappedOrder {
            request_id,
            idempotency_key,
            account_id,
            environment,
            security_type: hydration.security_type,
            live_confirmation_text: optional_string(body, "liveConfirmationText"),
            modification_confirmation_text: optional_string(body, "modificationConfirmationText"),
        })
    }

    pub fn mapped_contract_hydration(body: &Value) -> Result<MappedContractHydration, String> {
        let request_id = required_string(body, "requestID")?;
        let security_type = contract_string(body, "securityType")
            .ok_or_else(|| "mapped order requires securityType".to_string())?
            .to_uppercase();
        let con_id = body
            .pointer("/contract/conID")
            .and_then(value_as_i64)
            .or_else(|| body.get("conID").and_then(value_as_i64))
            .unwrap_or(0);
        let symbol = contract_string(body, "symbol")
            .ok_or_else(|| "mapped order requires symbol".to_string())?;
        let exchange = contract_string(body, "exchange")
            .ok_or_else(|| "mapped order requires exchange".to_string())?;
        let currency = contract_string(body, "currency")
            .ok_or_else(|| "mapped order requires currency".to_string())?;
        let combo_legs = combo_legs(body)?;
        let primary_exchange = contract_string(body, "primaryExchange");
        let local_symbol = contract_string(body, "localSymbol");
        let trading_class = contract_string(body, "tradingClass");
        let multiplier = contract_string(body, "multiplier");
        let expiration = contract_string(body, "expiration");
        let strike = contract_string(body, "strike");
        let right = contract_string(body, "right");
        let underlying_con_id = contract_string(body, "underlyingConID");

        if security_type != "BAG" && con_id <= 0 {
            return Err(
                "mapped order contract conID must be positive for non-combo contracts".to_string(),
            );
        }
        if security_type == "BAG" && combo_legs.len() < 2 {
            return Err("mapped BAG combo order JSON requires at least two comboLegs".to_string());
        }
        if security_type == "OPT" {
            for (field_name, field_value) in [
                ("expiration", expiration.as_deref()),
                ("strike", strike.as_deref()),
                ("right", right.as_deref()),
                ("multiplier", multiplier.as_deref()),
                ("tradingClass", trading_class.as_deref()),
                ("localSymbol", local_symbol.as_deref()),
                ("underlyingConID", underlying_con_id.as_deref()),
            ] {
                if field_value.is_none_or(str::is_empty) {
                    return Err(format!(
                        "mapped option order JSON is missing required contract field {field_name}"
                    ));
                }
            }
            if !matches!(right.as_deref(), Some("C" | "P")) {
                return Err("mapped option right must be C or P".to_string());
            }
            if strike
                .as_deref()
                .and_then(decimal_units)
                .is_none_or(|units| units <= 0)
            {
                return Err("mapped option strike must be positive".to_string());
            }
            if multiplier
                .as_deref()
                .and_then(decimal_units)
                .is_none_or(|units| units <= 0)
            {
                return Err("mapped option multiplier must be positive".to_string());
            }
        }
        let required_option_fields_present = security_type == "OPT"
            && con_id > 0
            && !symbol.is_empty()
            && !exchange.is_empty()
            && !currency.is_empty()
            && local_symbol
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            && trading_class
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            && multiplier.as_deref().is_some_and(|value| !value.is_empty())
            && expiration.as_deref().is_some_and(|value| !value.is_empty())
            && strike.as_deref().is_some_and(|value| !value.is_empty())
            && matches!(right.as_deref(), Some("C" | "P"))
            && underlying_con_id
                .as_deref()
                .is_some_and(|value| !value.is_empty());
        Ok(MappedContractHydration {
            request_id,
            con_id,
            symbol,
            security_type: security_type.clone(),
            exchange,
            primary_exchange,
            currency,
            local_symbol,
            trading_class,
            multiplier,
            expiration,
            strike,
            right,
            underlying_con_id,
            combo_leg_count: combo_legs.len(),
            combo_legs,
            hydrates_con_id: security_type != "BAG",
            required_option_fields_present,
            uses_process_local_contract_cache: false,
        })
    }

    fn validate_idempotency(
        request_id: &str,
        idempotency_key: Option<&str>,
    ) -> Result<String, String> {
        let expected = idempotency_key_for_request_id(request_id);
        let Some(idempotency_key) = idempotency_key else {
            return Err("mapped command requires Idempotency-Key".to_string());
        };
        if idempotency_key != expected {
            return Err(format!(
                "Idempotency-Key must match request-derived key {expected}"
            ));
        }
        Ok(idempotency_key.to_string())
    }

    fn required_environment(body: &Value) -> Result<BrokerEnvironment, String> {
        match required_string(body, "environment")?.as_str() {
            "ibkrPaper" => Ok(BrokerEnvironment::IbkrPaper),
            "ibkrLive" => Ok(BrokerEnvironment::IbkrLive),
            other => Err(format!("unsupported IBKR environment {other}")),
        }
    }

    pub fn environment_wire_value(environment: BrokerEnvironment) -> &'static str {
        match environment {
            BrokerEnvironment::IbkrPaper => "ibkrPaper",
            BrokerEnvironment::IbkrLive => "ibkrLive",
        }
    }

    fn required_string(body: &Value, key: &str) -> Result<String, String> {
        optional_string(body, key).ok_or_else(|| format!("request body requires {key}"))
    }

    fn optional_string(body: &Value, key: &str) -> Option<String> {
        body.get(key)
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
    }

    fn contract_string(body: &Value, key: &str) -> Option<String> {
        body.get(key)
            .and_then(|value| value.as_str())
            .or_else(|| body.get("contract")?.get(key)?.as_str())
            .map(ToString::to_string)
    }

    fn required_decimal_string(body: &Value, key: &str) -> Result<String, String> {
        body.get(key)
            .and_then(|value| {
                value
                    .as_str()
                    .map(ToString::to_string)
                    .or_else(|| value.as_i64().map(|number| number.to_string()))
            })
            .ok_or_else(|| format!("request body requires decimal {key}"))
    }

    fn required_i64(body: &Value, key: &str) -> Result<i64, String> {
        body.get(key)
            .and_then(value_as_i64)
            .ok_or_else(|| format!("request body requires integer {key}"))
    }

    fn value_as_i64(value: &Value) -> Option<i64> {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|value| value.parse::<i64>().ok()))
    }

    fn optional_bool(body: &Value, key: &str) -> Result<Option<bool>, String> {
        let Some(value) = body.get(key) else {
            return Ok(None);
        };
        value
            .as_bool()
            .map(Some)
            .ok_or_else(|| format!("{key} must be a JSON boolean"))
    }

    fn combo_legs(body: &Value) -> Result<Vec<MappedComboLeg>, String> {
        let Some(raw_legs) = body.get("comboLegs") else {
            return Ok(Vec::new());
        };
        let legs = raw_legs
            .as_array()
            .ok_or_else(|| "comboLegs must be a JSON array".to_string())?;
        legs.iter()
            .map(|leg| {
                let con_id = required_i64(leg, "conID")?;
                let ratio = required_i64(leg, "ratio")?;
                if con_id <= 0 || ratio <= 0 {
                    return Err("combo leg conID and ratio must be positive".to_string());
                }
                let action = required_string(leg, "action")?.to_uppercase();
                if !matches!(action.as_str(), "BUY" | "SELL") {
                    return Err("combo leg action must normalize to BUY or SELL".to_string());
                }
                Ok(MappedComboLeg {
                    con_id,
                    ratio,
                    action,
                    exchange: required_string(leg, "exchange")?,
                })
            })
            .collect()
    }

    fn decimal_units(value: &str) -> Option<i64> {
        let value = value.trim();
        if value.is_empty() || value.starts_with('-') {
            return None;
        }
        let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
        let whole = whole.parse::<i64>().ok()?;
        if fraction.len() > 4 || !fraction.chars().all(|character| character.is_ascii_digit()) {
            return None;
        }
        let mut padded_fraction = fraction.to_string();
        while padded_fraction.len() < 4 {
            padded_fraction.push('0');
        }
        Some(whole * 10_000 + padded_fraction.parse::<i64>().ok()?)
    }

    fn tick_aligned(value: &str, minimum_tick: &str) -> bool {
        let Some(value_units) = decimal_units(value) else {
            return false;
        };
        let Some(tick_units) = decimal_units(minimum_tick) else {
            return false;
        };
        tick_units > 0 && value_units % tick_units == 0
    }
}

pub mod event_hub {
    use crate::adapter_contract::{connection_status_event, EventEnvelope};
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
    };
    use tokio::sync::broadcast;

    const REPLAY_CAPACITY: usize = 100;

    #[derive(Clone, Debug)]
    pub struct EventHub {
        replay: Arc<Mutex<VecDeque<EventEnvelope>>>,
        broadcaster: broadcast::Sender<EventEnvelope>,
    }

    impl Default for EventHub {
        fn default() -> Self {
            Self::new()
        }
    }

    impl EventHub {
        pub fn new() -> Self {
            let (broadcaster, _) = broadcast::channel(REPLAY_CAPACITY);
            Self {
                replay: Arc::new(Mutex::new(VecDeque::with_capacity(REPLAY_CAPACITY))),
                broadcaster,
            }
        }

        pub fn record(&self, event: EventEnvelope) {
            let mut replay = self.replay.lock().expect("event replay lock poisoned");
            if replay.len() == REPLAY_CAPACITY {
                replay.pop_front();
            }
            replay.push_back(event.clone());
            let _ = self.broadcaster.send(event);
        }

        pub fn replay(&self) -> Vec<EventEnvelope> {
            let replay = self.replay.lock().expect("event replay lock poisoned");
            replay.iter().cloned().collect()
        }

        pub fn subscribe(&self) -> broadcast::Receiver<EventEnvelope> {
            self.broadcaster.subscribe()
        }

        pub fn initial_events(&self) -> Vec<EventEnvelope> {
            let replay = self.replay();
            if replay
                .iter()
                .any(|event| event.event == "connection.status")
            {
                replay
            } else {
                let mut events = vec![connection_status_event()];
                events.extend(replay);
                events
            }
        }
    }
}

pub mod broker_callback_router {
    use crate::{
        adapter_contract::{default_endpoint, BrokerEnvironment, EventEnvelope},
        broker_protocol::{BrokerProtocolEvent, BrokerSessionManager},
        broker_read_model::{AccountStateCallback, AccountStateFixture, AccountStateStore},
        event_hub::EventHub,
        market_read_model::{MarketDataCallback, MarketDataFixture, MarketDataStore},
        order_routing::{
            self, OrderRoutingCallback, OrderRoutingCallbackState, OrderRoutingCallbackStore,
        },
        runtime_state::BrokerSessionSnapshot,
        tws_wire::{self, TwsCallback, TwsFrame},
    };
    use serde::{Deserialize, Serialize};
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "area", rename_all = "camelCase")]
    pub enum BrokerCallback {
        Protocol { event: BrokerProtocolEvent },
        Account { callback: AccountStateCallback },
        MarketData { callback: MarketDataCallback },
        OrderRouting { callback: OrderRoutingCallback },
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerCallbackRouteOutcome {
        pub route: String,
        pub published_event_names: Vec<String>,
        pub published_events: Vec<EventEnvelope>,
        pub session: BrokerSessionSnapshot,
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerCallbackRouterEvidence {
        pub decoded_tws_callbacks: Vec<TwsCallback>,
        pub outcomes: Vec<BrokerCallbackRouteOutcome>,
        pub session: BrokerSessionSnapshot,
        pub account_state: AccountStateFixture,
        pub market_state: MarketDataFixture,
        pub order_routing_state: OrderRoutingCallbackState,
        pub event_replay_names: Vec<String>,
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerCallbackRecordDecoderEvidence {
        pub decoded_tws_callbacks: Vec<TwsCallback>,
        pub decoded_methods: Vec<String>,
        pub outcomes: Vec<BrokerCallbackRouteOutcome>,
        pub session: BrokerSessionSnapshot,
        pub account_state: AccountStateFixture,
        pub market_state: MarketDataFixture,
        pub order_routing_state: OrderRoutingCallbackState,
        pub event_replay_names: Vec<String>,
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BrokerCallbackFieldDecoderEvidence {
        pub decoded_tws_callbacks: Vec<TwsCallback>,
        pub decoded_methods: Vec<String>,
        pub field_pair_counts: Vec<usize>,
        pub outcomes: Vec<BrokerCallbackRouteOutcome>,
        pub session: BrokerSessionSnapshot,
        pub account_state: AccountStateFixture,
        pub market_state: MarketDataFixture,
        pub order_routing_state: OrderRoutingCallbackState,
        pub event_replay_names: Vec<String>,
        pub malformed_error: tws_wire::TwsWireError,
    }

    #[derive(Clone, Debug)]
    pub struct BrokerCallbackRouter {
        session: Arc<Mutex<BrokerSessionManager>>,
        account_state: AccountStateStore,
        market_state: MarketDataStore,
        order_routing_state: OrderRoutingCallbackStore,
        event_hub: EventHub,
    }

    impl BrokerCallbackRouter {
        pub fn new(
            session: BrokerSessionManager,
            account_state: AccountStateStore,
            market_state: MarketDataStore,
            order_routing_state: OrderRoutingCallbackStore,
            event_hub: EventHub,
        ) -> Self {
            Self {
                session: Arc::new(Mutex::new(session)),
                account_state,
                market_state,
                order_routing_state,
                event_hub,
            }
        }

        pub fn deterministic() -> Self {
            let account_fixture = AccountStateFixture::deterministic();
            let market_fixture = MarketDataFixture::deterministic();
            Self::new(
                BrokerSessionManager::disconnected(default_endpoint()),
                AccountStateStore::from_callbacks(&account_fixture.broker_callback_transcript()),
                MarketDataStore::from_callbacks(&market_fixture.broker_callback_transcript()),
                OrderRoutingCallbackStore::default(),
                EventHub::default(),
            )
        }

        pub fn route(&self, callback: BrokerCallback) -> BrokerCallbackRouteOutcome {
            let (route, published_events) = match callback {
                BrokerCallback::Protocol { event } => {
                    let mut session = self
                        .session
                        .lock()
                        .expect("broker callback router session lock poisoned");
                    session.apply(event);
                    ("protocol".to_string(), vec![session.connection_event()])
                }
                BrokerCallback::Account { callback } => {
                    ("account".to_string(), self.account_state.record(callback))
                }
                BrokerCallback::MarketData { callback } => {
                    ("marketData".to_string(), self.market_state.record(callback))
                }
                BrokerCallback::OrderRouting { callback } => (
                    "orderRouting".to_string(),
                    self.order_routing_state.record(callback),
                ),
            };

            for event in &published_events {
                self.event_hub.record(event.clone());
            }

            BrokerCallbackRouteOutcome {
                route,
                published_event_names: published_events
                    .iter()
                    .map(|event| event.event.clone())
                    .collect(),
                published_events,
                session: self.session_snapshot(),
            }
        }

        pub fn route_tws_callback(
            &self,
            callback: &TwsCallback,
        ) -> Option<BrokerCallbackRouteOutcome> {
            callback
                .to_broker_callback()
                .map(|callback| self.route(callback))
        }

        pub fn session_snapshot(&self) -> BrokerSessionSnapshot {
            self.session
                .lock()
                .expect("broker callback router session lock poisoned")
                .snapshot()
        }

        pub fn account_snapshot(&self) -> AccountStateFixture {
            self.account_state.snapshot()
        }

        pub fn market_snapshot(&self) -> MarketDataFixture {
            self.market_state.snapshot()
        }

        pub fn order_routing_snapshot(&self) -> OrderRoutingCallbackState {
            self.order_routing_state.snapshot()
        }

        pub fn event_replay(&self) -> Vec<EventEnvelope> {
            self.event_hub.replay()
        }
    }

    pub fn deterministic_router_evidence() -> BrokerCallbackRouterEvidence {
        let router = BrokerCallbackRouter::deterministic();
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let paper_order = order_routing::paper_order_body();
        let paper_idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let paper_acknowledgement =
            order_routing::paper_acknowledgement(&paper_order, Some(&paper_idempotency_key), false)
                .expect("deterministic paper acknowledgement");

        let mut outcomes = vec![
            router.route(BrokerCallback::Protocol {
                event: BrokerProtocolEvent::connect_requested(),
            }),
            router.route(BrokerCallback::Protocol {
                event: BrokerProtocolEvent::socket_connected(),
            }),
        ];
        let decoded_tws_callbacks = deterministic_tws_callback_frames(
            &account_fixture,
            &market_fixture,
            paper_acknowledgement,
        )
        .into_iter()
        .map(|fields| {
            TwsFrame::new(fields)
                .and_then(|frame| tws_wire::decode_callback(&frame))
                .expect("deterministic TWS callback frame")
        })
        .collect::<Vec<_>>();
        outcomes.extend(
            decoded_tws_callbacks
                .iter()
                .filter_map(|callback| router.route_tws_callback(callback)),
        );
        let event_replay_names = router
            .event_replay()
            .iter()
            .map(|event| event.event.clone())
            .collect();

        BrokerCallbackRouterEvidence {
            decoded_tws_callbacks,
            outcomes,
            session: router.session_snapshot(),
            account_state: router.account_snapshot(),
            market_state: router.market_snapshot(),
            order_routing_state: router.order_routing_snapshot(),
            event_replay_names,
        }
    }

    pub fn deterministic_callback_record_decoder_evidence() -> BrokerCallbackRecordDecoderEvidence {
        let router = BrokerCallbackRouter::deterministic();
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let paper_order = order_routing::paper_order_body();
        let paper_idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let paper_preview =
            order_routing::preview_from_mapped_order(&paper_order, Some(&paper_idempotency_key))
                .expect("deterministic paper preview");
        let paper_acknowledgement =
            order_routing::paper_acknowledgement(&paper_order, Some(&paper_idempotency_key), false)
                .expect("deterministic paper acknowledgement");

        let mut outcomes = vec![
            router.route(BrokerCallback::Protocol {
                event: BrokerProtocolEvent::connect_requested(),
            }),
            router.route(BrokerCallback::Protocol {
                event: BrokerProtocolEvent::socket_connected(),
            }),
        ];
        let decoded_tws_callbacks = deterministic_tws_callback_record_frames(
            &account_fixture,
            &market_fixture,
            paper_preview,
            paper_acknowledgement,
        )
        .into_iter()
        .map(|fields| {
            TwsFrame::new(fields)
                .and_then(|frame| tws_wire::decode_callback(&frame))
                .expect("deterministic TWS callback record frame")
        })
        .collect::<Vec<_>>();
        let decoded_methods = decoded_tws_callbacks
            .iter()
            .filter_map(|callback| {
                if let TwsCallback::CallbackRecord { method, .. } = callback {
                    Some(method.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        outcomes.extend(
            decoded_tws_callbacks
                .iter()
                .filter_map(|callback| router.route_tws_callback(callback)),
        );
        let event_replay_names = router
            .event_replay()
            .iter()
            .map(|event| event.event.clone())
            .collect();

        BrokerCallbackRecordDecoderEvidence {
            decoded_tws_callbacks,
            decoded_methods,
            outcomes,
            session: router.session_snapshot(),
            account_state: router.account_snapshot(),
            market_state: router.market_snapshot(),
            order_routing_state: router.order_routing_snapshot(),
            event_replay_names,
        }
    }

    pub fn deterministic_field_callback_decoder_evidence() -> BrokerCallbackFieldDecoderEvidence {
        let router = BrokerCallbackRouter::deterministic();
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let paper_order = order_routing::paper_order_body();
        let paper_idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let paper_acknowledgement =
            order_routing::paper_acknowledgement(&paper_order, Some(&paper_idempotency_key), false)
                .expect("deterministic paper acknowledgement");

        let frames = deterministic_tws_field_callback_frames(
            &account_fixture,
            &market_fixture,
            &paper_acknowledgement,
        );
        let field_pair_counts = frames
            .iter()
            .map(|fields| fields.len().saturating_sub(3) / 2)
            .collect::<Vec<_>>();
        let decoded_tws_callbacks = frames
            .into_iter()
            .map(|fields| {
                TwsFrame::new(fields)
                    .and_then(|frame| tws_wire::decode_callback(&frame))
                    .expect("deterministic TWS field callback frame")
            })
            .collect::<Vec<_>>();
        let decoded_methods = decoded_tws_callbacks
            .iter()
            .filter_map(|callback| {
                if let TwsCallback::FieldRecord { method, .. } = callback {
                    Some(method.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let outcomes = decoded_tws_callbacks
            .iter()
            .filter_map(|callback| router.route_tws_callback(callback))
            .collect::<Vec<_>>();
        let event_replay_names = router
            .event_replay()
            .iter()
            .map(|event| event.event.clone())
            .collect();
        let malformed_error = TwsFrame::new(vec![
            tws_wire::IN_AGENTIC_FIELD_CALLBACK.to_string(),
            tws_wire::REQUEST_VERSION.to_string(),
            "accountSummary".to_string(),
            "accountID".to_string(),
        ])
        .and_then(|frame| tws_wire::decode_callback(&frame))
        .expect_err("odd field callback key/value count must reject");

        BrokerCallbackFieldDecoderEvidence {
            decoded_tws_callbacks,
            decoded_methods,
            field_pair_counts,
            outcomes,
            session: router.session_snapshot(),
            account_state: router.account_snapshot(),
            market_state: router.market_snapshot(),
            order_routing_state: router.order_routing_snapshot(),
            event_replay_names,
            malformed_error,
        }
    }

    fn deterministic_tws_callback_frames(
        account_fixture: &AccountStateFixture,
        market_fixture: &MarketDataFixture,
        paper_acknowledgement: order_routing::OrderPlacementAcknowledgement,
    ) -> Vec<Vec<String>> {
        vec![
            vec![
                tws_wire::IN_NEXT_VALID_ID.to_string(),
                tws_wire::REQUEST_VERSION.to_string(),
                crate::broker_protocol::FIXTURE_NEXT_VALID_ORDER_ID.to_string(),
            ],
            vec![
                tws_wire::IN_CURRENT_TIME.to_string(),
                tws_wire::REQUEST_VERSION.to_string(),
                "1800037800".to_string(),
            ],
            vec![
                tws_wire::IN_MANAGED_ACCOUNTS.to_string(),
                tws_wire::REQUEST_VERSION.to_string(),
                "DU1234567,U1234567".to_string(),
            ],
            tws_wire::domain_callback_fields(&BrokerCallback::Account {
                callback: AccountStateCallback::AccountSummary {
                    summary: account_fixture.summaries[0].clone(),
                },
            })
            .expect("account domain callback frame"),
            tws_wire::domain_callback_fields(&BrokerCallback::MarketData {
                callback: MarketDataCallback::Quote {
                    quote: Box::new(market_fixture.quote.clone()),
                },
            })
            .expect("market domain callback frame"),
            tws_wire::domain_callback_fields(&BrokerCallback::OrderRouting {
                callback: OrderRoutingCallback::PlacementAcknowledgement {
                    acknowledgement: Box::new(paper_acknowledgement),
                },
            })
            .expect("order domain callback frame"),
        ]
    }

    fn deterministic_tws_callback_record_frames(
        account_fixture: &AccountStateFixture,
        market_fixture: &MarketDataFixture,
        paper_preview: order_routing::BrokerOrderPreview,
        paper_acknowledgement: order_routing::OrderPlacementAcknowledgement,
    ) -> Vec<Vec<String>> {
        let initial_fill = serde_json::from_value::<crate::broker_read_model::FillReport>(
            account_fixture.initial_fill_event.payload.clone(),
        )
        .expect("deterministic initial fill");
        let commissioned_fill = serde_json::from_value::<crate::broker_read_model::FillReport>(
            account_fixture
                .commission_update_event
                .payload
                .get("fill")
                .cloned()
                .expect("deterministic commission update fill"),
        )
        .expect("deterministic commission update payload");
        vec![
            tws_wire::callback_record_fields("accountSummary", &account_fixture.summaries[0])
                .expect("accountSummary callback record"),
            tws_wire::callback_record_fields("position", &account_fixture.positions[0])
                .expect("position callback record"),
            tws_wire::callback_record_fields(
                "orderStatus",
                &account_fixture.lifecycle_records[0].status_timeline[0],
            )
            .expect("orderStatus callback record"),
            tws_wire::callback_record_fields("execDetails", &initial_fill)
                .expect("execDetails callback record"),
            tws_wire::callback_record_fields(
                "commissionReport",
                &serde_json::json!({
                    "brokerOrderID": commissioned_fill.broker_order_id,
                    "executionID": commissioned_fill.fill.id,
                    "commission": commissioned_fill.commission.expect("commission"),
                    "commissionReportedAt": commissioned_fill
                        .commission_reported_at
                        .expect("commission reported at"),
                    "reportedAt": commissioned_fill.reported_at
                }),
            )
            .expect("commissionReport callback record"),
            tws_wire::callback_record_fields("contractDetails", &market_fixture.stock_details)
                .expect("contractDetails callback record"),
            tws_wire::callback_record_fields("marketRule", &market_fixture.market_rule)
                .expect("marketRule callback record"),
            tws_wire::callback_record_fields("tickPrice", &market_fixture.quote)
                .expect("tickPrice callback record"),
            tws_wire::callback_record_fields("historicalData", &market_fixture.historical_bars)
                .expect("historicalData callback record"),
            tws_wire::callback_record_fields("historicalTicks", &market_fixture.historical_ticks)
                .expect("historicalTicks callback record"),
            tws_wire::callback_record_fields(
                "securityDefinitionOptionParameter",
                &market_fixture.option_chain,
            )
            .expect("securityDefinitionOptionParameter callback record"),
            tws_wire::callback_record_fields("optionContract", &market_fixture.option_contract)
                .expect("optionContract callback record"),
            tws_wire::callback_record_fields(
                "optionContractDetails",
                &market_fixture.option_details,
            )
            .expect("optionContractDetails callback record"),
            tws_wire::callback_record_fields("tickOptionComputation", &market_fixture.option_quote)
                .expect("tickOptionComputation callback record"),
            tws_wire::callback_record_fields("whatIfPreview", &paper_preview)
                .expect("whatIfPreview callback record"),
            tws_wire::callback_record_fields("placeOrderAcknowledgement", &paper_acknowledgement)
                .expect("placeOrderAcknowledgement callback record"),
        ]
    }

    fn deterministic_tws_field_callback_frames(
        account_fixture: &AccountStateFixture,
        market_fixture: &MarketDataFixture,
        paper_acknowledgement: &order_routing::OrderPlacementAcknowledgement,
    ) -> Vec<Vec<String>> {
        vec![
            account_summary_field_frame(&account_fixture.summaries[0]),
            position_field_frame(&account_fixture.positions[0]),
            order_status_field_frame(&account_fixture.lifecycle_records[0].status_timeline[0]),
            quote_field_frame(&market_fixture.quote),
            placement_acknowledgement_field_frame(paper_acknowledgement),
        ]
    }

    fn account_summary_field_frame(
        summary: &crate::broker_read_model::AccountSummary,
    ) -> Vec<String> {
        tws_wire::field_callback_fields(
            "accountSummary",
            [
                ("accountID", summary.account.account_id.clone()),
                ("displayName", summary.account.display_name.clone()),
                (
                    "environment",
                    environment_wire_value(summary.account.environment).to_string(),
                ),
                ("permissions", summary.account.trading_permissions.join(",")),
                ("netLiquidation", summary.net_liquidation.clone()),
                ("buyingPower", summary.buying_power.clone()),
                ("currency", summary.currency.clone()),
                ("capturedAt", summary.captured_at.clone()),
            ],
        )
        .expect("accountSummary field callback")
    }

    fn position_field_frame(position: &crate::broker_read_model::PositionSnapshot) -> Vec<String> {
        let instrument = &position.instrument;
        tws_wire::field_callback_fields(
            "position",
            [
                ("accountID", position.account_id.clone()),
                ("conID", instrument.con_id.to_string()),
                ("symbol", instrument.symbol.clone()),
                ("securityType", instrument.security_type.clone()),
                ("currency", instrument.currency.clone()),
                ("exchange", instrument.exchange.clone()),
                ("expiry", instrument.expiry.clone().unwrap_or_default()),
                ("right", instrument.right.clone().unwrap_or_default()),
                ("strike", instrument.strike.clone().unwrap_or_default()),
                ("quantity", position.quantity.clone()),
                ("averageCost", position.average_cost.clone()),
                ("capturedAt", position.captured_at.clone()),
            ],
        )
        .expect("position field callback")
    }

    fn order_status_field_frame(
        status: &crate::broker_read_model::OrderStatusSnapshot,
    ) -> Vec<String> {
        tws_wire::field_callback_fields(
            "orderStatus",
            [
                ("brokerOrderID", status.broker_order_id.clone()),
                (
                    "permanentID",
                    status.permanent_id.clone().unwrap_or_default(),
                ),
                ("clientID", status.client_id.to_string()),
                ("intentID", status.intent_id.clone()),
                ("accountID", status.account_id.clone()),
                (
                    "environment",
                    environment_wire_value(status.environment).to_string(),
                ),
                ("status", status.status.clone()),
                ("submittedAt", status.submitted_at.clone()),
                ("updatedAt", status.updated_at.clone()),
                ("filledQuantity", status.filled_quantity.clone()),
                ("remainingQuantity", status.remaining_quantity.clone()),
                (
                    "averageFillPrice",
                    status.average_fill_price.clone().unwrap_or_default(),
                ),
                (
                    "parentBrokerOrderID",
                    status
                        .linkage
                        .as_ref()
                        .and_then(|linkage| linkage.parent_broker_order_id.clone())
                        .unwrap_or_default(),
                ),
                (
                    "ocaGroup",
                    status
                        .linkage
                        .as_ref()
                        .and_then(|linkage| linkage.oca_group.clone())
                        .unwrap_or_default(),
                ),
            ],
        )
        .expect("orderStatus field callback")
    }

    fn quote_field_frame(quote: &crate::market_read_model::QuoteSnapshot) -> Vec<String> {
        let contract = &quote.contract;
        tws_wire::field_callback_fields(
            "tickPrice",
            [
                ("conID", contract.con_id.to_string()),
                ("symbol", contract.symbol.clone()),
                ("securityType", contract.security_type.clone()),
                ("exchange", contract.exchange.clone()),
                (
                    "primaryExchange",
                    contract.primary_exchange.clone().unwrap_or_default(),
                ),
                ("currency", contract.currency.clone()),
                (
                    "localSymbol",
                    contract.local_symbol.clone().unwrap_or_default(),
                ),
                (
                    "tradingClass",
                    contract.trading_class.clone().unwrap_or_default(),
                ),
                (
                    "multiplier",
                    contract.multiplier.clone().unwrap_or_default(),
                ),
                (
                    "timezoneIdentifier",
                    contract.timezone_identifier.clone().unwrap_or_default(),
                ),
                ("marketDataType", quote.market_data_type.clone()),
                ("bid", quote.bid.clone()),
                ("ask", quote.ask.clone()),
                ("last", quote.last.clone().unwrap_or_default()),
                ("bidSize", quote.bid_size.clone().unwrap_or_default()),
                ("askSize", quote.ask_size.clone().unwrap_or_default()),
                ("lastSize", quote.last_size.clone().unwrap_or_default()),
                ("quoteTimestamp", quote.quote_timestamp.clone()),
                ("capturedAt", quote.captured_at.clone()),
            ],
        )
        .expect("tickPrice field callback")
    }

    fn placement_acknowledgement_field_frame(
        acknowledgement: &order_routing::OrderPlacementAcknowledgement,
    ) -> Vec<String> {
        tws_wire::field_callback_fields(
            "placeOrderAcknowledgement",
            [
                ("requestID", acknowledgement.request_id.clone()),
                ("idempotencyKey", acknowledgement.idempotency_key.clone()),
                ("brokerOrderID", acknowledgement.broker_order_id.clone()),
                ("accountID", acknowledgement.account_id.clone()),
                (
                    "environment",
                    environment_wire_value(acknowledgement.environment).to_string(),
                ),
                ("status", acknowledgement.status.clone()),
                ("acknowledgedAt", acknowledgement.acknowledged_at.clone()),
                (
                    "lifecycleStateSource",
                    acknowledgement.lifecycle_state_source.clone(),
                ),
                ("message", acknowledgement.message.clone()),
            ],
        )
        .expect("placeOrderAcknowledgement field callback")
    }

    fn environment_wire_value(environment: BrokerEnvironment) -> &'static str {
        match environment {
            BrokerEnvironment::IbkrPaper => "ibkrPaper",
            BrokerEnvironment::IbkrLive => "ibkrLive",
        }
    }
}

pub mod operation_ledger {
    use crate::adapter_contract::now_rfc3339;
    use serde::{Deserialize, Serialize};
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    #[derive(Clone, Debug, Default)]
    pub struct OperationLedger {
        records: Arc<Mutex<HashMap<String, AuditReceipt>>>,
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AuditReceipt {
        #[serde(rename = "requestID")]
        pub request_id: String,
        pub route: String,
        pub method: String,
        pub command_type: CommandType,
        pub environment: Option<String>,
        #[serde(rename = "accountID")]
        pub account_id: Option<String>,
        pub idempotency_key: Option<String>,
        pub body_hash: String,
        pub decision: LedgerDecisionKind,
        pub failure_code: Option<String>,
        pub recorded_at: String,
        pub redaction_applied: bool,
    }

    #[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub enum CommandType {
        PreviewOrder,
        PlacePaperOrder,
        PlaceLiveOrder,
        ModifyOrder,
        CancelOrder,
        GlobalCancel,
        ExerciseOption,
        QuoteSubscribe,
        QuoteUnsubscribe,
        BarStreamStart,
        BarStreamStop,
    }

    impl CommandType {
        pub fn parse(method: &str, path: &str) -> Option<Self> {
            match (method, path) {
                ("POST", "/v1/orders/preview") => Some(Self::PreviewOrder),
                ("POST", "/v1/orders/paper") => Some(Self::PlacePaperOrder),
                ("POST", "/v1/orders/live") => Some(Self::PlaceLiveOrder),
                ("POST", "/v1/options/exercise") => Some(Self::ExerciseOption),
                ("POST", "/v1/orders/global-cancel") => Some(Self::GlobalCancel),
                _ if method == "POST"
                    && path.starts_with("/v1/orders/")
                    && path.ends_with("/modify") =>
                {
                    Some(Self::ModifyOrder)
                }
                _ if method == "POST"
                    && path.starts_with("/v1/orders/")
                    && path.ends_with("/cancel") =>
                {
                    Some(Self::CancelOrder)
                }
                _ if method == "POST"
                    && path.starts_with("/v1/quotes/")
                    && path.ends_with("/subscribe") =>
                {
                    Some(Self::QuoteSubscribe)
                }
                _ if method == "DELETE"
                    && path.starts_with("/v1/quotes/")
                    && path.ends_with("/subscribe") =>
                {
                    Some(Self::QuoteUnsubscribe)
                }
                _ if method == "POST"
                    && path.starts_with("/v1/bars/")
                    && path.ends_with("/stream") =>
                {
                    Some(Self::BarStreamStart)
                }
                _ if method == "DELETE"
                    && path.starts_with("/v1/bars/")
                    && path.ends_with("/stream") =>
                {
                    Some(Self::BarStreamStop)
                }
                _ => None,
            }
        }

        pub fn requires_idempotency(self) -> bool {
            matches!(
                self,
                Self::PreviewOrder
                    | Self::PlacePaperOrder
                    | Self::PlaceLiveOrder
                    | Self::ModifyOrder
                    | Self::ExerciseOption
            )
        }
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub enum LedgerDecisionKind {
        Accepted,
        Replayed,
        RejectedIdempotencyMismatch,
        RejectedMissingIdempotencyKey,
        RecordedWithoutIdempotency,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct LedgerDecision {
        pub receipt: AuditReceipt,
        pub should_return_rejected_order: bool,
    }

    impl OperationLedger {
        pub fn record(
            &self,
            method: &str,
            path: &str,
            idempotency_key: Option<String>,
            fallback_request_id: String,
            body: &[u8],
        ) -> Option<LedgerDecision> {
            let command_type = CommandType::parse(method, path)?;
            let body_hash = stable_body_hash(body);
            let body_json = serde_json::from_slice::<serde_json::Value>(body).ok();
            let account_id = body_json
                .as_ref()
                .and_then(extract_account_id)
                .map(mask_account_id);
            let environment = body_json.as_ref().and_then(extract_environment);
            let request_id = idempotency_key
                .clone()
                .unwrap_or_else(|| fallback_request_id.clone());

            if command_type.requires_idempotency() && idempotency_key.is_none() {
                return Some(LedgerDecision {
                    receipt: receipt(ReceiptDraft {
                        method,
                        path,
                        command_type,
                        request_id,
                        idempotency_key: None,
                        body_hash,
                        environment,
                        account_id,
                        decision: LedgerDecisionKind::RejectedMissingIdempotencyKey,
                        failure_code: Some("rejectedOrder".to_string()),
                    }),
                    should_return_rejected_order: true,
                });
            }

            let Some(idempotency_key) = idempotency_key else {
                return Some(LedgerDecision {
                    receipt: receipt(ReceiptDraft {
                        method,
                        path,
                        command_type,
                        request_id,
                        idempotency_key: None,
                        body_hash,
                        environment,
                        account_id,
                        decision: LedgerDecisionKind::RecordedWithoutIdempotency,
                        failure_code: None,
                    }),
                    should_return_rejected_order: false,
                });
            };

            let ledger_key = format!("{:?}:{idempotency_key}", command_type);
            let mut records = self.records.lock().expect("operation ledger lock poisoned");
            if let Some(previous) = records.get(&ledger_key) {
                if previous.body_hash == body_hash {
                    let mut replay = previous.clone();
                    replay.decision = LedgerDecisionKind::Replayed;
                    replay.recorded_at = now_rfc3339();
                    return Some(LedgerDecision {
                        receipt: replay,
                        should_return_rejected_order: false,
                    });
                }

                return Some(LedgerDecision {
                    receipt: receipt(ReceiptDraft {
                        method,
                        path,
                        command_type,
                        request_id,
                        idempotency_key: Some(idempotency_key),
                        body_hash,
                        environment,
                        account_id,
                        decision: LedgerDecisionKind::RejectedIdempotencyMismatch,
                        failure_code: Some("rejectedOrder".to_string()),
                    }),
                    should_return_rejected_order: true,
                });
            }

            let receipt = receipt(ReceiptDraft {
                method,
                path,
                command_type,
                request_id,
                idempotency_key: Some(idempotency_key),
                body_hash,
                environment,
                account_id,
                decision: LedgerDecisionKind::Accepted,
                failure_code: None,
            });
            records.insert(ledger_key, receipt.clone());
            Some(LedgerDecision {
                receipt,
                should_return_rejected_order: false,
            })
        }
    }

    struct ReceiptDraft<'a> {
        method: &'a str,
        path: &'a str,
        command_type: CommandType,
        request_id: String,
        idempotency_key: Option<String>,
        body_hash: String,
        environment: Option<String>,
        account_id: Option<String>,
        decision: LedgerDecisionKind,
        failure_code: Option<String>,
    }

    fn receipt(draft: ReceiptDraft<'_>) -> AuditReceipt {
        AuditReceipt {
            request_id: draft.request_id,
            route: redact_text(draft.path),
            method: draft.method.to_string(),
            command_type: draft.command_type,
            environment: draft.environment,
            account_id: draft.account_id,
            idempotency_key: draft.idempotency_key,
            body_hash: draft.body_hash,
            decision: draft.decision,
            failure_code: draft.failure_code,
            recorded_at: now_rfc3339(),
            redaction_applied: true,
        }
    }

    fn extract_account_id(value: &serde_json::Value) -> Option<&str> {
        value
            .get("accountID")
            .or_else(|| value.get("accountId"))
            .and_then(|value| value.as_str())
    }

    fn extract_environment(value: &serde_json::Value) -> Option<String> {
        value
            .get("environment")
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
    }

    pub fn stable_body_hash(body: &[u8]) -> String {
        let mut hash = 0xcbf29ce484222325_u64;
        for byte in body {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        format!("fnv1a64:{hash:016x}")
    }

    pub fn mask_account_id(account_id: &str) -> String {
        if account_id.starts_with("DU") && account_id.len() > 6 {
            format!("DU***{}", &account_id[account_id.len() - 4..])
        } else if account_id.starts_with('U') && account_id.len() > 5 {
            format!("U***{}", &account_id[account_id.len() - 4..])
        } else {
            "[redacted-account]".to_string()
        }
    }

    pub fn redact_text(input: &str) -> String {
        let mut output = input.to_string();
        for token in input.split(|character: char| !character.is_ascii_alphanumeric()) {
            let is_du_account = token.starts_with("DU")
                && token.len() >= 8
                && token[2..]
                    .chars()
                    .all(|character| character.is_ascii_digit());
            let is_u_account = token.starts_with('U')
                && token.len() >= 7
                && token[1..]
                    .chars()
                    .all(|character| character.is_ascii_digit());
            if is_du_account || is_u_account {
                output = output.replace(token, &mask_account_id(token));
            }
        }
        output
            .replace("REDACT_ME", "[redacted]")
            .replace("apiToken", "redactedField")
            .replace("accessToken", "redactedField")
    }

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FailureTaxonomyEntry {
        pub code: String,
        pub category: String,
        pub http_status: u16,
        pub emits_event: bool,
        pub retryable: bool,
    }

    pub fn failure_taxonomy() -> Vec<FailureTaxonomyEntry> {
        vec![
            taxonomy("disconnectedGateway", "session", 503, true, true),
            taxonomy("unauthenticatedGateway", "session", 401, true, true),
            taxonomy("pacingLimit", "pacing", 429, true, true),
            taxonomy("missingEntitlement", "marketData", 403, true, false),
            taxonomy("staleData", "marketData", 409, true, true),
            taxonomy("invalidContract", "contract", 400, true, false),
            taxonomy("rejectedOrder", "order", 400, true, false),
            taxonomy("unsupportedOrderType", "order", 400, true, false),
            taxonomy("liveTradingDisabled", "liveGate", 403, true, false),
            taxonomy("livePortRejected", "liveGate", 403, true, false),
            taxonomy("orderNotFound", "reconciliation", 404, true, false),
            taxonomy("invalidEventSubscription", "events", 400, true, false),
        ]
    }

    fn taxonomy(
        code: &str,
        category: &str,
        http_status: u16,
        emits_event: bool,
        retryable: bool,
    ) -> FailureTaxonomyEntry {
        FailureTaxonomyEntry {
            code: code.to_string(),
            category: category.to_string(),
            http_status,
            emits_event,
            retryable,
        }
    }
}

pub mod live_workbench {
    use crate::adapter_contract::now_rfc3339;
    use serde_json::{json, Value};
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};

    const SOURCE_NAME: &str = "Yahoo Finance chart";
    const DEFAULT_SYMBOL: &str = "NVDA";

    #[derive(Clone, Debug)]
    pub struct LiveWorkbenchError {
        pub code: &'static str,
        pub message: String,
    }

    #[derive(Clone, Debug)]
    struct LiveBar {
        timestamp: String,
        x: f64,
        open: f64,
        high: f64,
        low: f64,
        close: f64,
        volume: f64,
    }

    #[derive(Clone, Debug)]
    struct LiveSnapshot {
        source_url: String,
        fetched_at: String,
        symbol: String,
        company: String,
        venue: String,
        currency: String,
        regular_market_time: String,
        last: f64,
        previous_close: f64,
        high: f64,
        low: f64,
        volume: f64,
        bars: Vec<LiveBar>,
    }

    pub async fn fetch_live_workbench(symbol: Option<&str>) -> Result<Value, LiveWorkbenchError> {
        let symbol = sanitize_symbol(symbol.unwrap_or(DEFAULT_SYMBOL));
        let source_url = format!(
            "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=5m&includePrePost=true"
        );
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X) AgenticTrading/0.1")
            .build()
            .map_err(|error| LiveWorkbenchError {
                code: "liveClientInitFailed",
                message: error.to_string(),
            })?;
        let response =
            client
                .get(&source_url)
                .send()
                .await
                .map_err(|error| LiveWorkbenchError {
                    code: "liveFetchFailed",
                    message: format!("{SOURCE_NAME} request failed: {error}"),
                })?;
        let status = response.status();
        if !status.is_success() {
            return Err(LiveWorkbenchError {
                code: "liveFetchRejected",
                message: format!("{SOURCE_NAME} returned HTTP {status} for {symbol}."),
            });
        }
        let payload = response
            .json::<Value>()
            .await
            .map_err(|error| LiveWorkbenchError {
                code: "liveDecodeFailed",
                message: format!("{SOURCE_NAME} JSON decode failed: {error}"),
            })?;
        let snapshot = snapshot_from_yahoo(symbol, source_url, payload)?;
        Ok(workbench_payload(snapshot))
    }

    fn snapshot_from_yahoo(
        symbol: String,
        source_url: String,
        payload: Value,
    ) -> Result<LiveSnapshot, LiveWorkbenchError> {
        let result = payload
            .pointer("/chart/result/0")
            .ok_or_else(|| LiveWorkbenchError {
                code: "livePayloadMissing",
                message: format!("{SOURCE_NAME} response did not include chart.result[0]."),
            })?;
        let meta = result.get("meta").ok_or_else(|| LiveWorkbenchError {
            code: "livePayloadMissing",
            message: format!("{SOURCE_NAME} response did not include chart metadata."),
        })?;
        let timestamps = result
            .get("timestamp")
            .and_then(Value::as_array)
            .ok_or_else(|| LiveWorkbenchError {
                code: "livePayloadMissing",
                message: format!("{SOURCE_NAME} response did not include timestamps."),
            })?;
        let quote = result
            .pointer("/indicators/quote/0")
            .ok_or_else(|| LiveWorkbenchError {
                code: "livePayloadMissing",
                message: format!("{SOURCE_NAME} response did not include quote bars."),
            })?;
        let opens = array_at(quote, "open")?;
        let highs = array_at(quote, "high")?;
        let lows = array_at(quote, "low")?;
        let closes = array_at(quote, "close")?;
        let volumes = array_at(quote, "volume")?;
        let count = timestamps
            .len()
            .min(opens.len())
            .min(highs.len())
            .min(lows.len())
            .min(closes.len())
            .min(volumes.len());
        let mut raw_bars = Vec::new();
        for index in 0..count {
            let Some(timestamp) = timestamps[index].as_i64().and_then(unix_to_rfc3339) else {
                continue;
            };
            let (Some(open), Some(high), Some(low), Some(close)) = (
                numeric(&opens[index]),
                numeric(&highs[index]),
                numeric(&lows[index]),
                numeric(&closes[index]),
            ) else {
                continue;
            };
            let volume = numeric(&volumes[index]).unwrap_or_default();
            raw_bars.push((timestamp, open, high, low, close, volume));
        }
        let selected = raw_bars
            .iter()
            .rev()
            .take(34)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        if selected.len() < 8 {
            return Err(LiveWorkbenchError {
                code: "liveBarsInsufficient",
                message: format!(
                    "{SOURCE_NAME} returned only {} complete bars for {symbol}.",
                    selected.len()
                ),
            });
        }
        let max_volume = selected.iter().map(|bar| bar.5).fold(1.0_f64, f64::max);
        let denominator = (selected.len().saturating_sub(1)).max(1) as f64;
        let bars = selected
            .into_iter()
            .enumerate()
            .map(
                |(index, (timestamp, open, high, low, close, volume))| LiveBar {
                    timestamp,
                    x: index as f64 / denominator,
                    open,
                    high,
                    low,
                    close,
                    volume: 120.0 + (volume / max_volume) * 600.0,
                },
            )
            .collect::<Vec<_>>();
        let last = number_at(meta, "regularMarketPrice")
            .or_else(|| bars.last().map(|bar| bar.close))
            .ok_or_else(|| LiveWorkbenchError {
                code: "livePayloadMissing",
                message: format!("{SOURCE_NAME} response did not include a market price."),
            })?;
        let previous_close = number_at(meta, "previousClose")
            .or_else(|| number_at(meta, "chartPreviousClose"))
            .unwrap_or(last);
        let regular_market_time = number_at(meta, "regularMarketTime")
            .and_then(|value| unix_to_rfc3339(value as i64))
            .or_else(|| bars.last().map(|bar| bar.timestamp.clone()))
            .unwrap_or_else(now_rfc3339);
        let company = string_at(meta, "longName")
            .or_else(|| string_at(meta, "shortName"))
            .unwrap_or_else(|| symbol.clone());
        let venue = string_at(meta, "fullExchangeName")
            .or_else(|| string_at(meta, "exchangeName"))
            .unwrap_or_else(|| "NASDAQ".to_string());
        let currency = string_at(meta, "currency").unwrap_or_else(|| "USD".to_string());
        let high = number_at(meta, "regularMarketDayHigh")
            .unwrap_or_else(|| bars.iter().map(|bar| bar.high).fold(last, f64::max));
        let low = number_at(meta, "regularMarketDayLow")
            .unwrap_or_else(|| bars.iter().map(|bar| bar.low).fold(last, f64::min));
        let volume = number_at(meta, "regularMarketVolume")
            .unwrap_or_else(|| bars.iter().map(|bar| bar.volume).sum());
        Ok(LiveSnapshot {
            source_url,
            fetched_at: now_rfc3339(),
            symbol,
            company,
            venue,
            currency,
            regular_market_time,
            last,
            previous_close,
            high,
            low,
            volume,
            bars,
        })
    }

    fn workbench_payload(snapshot: LiveSnapshot) -> Value {
        let change = snapshot.last - snapshot.previous_close;
        let change_percent = if snapshot.previous_close.abs() > f64::EPSILON {
            change / snapshot.previous_close * 100.0
        } else {
            0.0
        };
        let bid = snapshot.last - 0.01;
        let ask = snapshot.last + 0.01;
        let target_one = snapshot.last * 1.015;
        let target_two = snapshot.last * 1.03;
        let stop_one = snapshot.last * 0.985;
        let invalidation = snapshot.last * 0.97;
        let bars = snapshot
            .bars
            .iter()
            .map(|bar| {
                json!({
                    "timestamp": bar.timestamp,
                    "x": round4(bar.x),
                    "open": round2(bar.open),
                    "high": round2(bar.high),
                    "low": round2(bar.low),
                    "close": round2(bar.close),
                    "volume": round0(bar.volume),
                })
            })
            .collect::<Vec<_>>();
        let synthetic_chain = synthetic_options(snapshot.last);
        json!({
            "workspaceModes": ["Research", "Paper", "Live Review"],
            "activeWorkspaceMode": "Paper",
            "symbol": snapshot.symbol,
            "company": snapshot.company,
            "venue": snapshot.venue,
            "lastPrice": price(snapshot.last),
            "change": signed_price(change),
            "changePercent": signed_percent(change_percent),
            "quote": {
                "bid": price(bid),
                "ask": price(ask),
                "high": price(snapshot.high),
                "low": price(snapshot.low),
                "volume": compact_volume(snapshot.volume),
                "size": "live"
            },
            "adapter": {
                "connectionState": "connected",
                "providerState": "Rust Backend Live",
                "freshness": format!("Fetched {}", snapshot.fetched_at),
                "paperState": "Paper Ready",
                "rollback": "Rollback Active",
                "adapterHealth": "Backend Healthy",
                "alerts": 0,
                "externalEvidence": "External live market fetch succeeded"
            },
            "liveSource": {
                "provider": SOURCE_NAME,
                "url": snapshot.source_url,
                "symbol": snapshot.symbol,
                "currency": snapshot.currency,
                "regularMarketTime": snapshot.regular_market_time,
                "fetchedAt": snapshot.fetched_at,
                "barCount": bars.len()
            },
            "watchlists": watchlist(&snapshot, change, change_percent),
            "captures": [
                {"name": "Live Backend NVDA Snapshot", "timestamp": snapshot.fetched_at},
                {"name": "Bull Call Spread NVDA", "timestamp": "backend derived"},
                {"name": "Earnings Playbook", "timestamp": "backend derived"},
                {"name": "0DTE Gamma Fade", "timestamp": "backend derived"},
                {"name": "Meta Breakout Setup", "timestamp": "backend derived"}
            ],
            "timeframes": ["1m", "5m", "15m", "1h", "4h", "D", "W"],
            "activeTimeframe": "5m",
            "bars": bars,
            "levels": [
                {"id": "ask", "label": "Ask", "price": round2(ask), "kind": "ask"},
                {"id": "bid", "label": "Bid", "price": round2(bid), "kind": "bid"},
                {"id": "target1", "label": "Target 1", "price": round2(target_one), "kind": "target"},
                {"id": "target2", "label": "Target 2", "price": round2(target_two), "kind": "target"},
                {"id": "stop1", "label": "Stop 1", "price": round2(stop_one), "kind": "stop"},
                {"id": "invalidation", "label": "Invalidation", "price": round2(invalidation), "kind": "invalidation"}
            ],
            "markers": [
                {"label": format!("LIVE {}", price(snapshot.last)), "price": round2(snapshot.last), "x": 0.82, "kind": "buy"},
                {"label": format!("T1 {}", price(target_one)), "price": round2(target_one), "x": 0.93, "kind": "sell"},
                {"label": format!("STOP {}", price(stop_one)), "price": round2(stop_one), "x": 0.50, "kind": "stop"}
            ],
            "orderTicket": {
                "side": "Buy",
                "quantity": 4,
                "orderType": "Limit",
                "limitPrice": price(ask),
                "timeInForce": "Day",
                "account": "Paper (trader.research)",
                "quoteAge": "backend live fetch",
                "estimatedFill": format!("4 @ {}", price(ask)),
                "route": "SMART",
                "venue": "NASDAQ (ARCA)"
            },
            "risk": {
                "maxLoss": format!("$ {}", signed_price((snapshot.last - stop_one) * -4.0)),
                "maxGain": format!("$ {}", signed_price((target_one - snapshot.last) * 4.0)),
                "rewardRisk": "backend derived",
                "probability": "model pending",
                "deltaNet": "0.42",
                "thetaDaily": "-4.12",
                "buyingPower": format!("$ {}", price(snapshot.last * 4.0)),
                "marginImpact": "$ 0.00",
                "warnings": [
                    "Market data is fetched by the Rust backend at render time.",
                    "Options rows are synthetic from the live underlying until an options feed is wired.",
                    "Execution remains paper-gated."
                ]
            },
            "positions": [
                {"symbol": snapshot.symbol, "quantity": 100, "average": price(snapshot.previous_close), "last": price(snapshot.last), "pnl": signed_price(change * 100.0)}
            ],
            "orders": [
                {"id": "LIVE-001", "side": "BUY", "quantity": 4, "type": "Limit", "status": "Preview", "price": price(ask)},
                {"id": "LIVE-002", "side": "SELL", "quantity": 4, "type": "Stop", "status": "Held", "price": price(stop_one)}
            ],
            "fills": [
                {"id": "LIVE-FETCH", "side": "DATA", "quantity": bars.len(), "price": price(snapshot.last), "time": snapshot.fetched_at}
            ],
            "optionsChain": synthetic_chain,
            "diagnostics": [
                format!("Live backend source: {SOURCE_NAME}"),
                format!("Fetched at: {}", snapshot.fetched_at),
                format!("Regular market time: {}", snapshot.regular_market_time),
                format!("Live bars rendered: {}", bars.len()),
                "Rust endpoint: /v1/workbench/live"
            ]
        })
    }

    fn synthetic_options(last: f64) -> Vec<Value> {
        [-0.075, -0.05, -0.025, 0.0, 0.025, 0.05, 0.075]
            .iter()
            .enumerate()
            .map(|(index, offset)| {
                let strike = round_to_increment(last * (1.0 + offset), 5.0);
                let distance = (strike - last).abs();
                let extrinsic = (last * 0.018 - distance * 0.18).max(0.35);
                let call_bid = ((last - strike).max(0.0) + extrinsic).max(0.05);
                let put_bid = ((strike - last).max(0.0) + extrinsic).max(0.05);
                json!({
                    "strike": price(strike),
                    "callBid": price(call_bid),
                    "callAsk": price(call_bid + 0.08),
                    "callDelta": format!("{:.2}", (0.82 - index as f64 * 0.11).clamp(0.12, 0.88)),
                    "putBid": price(put_bid),
                    "putAsk": price(put_bid + 0.08),
                    "putDelta": format!("{:.2}", (-0.18 - index as f64 * 0.11).clamp(-0.88, -0.12)),
                    "iv": format!("{:.1}%", 34.0 + index as f64 * 1.7)
                })
            })
            .collect()
    }

    fn watchlist(snapshot: &LiveSnapshot, change: f64, change_percent: f64) -> Vec<Value> {
        let mut values = vec![json!({
            "symbol": snapshot.symbol,
            "name": snapshot.company,
            "last": price(snapshot.last),
            "change": signed_price(change),
            "changePercent": signed_percent(change_percent),
            "isPositive": change >= 0.0
        })];
        values.extend(
            [
                ("AAPL", "Apple Inc.", "214.10", "+0.42", "+0.20%"),
                ("MSFT", "Microsoft Corp.", "497.45", "-1.32", "-0.26%"),
                ("AMZN", "Amazon.com, Inc.", "219.31", "+0.15", "+0.07%"),
                ("GOOGL", "Alphabet Inc.", "178.68", "-0.72", "-0.40%"),
                ("META", "Meta Platforms", "743.07", "+3.05", "+0.41%"),
                ("TSLA", "Tesla, Inc.", "318.83", "-2.28", "-0.71%"),
                ("AMD", "AMD", "161.18", "+2.15", "+1.35%"),
                ("AVGO", "Broadcom Inc.", "269.24", "+1.26", "+0.47%"),
            ]
            .into_iter()
            .map(|(symbol, name, last, change, percent)| {
                json!({
                    "symbol": symbol,
                    "name": name,
                    "last": last,
                    "change": change,
                    "changePercent": percent,
                    "isPositive": !change.starts_with('-')
                })
            }),
        );
        values
    }

    fn array_at<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>, LiveWorkbenchError> {
        value
            .get(key)
            .and_then(Value::as_array)
            .ok_or_else(|| LiveWorkbenchError {
                code: "livePayloadMissing",
                message: format!("{SOURCE_NAME} response did not include {key} bars."),
            })
    }

    fn numeric(value: &Value) -> Option<f64> {
        value.as_f64().filter(|number| number.is_finite())
    }

    fn number_at(value: &Value, key: &str) -> Option<f64> {
        value.get(key).and_then(numeric)
    }

    fn string_at(value: &Value, key: &str) -> Option<String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(ToString::to_string)
    }

    fn unix_to_rfc3339(seconds: i64) -> Option<String> {
        OffsetDateTime::from_unix_timestamp(seconds)
            .ok()?
            .format(&Rfc3339)
            .ok()
    }

    fn sanitize_symbol(raw: &str) -> String {
        let symbol = raw
            .chars()
            .filter(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '^')
            })
            .collect::<String>()
            .to_ascii_uppercase();
        if symbol.is_empty() {
            DEFAULT_SYMBOL.to_string()
        } else {
            symbol
        }
    }

    fn round0(value: f64) -> u64 {
        value.max(0.0).round() as u64
    }

    fn round2(value: f64) -> f64 {
        (value * 100.0).round() / 100.0
    }

    fn round4(value: f64) -> f64 {
        (value * 10_000.0).round() / 10_000.0
    }

    fn round_to_increment(value: f64, increment: f64) -> f64 {
        (value / increment).round() * increment
    }

    fn price(value: f64) -> String {
        format!("{:.2}", round2(value))
    }

    fn signed_price(value: f64) -> String {
        format!("{:+.2}", round2(value))
    }

    fn signed_percent(value: f64) -> String {
        format!("{:+.2}%", round2(value))
    }

    fn compact_volume(value: f64) -> String {
        if value >= 1_000_000_000.0 {
            format!("{:.2}B", value / 1_000_000_000.0)
        } else if value >= 1_000_000.0 {
            format!("{:.2}M", value / 1_000_000.0)
        } else if value >= 1_000.0 {
            format!("{:.2}K", value / 1_000.0)
        } else {
            round0(value).to_string()
        }
    }
}

pub mod http_interface {
    use crate::{
        adapter_contract::{
            capabilities, disconnected_failure, failure_event, invalid_event_subscription_failure,
            rejected_order_failure, runtime_preflight, AdapterFailure,
        },
        broker_callback_router, broker_protocol,
        broker_read_model::{AccountStateStore, PAPER_ACCOUNT_ID},
        event_hub::EventHub,
        live_workbench,
        market_read_model::{MarketDataStore, MarketDataStreamKind, MarketDataSubscriptionStore},
        operation_ledger::{LedgerDecisionKind, OperationLedger},
        order_routing,
        runtime_state::BrokerSessionSnapshot,
        tws_transport, tws_wire,
    };
    use axum::{
        body::Bytes,
        extract::{
            ws::{Message, WebSocket, WebSocketUpgrade},
            Path, Query, State,
        },
        http::{HeaderMap, Method, StatusCode, Uri},
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use serde::Deserialize;
    use serde_json::json;
    use std::{collections::HashSet, net::SocketAddr};

    #[derive(Clone, Debug)]
    pub struct AppState {
        pub event_hub: EventHub,
        pub operation_ledger: OperationLedger,
        pub broker_session: BrokerSessionSnapshot,
        pub account_state: AccountStateStore,
        pub market_state: MarketDataStore,
        pub market_subscriptions: MarketDataSubscriptionStore,
        pub order_routing_state: order_routing::OrderRoutingCallbackStore,
    }

    impl Default for AppState {
        fn default() -> Self {
            Self {
                event_hub: EventHub::default(),
                operation_ledger: OperationLedger::default(),
                broker_session: BrokerSessionSnapshot::disconnected(
                    crate::adapter_contract::default_endpoint(),
                ),
                account_state: AccountStateStore::default(),
                market_state: MarketDataStore::default(),
                market_subscriptions: MarketDataSubscriptionStore::default(),
                order_routing_state: order_routing::OrderRoutingCallbackStore::default(),
            }
        }
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ContractResolveQuery {
        symbol: Option<String>,
        security_type: Option<String>,
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UnderlyingContractQuery {
        symbol: Option<String>,
        exchange: Option<String>,
        primary_exchange: Option<String>,
        currency: Option<String>,
        local_symbol: Option<String>,
        trading_class: Option<String>,
        timezone_identifier: Option<String>,
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OptionContractQuery {
        #[serde(rename = "underlyingConID")]
        underlying_con_id: Option<String>,
        symbol: Option<String>,
        expiration: Option<String>,
        strike: Option<String>,
        right: Option<String>,
        exchange: Option<String>,
        currency: Option<String>,
        trading_class: Option<String>,
        multiplier: Option<String>,
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoricalBarsQuery {
        timeframe: Option<String>,
        bar_limit: Option<String>,
        duration: Option<String>,
        what_to_show: Option<String>,
        regular_trading_hours_only: Option<String>,
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoricalTicksQuery {
        start_date_time: Option<String>,
        end_date_time: Option<String>,
        number_of_ticks: Option<String>,
        what_to_show: Option<String>,
        regular_trading_hours_only: Option<String>,
        ignore_size: Option<String>,
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LiveWorkbenchQuery {
        symbol: Option<String>,
    }

    impl AppState {
        pub fn with_broker_session(broker_session: BrokerSessionSnapshot) -> Self {
            let state = Self {
                broker_session,
                ..Self::default()
            };
            state
                .event_hub
                .record(crate::adapter_contract::event_envelope(
                    "connection.status",
                    json!(state.broker_session.status()),
                ));
            state
        }

        pub fn connected_fixture() -> Self {
            let state = Self::with_broker_session(broker_protocol::connected_fixture_session(
                crate::adapter_contract::default_endpoint(),
            ));
            for event in state.account_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            for event in state.market_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            state
        }

        pub async fn tcp_startup_fixture() -> Result<Self, tws_transport::TwsTransportError> {
            let evidence = tws_transport::deterministic_tcp_startup_evidence(
                crate::adapter_contract::default_endpoint(),
            )
            .await?;
            let state = Self::with_broker_session(evidence.transcript.session);
            for event in state.account_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            for event in state.market_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            Ok(state)
        }

        pub async fn broker_startup(
            config: tws_transport::TwsBrokerStartupConfig,
        ) -> Result<Self, tws_transport::TwsTransportError> {
            let evidence = tws_transport::run_configured_startup(config).await?;
            let state = Self::with_broker_session(evidence.transcript.session);
            for event in state.account_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            for event in state.market_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            Ok(state)
        }

        pub fn live_connected_fixture() -> Self {
            let endpoint = crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7496,
                client_id: 52,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            };
            let mut state =
                Self::with_broker_session(broker_protocol::connected_fixture_session(endpoint));
            state.account_state = AccountStateStore::default();
            state.market_state = MarketDataStore::default();
            for event in state.account_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            for event in state.market_state.snapshot().event_transcript {
                state.event_hub.record(event);
            }
            state
        }

        pub fn record_tws_callback(
            &mut self,
            callback: &tws_wire::TwsCallback,
        ) -> Option<broker_callback_router::BrokerCallbackRouteOutcome> {
            callback
                .to_broker_callback()
                .map(|callback| self.record_broker_callback(callback))
        }

        pub fn record_broker_callback(
            &mut self,
            callback: broker_callback_router::BrokerCallback,
        ) -> broker_callback_router::BrokerCallbackRouteOutcome {
            let (route, published_events) = match callback {
                broker_callback_router::BrokerCallback::Protocol { event } => {
                    let mut session = broker_protocol::BrokerSessionManager::from_snapshot(
                        self.broker_session.clone(),
                    );
                    session.apply(event);
                    self.broker_session = session.snapshot();
                    ("protocol".to_string(), vec![session.connection_event()])
                }
                broker_callback_router::BrokerCallback::Account { callback } => {
                    ("account".to_string(), self.account_state.record(callback))
                }
                broker_callback_router::BrokerCallback::MarketData { callback } => {
                    ("marketData".to_string(), self.market_state.record(callback))
                }
                broker_callback_router::BrokerCallback::OrderRouting { callback } => (
                    "orderRouting".to_string(),
                    self.order_routing_state.record(callback),
                ),
            };

            for event in &published_events {
                self.event_hub.record(event.clone());
            }

            broker_callback_router::BrokerCallbackRouteOutcome {
                route,
                published_event_names: published_events
                    .iter()
                    .map(|event| event.event.clone())
                    .collect(),
                published_events,
                session: self.broker_session.clone(),
            }
        }
    }

    pub fn router() -> Router {
        router_with_state(AppState::default())
    }

    pub fn router_with_state(state: AppState) -> Router {
        Router::new()
            .route("/v1/status", get(status))
            .route("/v1/runtime/preflight", get(preflight))
            .route("/v1/capabilities", get(capability_manifest))
            .route("/v1/workbench/live", get(live_workbench_view))
            .route("/v1/events", get(events))
            .route("/v1/accounts", get(accounts))
            .route("/v1/accounts/{account_id}/summary", get(account_summary))
            .route(
                "/v1/accounts/{account_id}/positions",
                get(account_positions),
            )
            .route("/v1/accounts/{account_id}/orders/open", get(open_orders))
            .route(
                "/v1/accounts/{account_id}/orders/completed",
                get(completed_orders),
            )
            .route("/v1/accounts/{account_id}/fills", get(fills))
            .route("/v1/contracts/resolve", get(resolve_contract))
            .route("/v1/market-rules/{market_rule_id}", get(market_rule))
            .route("/v1/quotes/{con_id}", get(quote))
            .route(
                "/v1/quotes/{con_id}/subscribe",
                post(subscribe_quote).delete(unsubscribe_quote),
            )
            .route("/v1/bars/{con_id}", get(bars))
            .route("/v1/ticks/{con_id}", get(ticks))
            .route(
                "/v1/bars/{con_id}/stream",
                post(start_bar_stream).delete(stop_bar_stream),
            )
            .route("/v1/options/chains/{underlying_con_id}", get(option_chain))
            .route(
                "/v1/options/contracts/resolve",
                get(resolve_option_contract),
            )
            .route(
                "/v1/options/contracts/{con_id}/details",
                get(option_details),
            )
            .route("/v1/options/quotes/{con_id}", get(option_quote))
            .route("/v1/options/exercise", post(option_exercise))
            .route("/v1/orders/preview", post(preview_order))
            .route("/v1/orders/paper", post(place_paper_order))
            .route("/v1/orders/live", post(place_live_order))
            .route("/v1/orders/{broker_order_id}/modify", post(modify_order))
            .route("/v1/orders/{broker_order_id}/cancel", post(cancel_order))
            .route("/v1/orders/global-cancel", post(global_cancel))
            .fallback(not_found)
            .with_state(state)
    }

    pub async fn serve(addr: SocketAddr) -> std::io::Result<()> {
        serve_with_state(addr, AppState::default()).await
    }

    pub async fn serve_with_state(addr: SocketAddr, state: AppState) -> std::io::Result<()> {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        tracing::info!(%addr, "starting Rust local broker adapter");
        axum::serve(listener, router_with_state(state)).await
    }

    async fn status(State(state): State<AppState>) -> impl IntoResponse {
        Json(state.broker_session.status())
    }

    async fn preflight() -> impl IntoResponse {
        Json(runtime_preflight())
    }

    async fn capability_manifest() -> impl IntoResponse {
        Json(capabilities())
    }

    async fn live_workbench_view(Query(query): Query<LiveWorkbenchQuery>) -> impl IntoResponse {
        match live_workbench::fetch_live_workbench(query.symbol.as_deref()).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => (
                StatusCode::BAD_GATEWAY,
                Json(AdapterFailure {
                    code: error.code.to_string(),
                    message: error.message,
                    request_id: Some("GET /v1/workbench/live".to_string()),
                    retry_after_seconds: Some(30),
                }),
            )
                .into_response(),
        }
    }

    async fn accounts(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(&state, &headers, "GET /v1/accounts") {
            return response;
        }
        Json(state.account_state.snapshot().accounts).into_response()
    }

    async fn account_summary(
        State(state): State<AppState>,
        Path(account_id): Path<String>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/accounts/{account_id}/summary"),
        ) {
            return response;
        }
        let account_state = state.account_state.snapshot();
        let Some(summary) = account_state.summary_for_account(&account_id) else {
            return account_not_found_response(&account_id);
        };
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "account.summary",
                json!(summary),
            ));
        Json(summary).into_response()
    }

    async fn account_positions(
        State(state): State<AppState>,
        Path(account_id): Path<String>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/accounts/{account_id}/positions"),
        ) {
            return response;
        }
        let positions = state
            .account_state
            .snapshot()
            .positions_for_account(&account_id);
        if account_id != PAPER_ACCOUNT_ID && positions.is_empty() {
            return account_not_found_response(&account_id);
        }
        for position in &positions {
            state
                .event_hub
                .record(crate::adapter_contract::event_envelope(
                    "position.snapshot",
                    json!(position),
                ));
        }
        Json(positions).into_response()
    }

    async fn open_orders(
        State(state): State<AppState>,
        Path(account_id): Path<String>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/accounts/{account_id}/orders/open"),
        ) {
            return response;
        }
        Json(
            state
                .account_state
                .snapshot()
                .open_orders_for_account(&account_id),
        )
        .into_response()
    }

    async fn completed_orders(
        State(state): State<AppState>,
        Path(account_id): Path<String>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/accounts/{account_id}/orders/completed"),
        ) {
            return response;
        }
        Json(
            state
                .account_state
                .snapshot()
                .completed_orders_for_account(&account_id),
        )
        .into_response()
    }

    async fn fills(
        State(state): State<AppState>,
        Path(account_id): Path<String>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/accounts/{account_id}/fills"),
        ) {
            return response;
        }
        let fills = state
            .account_state
            .snapshot()
            .fills_for_account(&account_id);
        for fill in &fills {
            state
                .event_hub
                .record(crate::adapter_contract::event_envelope(
                    "fill.report",
                    json!(fill),
                ));
        }
        Json(fills).into_response()
    }

    async fn resolve_contract(
        State(state): State<AppState>,
        Query(query): Query<ContractResolveQuery>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) =
            broker_not_ready_response(&state, &headers, "GET /v1/contracts/resolve")
        {
            return response;
        }
        let details = state.market_state.snapshot().stock_details;
        if let Err(message) = validate_contract_resolve_query(&query, &details) {
            return bad_request_failure_response(
                "invalidContract",
                message,
                request_id(&headers).or_else(|| Some("GET /v1/contracts/resolve".to_string())),
            );
        }
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "contract.details",
                json!(details),
            ));
        Json(details).into_response()
    }

    async fn market_rule(
        State(state): State<AppState>,
        Path(market_rule_id): Path<String>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/market-rules/{market_rule_id}"),
        ) {
            return response;
        }
        let Some(rule) = state.market_state.snapshot().market_rule(&market_rule_id) else {
            return not_found_failure_response(
                "invalidContract",
                &format!("No market rule exists for id {market_rule_id}."),
                &format!("marketRule {market_rule_id}"),
            );
        };
        Json(rule).into_response()
    }

    async fn quote(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) =
            broker_not_ready_response(&state, &headers, &format!("GET /v1/quotes/{con_id}"))
        {
            return response;
        }
        let Some(quote) = state.market_state.snapshot().quote_for_con_id(con_id) else {
            return contract_not_found_response(con_id);
        };
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "quote.snapshot",
                json!(quote),
            ));
        Json(quote).into_response()
    }

    async fn subscribe_quote(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        subscribe_market_stream(
            state,
            con_id,
            MarketDataStreamKind::Quote,
            "POST",
            &format!("/v1/quotes/{con_id}/subscribe"),
            headers,
            body,
        )
        .await
    }

    async fn unsubscribe_quote(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        unsubscribe_market_stream(
            state,
            con_id,
            MarketDataStreamKind::Quote,
            "DELETE",
            &format!("/v1/quotes/{con_id}/subscribe"),
            headers,
            body,
        )
        .await
    }

    async fn bars(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        Query(query): Query<HistoricalBarsQuery>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) =
            broker_not_ready_response(&state, &headers, &format!("GET /v1/bars/{con_id}"))
        {
            return response;
        }
        let Some(bars) = state.market_state.snapshot().bars_for_con_id(con_id) else {
            return contract_not_found_response(con_id);
        };
        let bars = match historical_bars_for_query(bars, &query) {
            Ok(bars) => bars,
            Err(message) => {
                return bad_request_failure_response(
                    "invalidContract",
                    message,
                    request_id(&headers).or_else(|| Some(format!("GET /v1/bars/{con_id}"))),
                );
            }
        };
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "bars.snapshot",
                json!(bars),
            ));
        Json(bars).into_response()
    }

    async fn start_bar_stream(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        subscribe_market_stream(
            state,
            con_id,
            MarketDataStreamKind::Bars,
            "POST",
            &format!("/v1/bars/{con_id}/stream"),
            headers,
            body,
        )
        .await
    }

    async fn stop_bar_stream(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        unsubscribe_market_stream(
            state,
            con_id,
            MarketDataStreamKind::Bars,
            "DELETE",
            &format!("/v1/bars/{con_id}/stream"),
            headers,
            body,
        )
        .await
    }

    async fn ticks(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        Query(query): Query<HistoricalTicksQuery>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) =
            broker_not_ready_response(&state, &headers, &format!("GET /v1/ticks/{con_id}"))
        {
            return response;
        }
        let Some(ticks) = state.market_state.snapshot().ticks_for_con_id(con_id) else {
            return contract_not_found_response(con_id);
        };
        let ticks = match historical_ticks_for_query(ticks, &query) {
            Ok(ticks) => ticks,
            Err(message) => {
                return bad_request_failure_response(
                    "invalidContract",
                    message,
                    request_id(&headers).or_else(|| Some(format!("GET /v1/ticks/{con_id}"))),
                );
            }
        };
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "ticks.snapshot",
                json!(ticks),
            ));
        Json(ticks).into_response()
    }

    async fn option_chain(
        State(state): State<AppState>,
        Path(underlying_con_id): Path<i64>,
        Query(query): Query<UnderlyingContractQuery>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/options/chains/{underlying_con_id}"),
        ) {
            return response;
        }
        let Some(chain) = state
            .market_state
            .snapshot()
            .option_chain_for_underlying(underlying_con_id)
        else {
            return contract_not_found_response(underlying_con_id);
        };
        if let Err(message) = validate_underlying_contract_query(&query, &chain.underlying) {
            return bad_request_failure_response(
                "invalidContract",
                message,
                request_id(&headers)
                    .or_else(|| Some(format!("GET /v1/options/chains/{underlying_con_id}"))),
            );
        }
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "option.chain",
                json!(chain),
            ));
        Json(chain).into_response()
    }

    async fn resolve_option_contract(
        State(state): State<AppState>,
        Query(query): Query<OptionContractQuery>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) =
            broker_not_ready_response(&state, &headers, "GET /v1/options/contracts/resolve")
        {
            return response;
        }
        let option = state.market_state.snapshot().option_contract;
        if let Err(message) = validate_option_contract_query(&query, &option) {
            return bad_request_failure_response(
                "invalidContract",
                message,
                request_id(&headers)
                    .or_else(|| Some("GET /v1/options/contracts/resolve".to_string())),
            );
        }
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "option.contract",
                json!(option),
            ));
        Json(option).into_response()
    }

    async fn option_details(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        Query(query): Query<OptionContractQuery>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/options/contracts/{con_id}/details"),
        ) {
            return response;
        }
        let market_snapshot = state.market_state.snapshot();
        let Some(details) = market_snapshot.details_for_con_id(con_id) else {
            return contract_not_found_response(con_id);
        };
        let option = market_snapshot.option_contract;
        if con_id != option.contract.con_id {
            return contract_not_found_response(con_id);
        }
        if let Err(message) = validate_option_contract_query(&query, &option) {
            return bad_request_failure_response(
                "invalidContract",
                message,
                request_id(&headers)
                    .or_else(|| Some(format!("GET /v1/options/contracts/{con_id}/details"))),
            );
        }
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "option.contract-details",
                json!(details),
            ));
        Json(details).into_response()
    }

    async fn option_quote(
        State(state): State<AppState>,
        Path(con_id): Path<i64>,
        Query(query): Query<OptionContractQuery>,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("GET /v1/options/quotes/{con_id}"),
        ) {
            return response;
        }
        let Some(quote) = state
            .market_state
            .snapshot()
            .option_quote_for_con_id(con_id)
        else {
            return contract_not_found_response(con_id);
        };
        if let Err(message) = validate_option_contract_query(&query, &quote.contract) {
            return bad_request_failure_response(
                "invalidContract",
                message,
                request_id(&headers).or_else(|| Some(format!("GET /v1/options/quotes/{con_id}"))),
            );
        }
        state
            .event_hub
            .record(crate::adapter_contract::event_envelope(
                "option.quote",
                json!(quote),
            ));
        Json(quote).into_response()
    }

    async fn preview_order(
        State(state): State<AppState>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        let ledger =
            match command_ledger_decision(&state, "POST", "/v1/orders/preview", &headers, &body) {
                Ok(ledger) => ledger,
                Err(response) => return *response,
            };
        if let Some(response) =
            broker_not_ready_response(&state, &headers, "POST /v1/orders/preview")
        {
            return response;
        }
        let body = match parse_body_json(&body, request_id(&headers)) {
            Ok(body) => body,
            Err(response) => return *response,
        };
        match order_routing::preview_from_mapped_order(&body, request_id(&headers).as_deref()) {
            Ok(mut preview) => {
                if ledger == LedgerDecisionKind::Replayed {
                    preview
                        .required_confirmations
                        .push("duplicate-preview-reused".to_string());
                }
                record_routing_callback(
                    &state,
                    order_routing::OrderRoutingCallback::Preview {
                        preview: Box::new(preview.clone()),
                    },
                );
                Json(preview).into_response()
            }
            Err(message) => rejected_response(message, request_id(&headers)),
        }
    }

    async fn place_paper_order(
        State(state): State<AppState>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        let ledger =
            match command_ledger_decision(&state, "POST", "/v1/orders/paper", &headers, &body) {
                Ok(ledger) => ledger,
                Err(response) => return *response,
            };
        if let Some(response) = broker_not_ready_response(&state, &headers, "POST /v1/orders/paper")
        {
            return response;
        }
        if let Some(response) = broker_environment_response(
            &state,
            crate::adapter_contract::BrokerEnvironment::IbkrPaper,
            request_id(&headers),
        ) {
            return response;
        }
        let body = match parse_body_json(&body, request_id(&headers)) {
            Ok(body) => body,
            Err(response) => return *response,
        };
        match order_routing::paper_acknowledgement(
            &body,
            request_id(&headers).as_deref(),
            ledger == LedgerDecisionKind::Replayed,
        ) {
            Ok(acknowledgement) => {
                record_routing_callback(
                    &state,
                    order_routing::OrderRoutingCallback::PlacementAcknowledgement {
                        acknowledgement: Box::new(acknowledgement.clone()),
                    },
                );
                (StatusCode::ACCEPTED, Json(acknowledgement)).into_response()
            }
            Err(message) => rejected_response(message, request_id(&headers)),
        }
    }

    async fn place_live_order(
        State(state): State<AppState>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        let ledger =
            match command_ledger_decision(&state, "POST", "/v1/orders/live", &headers, &body) {
                Ok(ledger) => ledger,
                Err(response) => return *response,
            };
        if let Some(response) = broker_not_ready_response(&state, &headers, "POST /v1/orders/live")
        {
            return response;
        }
        if let Some(response) = broker_environment_response(
            &state,
            crate::adapter_contract::BrokerEnvironment::IbkrLive,
            request_id(&headers),
        ) {
            return response;
        }
        let body = match parse_body_json(&body, request_id(&headers)) {
            Ok(body) => body,
            Err(response) => return *response,
        };
        match order_routing::live_acknowledgement(
            &body,
            request_id(&headers).as_deref(),
            ledger == LedgerDecisionKind::Replayed,
        ) {
            Ok(acknowledgement) => {
                record_routing_callback(
                    &state,
                    order_routing::OrderRoutingCallback::PlacementAcknowledgement {
                        acknowledgement: Box::new(acknowledgement.clone()),
                    },
                );
                (StatusCode::ACCEPTED, Json(acknowledgement)).into_response()
            }
            Err(message) => rejected_response(message, request_id(&headers)),
        }
    }

    async fn modify_order(
        State(state): State<AppState>,
        Path(broker_order_id): Path<String>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        let ledger = match command_ledger_decision(
            &state,
            "POST",
            &format!("/v1/orders/{broker_order_id}/modify"),
            &headers,
            &body,
        ) {
            Ok(ledger) => ledger,
            Err(response) => return *response,
        };
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("POST /v1/orders/{broker_order_id}/modify"),
        ) {
            return response;
        }
        let body = match parse_body_json(&body, request_id(&headers)) {
            Ok(body) => body,
            Err(response) => return *response,
        };
        match order_routing::modification_acknowledgement(
            &body,
            request_id(&headers).as_deref(),
            &broker_order_id,
            ledger == LedgerDecisionKind::Replayed,
        ) {
            Ok(acknowledgement) => {
                record_routing_callback(
                    &state,
                    order_routing::OrderRoutingCallback::ModificationAcknowledgement {
                        acknowledgement: Box::new(acknowledgement.clone()),
                    },
                );
                (StatusCode::ACCEPTED, Json(acknowledgement)).into_response()
            }
            Err(message) => rejected_response(message, request_id(&headers)),
        }
    }

    async fn cancel_order(
        State(state): State<AppState>,
        Path(broker_order_id): Path<String>,
        Query(query): Query<CancelOrderQuery>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        if let Err(response) = command_ledger_decision(
            &state,
            "POST",
            &format!("/v1/orders/{broker_order_id}/cancel"),
            &headers,
            &body,
        ) {
            return *response;
        }
        if let Some(response) = broker_not_ready_response(
            &state,
            &headers,
            &format!("POST /v1/orders/{broker_order_id}/cancel"),
        ) {
            return response;
        }
        let Some(account_id) = query.account_id.filter(|value| !value.trim().is_empty()) else {
            return rejected_response(
                "Cancel requests must include accountID so broker order cancellation is account-scoped.",
                request_id(&headers),
            );
        };
        let Some(status) = state
            .account_state
            .snapshot()
            .open_orders
            .iter()
            .find(|order| {
                order.broker_order_id == broker_order_id && order.account_id == account_id
            })
            .cloned()
        else {
            return not_found_failure_response(
                "orderNotFound",
                &format!(
                    "No open order exists for broker order id {broker_order_id} in account {account_id}."
                ),
                &format!("{account_id}:{broker_order_id}"),
            );
        };
        let response = order_routing::cancel_response(status);
        record_routing_callback(
            &state,
            order_routing::OrderRoutingCallback::CancelResponse {
                response: Box::new(response.clone()),
            },
        );
        Json(response).into_response()
    }

    #[derive(Debug, Deserialize)]
    struct CancelOrderQuery {
        #[serde(rename = "accountID")]
        account_id: Option<String>,
    }

    async fn global_cancel(
        State(state): State<AppState>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        if let Err(response) =
            command_ledger_decision(&state, "POST", "/v1/orders/global-cancel", &headers, &body)
        {
            return *response;
        }
        if let Some(response) =
            broker_not_ready_response(&state, &headers, "POST /v1/orders/global-cancel")
        {
            return response;
        }
        if let Some(response) = broker_environment_response(
            &state,
            crate::adapter_contract::BrokerEnvironment::IbkrPaper,
            request_id(&headers),
        ) {
            return response;
        }
        let body = match parse_body_json(&body, request_id(&headers)) {
            Ok(body) => body,
            Err(response) => return *response,
        };
        match order_routing::global_cancel_acknowledgement(&body) {
            Ok(acknowledgement) => {
                record_routing_callback(
                    &state,
                    order_routing::OrderRoutingCallback::GlobalCancelAcknowledgement {
                        acknowledgement: Box::new(acknowledgement.clone()),
                    },
                );
                (StatusCode::ACCEPTED, Json(acknowledgement)).into_response()
            }
            Err(message) => rejected_response(message, request_id(&headers)),
        }
    }

    async fn option_exercise(
        State(state): State<AppState>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        let ledger = match command_ledger_decision(
            &state,
            "POST",
            "/v1/options/exercise",
            &headers,
            &body,
        ) {
            Ok(ledger) => ledger,
            Err(response) => return *response,
        };
        if let Some(response) =
            broker_not_ready_response(&state, &headers, "POST /v1/options/exercise")
        {
            return response;
        }
        let body = match parse_body_json(&body, request_id(&headers)) {
            Ok(body) => body,
            Err(response) => return *response,
        };
        match order_routing::option_exercise_acknowledgement(
            &body,
            request_id(&headers).as_deref(),
            &state.account_state.snapshot().positions,
            ledger == LedgerDecisionKind::Replayed,
        ) {
            Ok(acknowledgement) => {
                record_routing_callback(
                    &state,
                    order_routing::OrderRoutingCallback::OptionExerciseAcknowledgement {
                        acknowledgement: Box::new(acknowledgement.clone()),
                    },
                );
                (StatusCode::ACCEPTED, Json(acknowledgement)).into_response()
            }
            Err(message) => rejected_response(message, request_id(&headers)),
        }
    }

    fn record_routing_callback(state: &AppState, callback: order_routing::OrderRoutingCallback) {
        for event in state.order_routing_state.record(callback) {
            state.event_hub.record(event);
        }
    }

    async fn subscribe_market_stream(
        state: AppState,
        con_id: i64,
        stream: MarketDataStreamKind,
        method: &str,
        path: &str,
        headers: HeaderMap,
        body: Bytes,
    ) -> axum::response::Response {
        if let Err(response) = command_ledger_decision(&state, method, path, &headers, &body) {
            return *response;
        }
        if let Some(response) =
            broker_not_ready_response(&state, &headers, &format!("{method} {path}"))
        {
            return response;
        }
        let Some(event) = market_subscription_snapshot_event(&state, stream, con_id) else {
            return contract_not_found_response(con_id);
        };
        state.event_hub.record(event.clone());
        let acknowledgement = state.market_subscriptions.subscribe(stream, con_id, 1);
        match stream {
            MarketDataStreamKind::Quote => Json(event.payload).into_response(),
            MarketDataStreamKind::Bars => Json(acknowledgement).into_response(),
        }
    }

    async fn unsubscribe_market_stream(
        state: AppState,
        con_id: i64,
        stream: MarketDataStreamKind,
        method: &str,
        path: &str,
        headers: HeaderMap,
        body: Bytes,
    ) -> axum::response::Response {
        if let Err(response) = command_ledger_decision(&state, method, path, &headers, &body) {
            return *response;
        }
        if let Some(response) =
            broker_not_ready_response(&state, &headers, &format!("{method} {path}"))
        {
            return response;
        }
        if market_subscription_snapshot_event(&state, stream, con_id).is_none() {
            return contract_not_found_response(con_id);
        }
        let acknowledgement = state.market_subscriptions.unsubscribe(stream, con_id);
        match stream {
            MarketDataStreamKind::Quote => Json(state.broker_session.status()).into_response(),
            MarketDataStreamKind::Bars => Json(acknowledgement).into_response(),
        }
    }

    fn market_subscription_snapshot_event(
        state: &AppState,
        stream: MarketDataStreamKind,
        con_id: i64,
    ) -> Option<crate::adapter_contract::EventEnvelope> {
        let market_state = state.market_state.snapshot();
        match stream {
            MarketDataStreamKind::Quote => market_state.quote_for_con_id(con_id).map(|quote| {
                crate::adapter_contract::event_envelope("quote.snapshot", json!(quote))
            }),
            MarketDataStreamKind::Bars => market_state
                .bars_for_con_id(con_id)
                .map(|bars| crate::adapter_contract::event_envelope("bars.snapshot", json!(bars))),
        }
    }

    fn broker_not_ready_response(
        state: &AppState,
        headers: &HeaderMap,
        fallback_request_id: &str,
    ) -> Option<axum::response::Response> {
        if state.broker_session.is_ready() {
            return None;
        }
        let failure = disconnected_failure(
            request_id(headers).or_else(|| Some(fallback_request_id.to_string())),
        );
        state.event_hub.record(failure_event(failure.clone()));
        Some((StatusCode::SERVICE_UNAVAILABLE, Json(failure)).into_response())
    }

    fn broker_environment_response(
        state: &AppState,
        expected_environment: crate::adapter_contract::BrokerEnvironment,
        request_id: Option<String>,
    ) -> Option<axum::response::Response> {
        if state.broker_session.endpoint.environment == expected_environment {
            return None;
        }
        let failure = rejected_order_failure(
            format!(
                "Broker session environment is {}; route requires {}.",
                order_routing::environment_wire_value(state.broker_session.endpoint.environment),
                order_routing::environment_wire_value(expected_environment)
            ),
            request_id,
        );
        state.event_hub.record(failure_event(failure.clone()));
        Some((StatusCode::BAD_REQUEST, Json(failure)).into_response())
    }

    fn command_ledger_decision(
        state: &AppState,
        method: &str,
        path: &str,
        headers: &HeaderMap,
        body: &Bytes,
    ) -> Result<LedgerDecisionKind, Box<axum::response::Response>> {
        let failure_request_id =
            request_id(headers).or_else(|| Some(format!("{} {}", method, path)));
        let Some(decision) = state.operation_ledger.record(
            method,
            path,
            request_id(headers),
            failure_request_id
                .clone()
                .unwrap_or_else(|| format!("{} {}", method, path)),
            body,
        ) else {
            return Ok(LedgerDecisionKind::Accepted);
        };
        if decision.should_return_rejected_order {
            let failure = rejected_order_failure(
                match decision.receipt.decision {
                    LedgerDecisionKind::RejectedMissingIdempotencyKey => {
                        "Broker-facing command requires a non-empty Idempotency-Key before broker access."
                    }
                    LedgerDecisionKind::RejectedIdempotencyMismatch => {
                        "Idempotency-Key reuse with a different request body is rejected before broker access."
                    }
                    _ => "Broker-facing command was rejected before broker access.",
                },
                Some(decision.receipt.request_id),
            );
            state.event_hub.record(failure_event(failure.clone()));
            return Err(Box::new(
                (StatusCode::BAD_REQUEST, Json(failure)).into_response(),
            ));
        }
        Ok(decision.receipt.decision)
    }

    fn parse_body_json(
        body: &Bytes,
        request_id: Option<String>,
    ) -> Result<serde_json::Value, Box<axum::response::Response>> {
        serde_json::from_slice::<serde_json::Value>(body).map_err(|error| {
            let failure = rejected_order_failure(
                format!("Request body must be valid JSON: {error}"),
                request_id,
            );
            Box::new((StatusCode::BAD_REQUEST, Json(failure)).into_response())
        })
    }

    fn rejected_response(
        message: impl Into<String>,
        request_id: Option<String>,
    ) -> axum::response::Response {
        let failure = rejected_order_failure(message, request_id);
        (StatusCode::BAD_REQUEST, Json(failure)).into_response()
    }

    fn bad_request_failure_response(
        code: &str,
        message: impl Into<String>,
        request_id: Option<String>,
    ) -> axum::response::Response {
        let failure = AdapterFailure {
            code: code.to_string(),
            message: message.into(),
            request_id,
            retry_after_seconds: None,
        };
        (StatusCode::BAD_REQUEST, Json(failure)).into_response()
    }

    fn validate_contract_resolve_query(
        query: &ContractResolveQuery,
        details: &crate::market_read_model::ContractDetails,
    ) -> Result<(), String> {
        require_wire_match(
            "symbol",
            required_query_value(&query.symbol, "symbol")?,
            &details.contract.symbol,
        )?;
        require_wire_match(
            "securityType",
            required_query_value(&query.security_type, "securityType")?,
            &details.contract.security_type,
        )
    }

    fn validate_underlying_contract_query(
        query: &UnderlyingContractQuery,
        contract: &crate::market_read_model::ContractIdentity,
    ) -> Result<(), String> {
        require_wire_match(
            "symbol",
            required_query_value(&query.symbol, "symbol")?,
            &contract.symbol,
        )?;
        require_wire_match(
            "exchange",
            required_query_value(&query.exchange, "exchange")?,
            &contract.exchange,
        )?;
        require_wire_match(
            "currency",
            required_query_value(&query.currency, "currency")?,
            &contract.currency,
        )?;
        require_optional_wire_match(
            "primaryExchange",
            &query.primary_exchange,
            contract.primary_exchange.as_deref(),
        )?;
        require_optional_wire_match(
            "localSymbol",
            &query.local_symbol,
            contract.local_symbol.as_deref(),
        )?;
        require_optional_wire_match(
            "tradingClass",
            &query.trading_class,
            contract.trading_class.as_deref(),
        )?;
        require_optional_exact_match(
            "timezoneIdentifier",
            &query.timezone_identifier,
            contract.timezone_identifier.as_deref(),
        )
    }

    fn validate_option_contract_query(
        query: &OptionContractQuery,
        contract: &crate::market_read_model::OptionContract,
    ) -> Result<(), String> {
        let underlying_con_id = parse_required_i64(&query.underlying_con_id, "underlyingConID")?;
        if underlying_con_id != contract.underlying_con_id {
            return Err(format!(
                "Query field underlyingConID={underlying_con_id} does not match deterministic option underlyingConID {}.",
                contract.underlying_con_id
            ));
        }
        require_wire_match(
            "symbol",
            required_query_value(&query.symbol, "symbol")?,
            &contract.contract.symbol,
        )?;
        require_exact_match(
            "expiration",
            required_query_value(&query.expiration, "expiration")?,
            &contract.expiration,
        )?;
        require_decimal_match(
            "strike",
            required_query_value(&query.strike, "strike")?,
            &contract.strike,
        )?;
        require_wire_match(
            "right",
            required_query_value(&query.right, "right")?,
            &contract.right,
        )?;
        require_wire_match(
            "exchange",
            required_query_value(&query.exchange, "exchange")?,
            &contract.exchange,
        )?;
        require_wire_match(
            "currency",
            required_query_value(&query.currency, "currency")?,
            &contract.currency,
        )?;
        require_optional_wire_match(
            "tradingClass",
            &query.trading_class,
            Some(&contract.trading_class),
        )?;
        require_optional_decimal_match("multiplier", &query.multiplier, Some(&contract.multiplier))
    }

    fn historical_bars_for_query(
        mut response: crate::market_read_model::HistoricalBarsResponse,
        query: &HistoricalBarsQuery,
    ) -> Result<crate::market_read_model::HistoricalBarsResponse, String> {
        let timeframe = parse_timeframe_wire(required_query_value(&query.timeframe, "timeframe")?)?;
        let bar_limit = parse_required_usize(&query.bar_limit, "barLimit", 1, 1000)?;
        let duration = required_query_value(&query.duration, "duration")?.to_string();
        let what_to_show =
            required_query_value(&query.what_to_show, "whatToShow")?.to_ascii_uppercase();
        let regular_trading_hours_only =
            parse_required_bool(&query.regular_trading_hours_only, "regularTradingHoursOnly")?;

        response.timeframe = timeframe.clone();
        response.request_duration = duration;
        response.what_to_show = what_to_show;
        response.regular_trading_hours_only = regular_trading_hours_only;
        response.bars = deterministic_bars_for_request(&response.bars, &timeframe, bar_limit);
        Ok(response)
    }

    fn historical_ticks_for_query(
        mut response: crate::market_read_model::HistoricalTicksResponse,
        query: &HistoricalTicksQuery,
    ) -> Result<crate::market_read_model::HistoricalTicksResponse, String> {
        let start_date_time = optional_query_value(&query.start_date_time);
        let end_date_time = optional_query_value(&query.end_date_time);
        if start_date_time.is_some() == end_date_time.is_some() {
            return Err(
                "Historical tick request requires exactly one non-empty startDateTime or endDateTime."
                    .to_string(),
            );
        }
        let requested_tick_count =
            parse_required_u16(&query.number_of_ticks, "numberOfTicks", 1, 1000)?;
        let what_to_show =
            required_query_value(&query.what_to_show, "whatToShow")?.to_ascii_uppercase();
        if !matches!(what_to_show.as_str(), "TRADES" | "BID_ASK" | "MIDPOINT") {
            return Err("whatToShow must be TRADES, BID_ASK, or MIDPOINT.".to_string());
        }
        let regular_trading_hours_only =
            parse_required_bool(&query.regular_trading_hours_only, "regularTradingHoursOnly")?;
        let ignore_size = parse_required_bool(&query.ignore_size, "ignoreSize")?;

        if let Some(start_date_time) = start_date_time {
            response.start_date_time = start_date_time.to_string();
        }
        if let Some(end_date_time) = end_date_time {
            response.end_date_time = end_date_time.to_string();
        }
        response.requested_tick_count = requested_tick_count;
        response.what_to_show = what_to_show.clone();
        response.regular_trading_hours_only = regular_trading_hours_only;
        response.ignore_size = ignore_size;
        response.ticks =
            deterministic_ticks_for_request(&response.ticks, &what_to_show, requested_tick_count);
        response.tick_count = response.ticks.len();
        Ok(response)
    }

    fn deterministic_bars_for_request(
        source: &[crate::market_read_model::Bar],
        timeframe: &crate::market_read_model::Timeframe,
        bar_limit: usize,
    ) -> Vec<crate::market_read_model::Bar> {
        let source_start = bar_limit.saturating_sub(source.len());
        (0..bar_limit)
            .map(|index| {
                let source_index = index.saturating_sub(source_start).min(source.len() - 1);
                let mut bar = source[source_index].clone();
                bar.timeframe = timeframe.clone();
                bar.timestamp = deterministic_bar_timestamp(index, bar_limit, timeframe);
                bar
            })
            .collect()
    }

    fn deterministic_ticks_for_request(
        source: &[crate::market_read_model::HistoricalTick],
        what_to_show: &str,
        tick_count: u16,
    ) -> Vec<crate::market_read_model::HistoricalTick> {
        let kind = match what_to_show {
            "TRADES" => "last",
            "BID_ASK" => "bidAsk",
            "MIDPOINT" => "midpoint",
            _ => "last",
        };
        let template = source
            .iter()
            .find(|tick| tick.kind == kind)
            .or_else(|| source.first())
            .expect("deterministic tick fixture contains ticks");
        (0..usize::from(tick_count))
            .map(|index| {
                let mut tick = template.clone();
                tick.time = deterministic_tick_timestamp(index, usize::from(tick_count));
                tick
            })
            .collect()
    }

    fn deterministic_bar_timestamp(
        index: usize,
        bar_limit: usize,
        timeframe: &crate::market_read_model::Timeframe,
    ) -> String {
        let step_minutes = timeframe_minutes(timeframe).max(1);
        let end_minutes = 18 * 60 + 30;
        let minutes_from_end = (bar_limit - index) as i64 * step_minutes;
        let total_minutes = end_minutes - minutes_from_end;
        let day = 15 + total_minutes.div_euclid(24 * 60);
        let minute_of_day = total_minutes.rem_euclid(24 * 60);
        format!(
            "2027-01-{day:02}T{:02}:{:02}:00.000Z",
            minute_of_day / 60,
            minute_of_day % 60
        )
    }

    fn deterministic_tick_timestamp(index: usize, tick_count: usize) -> String {
        let end_seconds = 18 * 60 * 60 + 30 * 60;
        let seconds_from_end = (tick_count - index) as i64;
        let total_seconds = end_seconds - seconds_from_end;
        let second_of_day = total_seconds.rem_euclid(24 * 60 * 60);
        format!(
            "2027-01-15T{:02}:{:02}:{:02}.000Z",
            second_of_day / 3600,
            (second_of_day % 3600) / 60,
            second_of_day % 60
        )
    }

    fn timeframe_minutes(timeframe: &crate::market_read_model::Timeframe) -> i64 {
        match timeframe.unit.as_str() {
            "minute" => i64::from(timeframe.value),
            "hour" => i64::from(timeframe.value) * 60,
            "day" => i64::from(timeframe.value) * 24 * 60,
            _ => i64::from(timeframe.value),
        }
    }

    fn parse_timeframe_wire(value: &str) -> Result<crate::market_read_model::Timeframe, String> {
        let trimmed = value.trim();
        let split_at = trimmed
            .find(|character: char| !character.is_ascii_digit())
            .ok_or_else(|| "timeframe must include a positive value and unit.".to_string())?;
        if split_at == 0 {
            return Err("timeframe must include a positive value and unit.".to_string());
        }
        let value = trimmed[..split_at]
            .parse::<u32>()
            .map_err(|_| "timeframe value must be a positive integer.".to_string())?;
        if value == 0 {
            return Err("timeframe value must be a positive integer.".to_string());
        }
        let unit = match trimmed[split_at..].to_ascii_lowercase().as_str() {
            "m" | "min" | "minute" | "minutes" => "minute",
            "h" | "hour" | "hours" => "hour",
            "d" | "day" | "days" => "day",
            _ => return Err("timeframe unit must be m, h, or d.".to_string()),
        };
        Ok(crate::market_read_model::Timeframe {
            value,
            unit: unit.to_string(),
        })
    }

    fn required_query_value<'a>(value: &'a Option<String>, name: &str) -> Result<&'a str, String> {
        optional_query_value(value).ok_or_else(|| format!("Missing required query field {name}."))
    }

    fn optional_query_value(value: &Option<String>) -> Option<&str> {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    fn parse_required_bool(value: &Option<String>, name: &str) -> Result<bool, String> {
        match required_query_value(value, name)?
            .to_ascii_lowercase()
            .as_str()
        {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(format!("{name} must be true or false.")),
        }
    }

    fn parse_required_i64(value: &Option<String>, name: &str) -> Result<i64, String> {
        required_query_value(value, name)?
            .parse::<i64>()
            .map_err(|_| format!("{name} must be an integer."))
    }

    fn parse_required_u16(
        value: &Option<String>,
        name: &str,
        min: u16,
        max: u16,
    ) -> Result<u16, String> {
        let parsed = required_query_value(value, name)?
            .parse::<u16>()
            .map_err(|_| format!("{name} must be {min}...{max}."))?;
        if !(min..=max).contains(&parsed) {
            return Err(format!("{name} must be {min}...{max}."));
        }
        Ok(parsed)
    }

    fn parse_required_usize(
        value: &Option<String>,
        name: &str,
        min: usize,
        max: usize,
    ) -> Result<usize, String> {
        let parsed = required_query_value(value, name)?
            .parse::<usize>()
            .map_err(|_| format!("{name} must be {min}...{max}."))?;
        if !(min..=max).contains(&parsed) {
            return Err(format!("{name} must be {min}...{max}."));
        }
        Ok(parsed)
    }

    fn require_wire_match(name: &str, actual: &str, expected: &str) -> Result<(), String> {
        if actual.trim().eq_ignore_ascii_case(expected) {
            return Ok(());
        }
        Err(format!(
            "Query field {name}={actual} does not match deterministic fixture {expected}."
        ))
    }

    fn require_exact_match(name: &str, actual: &str, expected: &str) -> Result<(), String> {
        if actual.trim() == expected {
            return Ok(());
        }
        Err(format!(
            "Query field {name}={actual} does not match deterministic fixture {expected}."
        ))
    }

    fn require_decimal_match(name: &str, actual: &str, expected: &str) -> Result<(), String> {
        if normalize_decimal_literal(actual) == normalize_decimal_literal(expected) {
            return Ok(());
        }
        Err(format!(
            "Query field {name}={actual} does not match deterministic fixture {expected}."
        ))
    }

    fn require_optional_wire_match(
        name: &str,
        actual: &Option<String>,
        expected: Option<&str>,
    ) -> Result<(), String> {
        if let Some(actual) = optional_query_value(actual) {
            if let Some(expected) = expected {
                return require_wire_match(name, actual, expected);
            }
            return Err(format!(
                "Query field {name}={actual} does not match deterministic fixture <none>."
            ));
        }
        Ok(())
    }

    fn require_optional_exact_match(
        name: &str,
        actual: &Option<String>,
        expected: Option<&str>,
    ) -> Result<(), String> {
        if let Some(actual) = optional_query_value(actual) {
            if let Some(expected) = expected {
                return require_exact_match(name, actual, expected);
            }
            return Err(format!(
                "Query field {name}={actual} does not match deterministic fixture <none>."
            ));
        }
        Ok(())
    }

    fn require_optional_decimal_match(
        name: &str,
        actual: &Option<String>,
        expected: Option<&str>,
    ) -> Result<(), String> {
        if let Some(actual) = optional_query_value(actual) {
            if let Some(expected) = expected {
                return require_decimal_match(name, actual, expected);
            }
            return Err(format!(
                "Query field {name}={actual} does not match deterministic fixture <none>."
            ));
        }
        Ok(())
    }

    fn normalize_decimal_literal(value: &str) -> String {
        let trimmed = value.trim();
        if let Some((whole, fraction)) = trimmed.split_once('.') {
            let fraction = fraction.trim_end_matches('0');
            if fraction.is_empty() {
                whole.to_string()
            } else {
                format!("{whole}.{fraction}")
            }
        } else {
            trimmed.to_string()
        }
    }

    fn account_not_found_response(account_id: &str) -> axum::response::Response {
        not_found_failure_response(
            "orderNotFound",
            &format!("No broker account state exists for account {account_id}."),
            &format!("account {account_id}"),
        )
    }

    fn contract_not_found_response(con_id: i64) -> axum::response::Response {
        not_found_failure_response(
            "invalidContract",
            &format!("No deterministic contract fixture exists for conID {con_id}."),
            &format!("conID {con_id}"),
        )
    }

    fn not_found_failure_response(
        code: &str,
        message: &str,
        request_id: &str,
    ) -> axum::response::Response {
        let failure = AdapterFailure {
            code: code.to_string(),
            message: message.to_string(),
            request_id: Some(request_id.to_string()),
            retry_after_seconds: None,
        };
        (StatusCode::NOT_FOUND, Json(failure)).into_response()
    }

    async fn not_found(method: Method, uri: Uri) -> impl IntoResponse {
        let failure = AdapterFailure {
            code: "invalidContract".to_string(),
            message: format!("No route is registered for {method} {}.", uri.path()),
            request_id: Some(format!("{method} {}", uri.path())),
            retry_after_seconds: None,
        };
        (StatusCode::NOT_FOUND, Json(failure))
    }

    async fn events(State(state): State<AppState>, ws: WebSocketUpgrade) -> impl IntoResponse {
        ws.on_upgrade(move |socket| handle_socket(socket, state.event_hub))
    }

    async fn handle_socket(mut socket: WebSocket, event_hub: EventHub) {
        let mut receiver = event_hub.subscribe();
        let mut subscriptions = EventSubscriptionState::default();
        for event in event_hub.initial_events() {
            let text = match serde_json::to_string(&event) {
                Ok(text) => text,
                Err(error) => {
                    tracing::error!(%error, "failed to encode event envelope");
                    return;
                }
            };
            if socket.send(Message::Text(text.into())).await.is_err() {
                return;
            }
        }

        loop {
            tokio::select! {
                message = socket.recv() => {
                    match message {
                        Some(Ok(Message::Text(text))) => {
                            if let Some(failure) = subscriptions.subscribe_from_command(&text) {
                                let event = failure_event(failure);
                                if let Ok(text) = serde_json::to_string(&event) {
                                    let _ = socket.send(Message::Text(text.into())).await;
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                        _ => {}
                    }
                }
                event = receiver.recv() => {
                    let event = match event {
                        Ok(event) => event,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                    };
                    if subscriptions.should_receive(&event) {
                        let text = match serde_json::to_string(&event) {
                            Ok(text) => text,
                            Err(error) => {
                                tracing::error!(%error, "failed to encode event envelope");
                                return;
                            }
                        };
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            return;
                        }
                    }
                }
            }
        }
    }

    fn request_id(headers: &HeaderMap) -> Option<String> {
        headers
            .get("Idempotency-Key")
            .or_else(|| headers.get("X-Request-ID"))
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.to_string())
    }

    #[derive(Debug, Deserialize)]
    struct EventCommand {
        action: Option<String>,
        subscription: Option<Subscription>,
        stream: Option<String>,
        #[serde(rename = "conID")]
        con_id: Option<i64>,
        timeframe: Option<SubscriptionTimeframe>,
    }

    #[derive(Debug, Deserialize)]
    struct Subscription {
        stream: Option<String>,
        #[serde(rename = "conID")]
        con_id: Option<i64>,
        timeframe: Option<SubscriptionTimeframe>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(untagged)]
    enum SubscriptionTimeframe {
        Wire(String),
        Object { value: u32, unit: String },
    }

    #[derive(Clone, Debug, Eq, Hash, PartialEq)]
    struct BarSubscription {
        con_id: i64,
        timeframe_key: String,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct ParsedSubscriptionCommand {
        stream: MarketDataStreamKind,
        con_id: i64,
        timeframe_key: Option<String>,
    }

    #[derive(Clone, Debug, Default)]
    struct EventSubscriptionState {
        quote_con_ids: HashSet<i64>,
        bar_subscriptions: HashSet<BarSubscription>,
    }

    impl EventSubscriptionState {
        fn subscribe_from_command(&mut self, text: &str) -> Option<AdapterFailure> {
            match parse_subscription_command(text) {
                Ok(Some(command)) => {
                    match command.stream {
                        MarketDataStreamKind::Quote => {
                            self.quote_con_ids.insert(command.con_id);
                        }
                        MarketDataStreamKind::Bars => {
                            self.bar_subscriptions.insert(BarSubscription {
                                con_id: command.con_id,
                                timeframe_key: command
                                    .timeframe_key
                                    .expect("parsed bar subscription includes a timeframe"),
                            });
                        }
                    }
                    None
                }
                Ok(None) => None,
                Err(failure) => Some(failure),
            }
        }

        fn should_receive(&self, event: &crate::adapter_contract::EventEnvelope) -> bool {
            event_matches_subscription_state(event, self)
        }
    }

    #[cfg(test)]
    fn validate_subscription_command(text: &str) -> Option<AdapterFailure> {
        parse_subscription_command(text).err()
    }

    fn parse_subscription_command(
        text: &str,
    ) -> Result<Option<ParsedSubscriptionCommand>, AdapterFailure> {
        let command = match serde_json::from_str::<EventCommand>(text) {
            Ok(command) => command,
            Err(_) if text.trim().is_empty() => return Ok(None),
            Err(_) => {
                return Err(invalid_event_subscription_failure(Some(
                    json!({ "command": text }).to_string(),
                )))
            }
        };
        let action_is_valid = command.action.as_deref() == Some("subscribe");
        let stream = command
            .subscription
            .as_ref()
            .and_then(|subscription| subscription.stream.as_deref())
            .or(command.stream.as_deref());
        let con_id = command
            .subscription
            .as_ref()
            .and_then(|subscription| subscription.con_id)
            .or(command.con_id);
        let timeframe = command
            .subscription
            .as_ref()
            .and_then(|subscription| subscription.timeframe.as_ref())
            .or(command.timeframe.as_ref());

        let stream = match stream {
            Some("quote") => Some(MarketDataStreamKind::Quote),
            Some("bars") => Some(MarketDataStreamKind::Bars),
            _ => None,
        };
        let failure =
            || invalid_event_subscription_failure(Some(json!({ "command": text }).to_string()));
        let (true, Some(stream), Some(con_id)) =
            (action_is_valid, stream, con_id.filter(|value| *value > 0))
        else {
            return Err(failure());
        };
        let timeframe_key = match stream {
            MarketDataStreamKind::Quote => None,
            MarketDataStreamKind::Bars => Some(
                timeframe
                    .ok_or_else(failure)?
                    .key()
                    .map_err(|_| failure())?,
            ),
        };
        Ok(Some(ParsedSubscriptionCommand {
            stream,
            con_id,
            timeframe_key,
        }))
    }

    impl SubscriptionTimeframe {
        fn key(&self) -> Result<String, String> {
            match self {
                Self::Wire(value) => subscription_timeframe_key_from_wire(value),
                Self::Object { value, unit } => subscription_timeframe_key_from_parts(*value, unit),
            }
        }
    }

    fn subscription_timeframe_key_from_wire(value: &str) -> Result<String, String> {
        let trimmed = value.trim();
        let split_at = trimmed
            .find(|character: char| !character.is_ascii_digit())
            .ok_or_else(|| "timeframe must include a positive value and unit.".to_string())?;
        if split_at == 0 {
            return Err("timeframe must include a positive value and unit.".to_string());
        }
        let value = trimmed[..split_at]
            .parse::<u32>()
            .map_err(|_| "timeframe value must be a positive integer.".to_string())?;
        subscription_timeframe_key_from_parts(value, &trimmed[split_at..])
    }

    fn subscription_timeframe_key_from_parts(value: u32, unit: &str) -> Result<String, String> {
        if value == 0 {
            return Err("timeframe value must be a positive integer.".to_string());
        }
        let suffix = match unit.trim().to_ascii_lowercase().as_str() {
            "s" | "sec" | "second" | "seconds" => "s",
            "m" | "min" | "minute" | "minutes" => "m",
            "h" | "hour" | "hours" => "h",
            "d" | "day" | "days" => "d",
            _ => return Err("timeframe unit must be s, m, h, or d.".to_string()),
        };
        Ok(format!("{value}{suffix}"))
    }

    fn event_matches_subscription_state(
        event: &crate::adapter_contract::EventEnvelope,
        subscriptions: &EventSubscriptionState,
    ) -> bool {
        match event.event.as_str() {
            "quote.snapshot" | "option.quote" => event_con_id(event)
                .is_some_and(|con_id| subscriptions.quote_con_ids.contains(&con_id)),
            "bars.snapshot" => event_con_id(event).is_some_and(|con_id| {
                event_timeframe_key(event).is_some_and(|timeframe_key| {
                    subscriptions.bar_subscriptions.contains(&BarSubscription {
                        con_id,
                        timeframe_key,
                    })
                })
            }),
            "ticks.snapshot" => event_con_id(event).is_some_and(|con_id| {
                subscriptions.quote_con_ids.contains(&con_id)
                    || subscriptions
                        .bar_subscriptions
                        .iter()
                        .any(|subscription| subscription.con_id == con_id)
            }),
            _ => true,
        }
    }

    fn event_timeframe_key(event: &crate::adapter_contract::EventEnvelope) -> Option<String> {
        event
            .payload
            .pointer("/timeframe")
            .and_then(subscription_timeframe_key_from_json)
            .or_else(|| {
                event
                    .payload
                    .pointer("/bars/0/timeframe")
                    .and_then(subscription_timeframe_key_from_json)
            })
    }

    fn subscription_timeframe_key_from_json(value: &serde_json::Value) -> Option<String> {
        if let Some(value) = value.as_str() {
            return subscription_timeframe_key_from_wire(value).ok();
        }
        let timeframe_value = value
            .get("value")
            .and_then(|value| value.as_u64())
            .and_then(|value| u32::try_from(value).ok())?;
        let unit = value.get("unit").and_then(|value| value.as_str())?;
        subscription_timeframe_key_from_parts(timeframe_value, unit).ok()
    }

    fn event_con_id(event: &crate::adapter_contract::EventEnvelope) -> Option<i64> {
        event
            .payload
            .pointer("/contract/conID")
            .and_then(|value| {
                value.as_i64().or_else(|| {
                    value
                        .as_str()
                        .and_then(|string_value| string_value.parse::<i64>().ok())
                })
            })
            .or_else(|| {
                event
                    .payload
                    .pointer("/contract/contract/conID")
                    .and_then(|value| {
                        value.as_i64().or_else(|| {
                            value
                                .as_str()
                                .and_then(|string_value| string_value.parse::<i64>().ok())
                        })
                    })
            })
    }

    #[cfg(test)]
    mod tests {
        use super::{
            event_matches_subscription_state, validate_subscription_command, EventSubscriptionState,
        };
        use crate::adapter_contract::event_envelope;
        use serde_json::json;

        #[test]
        fn accepts_nested_subscription_shape() {
            let input =
                r#"{"action":"subscribe","subscription":{"stream":"quote","conID":265598}}"#;
            assert!(validate_subscription_command(input).is_none());
        }

        #[test]
        fn accepts_nested_bar_subscription_shape_with_swift_timeframe() {
            let input = r#"{"action":"subscribe","subscription":{"conID":265598,"stream":"bars","timeframe":{"unit":"minute","value":1}}}"#;
            assert!(validate_subscription_command(input).is_none());
        }

        #[test]
        fn rejects_invalid_subscription_shape() {
            let input = r#"{"action":"subscribe","subscription":{"stream":"depth","conID":0}}"#;
            let failure = validate_subscription_command(input).expect("failure");
            assert_eq!(failure.code, "invalidEventSubscription");
        }

        #[test]
        fn rejects_malformed_subscription_text() {
            let failure = validate_subscription_command("not-json").expect("failure");
            assert_eq!(failure.code, "invalidEventSubscription");
        }

        #[test]
        fn rejects_bar_subscription_without_timeframe() {
            let input = r#"{"action":"subscribe","subscription":{"stream":"bars","conID":265598}}"#;
            let failure = validate_subscription_command(input).expect("failure");
            assert_eq!(failure.code, "invalidEventSubscription");
        }

        #[test]
        fn subscription_state_filters_future_market_events_by_stream_and_contract() {
            let mut subscriptions = EventSubscriptionState::default();
            assert!(subscriptions
                .subscribe_from_command(
                    r#"{"action":"subscribe","subscription":{"stream":"quote","conID":265598}}"#
                )
                .is_none());

            let quote =
                event_envelope("quote.snapshot", json!({ "contract": { "conID": 265598 } }));
            let other_quote =
                event_envelope("quote.snapshot", json!({ "contract": { "conID": 999999 } }));
            let bars = event_envelope(
                "bars.snapshot",
                json!({ "contract": { "conID": 265598 }, "timeframe": { "value": 1, "unit": "minute" } }),
            );
            let ticks =
                event_envelope("ticks.snapshot", json!({ "contract": { "conID": 265598 } }));
            let order = event_envelope("order.status", json!({ "brokerOrderID": "1001" }));

            assert!(event_matches_subscription_state(&quote, &subscriptions));
            assert!(!event_matches_subscription_state(
                &other_quote,
                &subscriptions
            ));
            assert!(!event_matches_subscription_state(&bars, &subscriptions));
            assert!(event_matches_subscription_state(&ticks, &subscriptions));
            assert!(event_matches_subscription_state(&order, &subscriptions));

            assert!(subscriptions
                .subscribe_from_command(
                    r#"{"action":"subscribe","subscription":{"stream":"bars","conID":265598,"timeframe":{"value":1,"unit":"minute"}}}"#
                )
                .is_none());
            assert!(event_matches_subscription_state(&bars, &subscriptions));
            let other_timeframe_bars = event_envelope(
                "bars.snapshot",
                json!({ "contract": { "conID": 265598 }, "timeframe": { "value": 1, "unit": "day" } }),
            );
            assert!(!event_matches_subscription_state(
                &other_timeframe_bars,
                &subscriptions
            ));
        }
    }
}

pub mod verifier {
    use crate::adapter_contract::{
        capabilities, event_names, failure_codes, routes, runtime_preflight, API_VERSION,
        IMPLEMENTATION,
    };
    use crate::broker_callback_router;
    use crate::broker_protocol;
    use crate::broker_read_model::{AccountStateFixture, PAPER_ACCOUNT_ID};
    use crate::event_hub::EventHub;
    use crate::http_interface;
    use crate::market_read_model::{
        MarketDataFixture, MarketDataStreamKind, MarketDataSubscriptionStore, AAPL_CON_ID,
    };
    use crate::operation_ledger::{
        failure_taxonomy, redact_text, LedgerDecisionKind, OperationLedger,
    };
    use crate::order_routing;
    use crate::runtime_state::{
        evaluate_duplicate_client_id, evaluate_startup, BrokerSessionSnapshot,
        LIVE_TRADING_STARTUP_CONFIRMATION,
    };
    use crate::tws_transport;
    use crate::tws_wire;
    use serde::Serialize;
    use serde_json::{json, Value};

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum VerifierKind {
        RuntimePreflight,
        ApiSurface,
        DisconnectedSurface,
        AuditIdempotency,
        FailureTaxonomy,
        ObservabilityRedaction,
        StartupSafety,
        ServerTimeProvenance,
        BrokerSessionManagement,
        TwsWireCodec,
        TwsTransportStartup,
        TwsTcpStartup,
        BrokerStartupConfig,
        HttpStartupState,
        BrokerCallbackRouting,
        TwsDomainCallbackDecoder,
        TwsFieldCallbackDecoder,
        HttpDomainCallbackProjection,
        HttpFieldCallbackProjection,
        TwsDomainStreamHttpProjection,
        TwsFieldStreamHttpProjection,
        AccountCallbackState,
        AccountState,
        OrderLifecycle,
        MarketDataCallbackState,
        MarketDataStreams,
        HistoricalPacing,
        OptionMarketData,
        OrderSafety,
        OrderCallbackState,
        PaperOrderRouting,
        LiveOrderRouting,
        LiveOptionComboRouting,
        OptionExerciseSafety,
        BackendReadiness,
    }

    impl VerifierKind {
        pub fn parse(value: &str) -> Result<Self, String> {
            match value {
                "runtime-preflight" => Ok(Self::RuntimePreflight),
                "api-surface" => Ok(Self::ApiSurface),
                "disconnected-surface" => Ok(Self::DisconnectedSurface),
                "audit-idempotency" => Ok(Self::AuditIdempotency),
                "failure-taxonomy" => Ok(Self::FailureTaxonomy),
                "observability-redaction" => Ok(Self::ObservabilityRedaction),
                "startup-safety" => Ok(Self::StartupSafety),
                "server-time-provenance" => Ok(Self::ServerTimeProvenance),
                "broker-session-management" => Ok(Self::BrokerSessionManagement),
                "tws-wire-codec" => Ok(Self::TwsWireCodec),
                "tws-transport-startup" => Ok(Self::TwsTransportStartup),
                "tws-tcp-startup" => Ok(Self::TwsTcpStartup),
                "broker-startup-config" => Ok(Self::BrokerStartupConfig),
                "http-startup-state" => Ok(Self::HttpStartupState),
                "broker-callback-routing" => Ok(Self::BrokerCallbackRouting),
                "tws-domain-callback-decoder" => Ok(Self::TwsDomainCallbackDecoder),
                "tws-field-callback-decoder" => Ok(Self::TwsFieldCallbackDecoder),
                "http-domain-callback-projection" => Ok(Self::HttpDomainCallbackProjection),
                "http-field-callback-projection" => Ok(Self::HttpFieldCallbackProjection),
                "tws-domain-stream-http-projection" => {
                    Ok(Self::TwsDomainStreamHttpProjection)
                }
                "tws-field-stream-http-projection" => Ok(Self::TwsFieldStreamHttpProjection),
                "account-callback-state" => Ok(Self::AccountCallbackState),
                "account-state" => Ok(Self::AccountState),
                "order-lifecycle" => Ok(Self::OrderLifecycle),
                "market-data-callback-state" => Ok(Self::MarketDataCallbackState),
                "market-data-streams" => Ok(Self::MarketDataStreams),
                "historical-pacing" => Ok(Self::HistoricalPacing),
                "option-market-data" => Ok(Self::OptionMarketData),
                "order-safety" => Ok(Self::OrderSafety),
                "order-callback-state" => Ok(Self::OrderCallbackState),
                "paper-order-routing" => Ok(Self::PaperOrderRouting),
                "live-order-routing" => Ok(Self::LiveOrderRouting),
                "live-option-combo-routing" => Ok(Self::LiveOptionComboRouting),
                "option-exercise-safety" => Ok(Self::OptionExerciseSafety),
                "backend-readiness" => Ok(Self::BackendReadiness),
                other => Err(format!(
                    "unsupported verifier '{other}'. Implemented verifiers: runtime-preflight, api-surface, disconnected-surface, audit-idempotency, failure-taxonomy, observability-redaction, startup-safety, server-time-provenance, broker-session-management, tws-wire-codec, tws-transport-startup, tws-tcp-startup, broker-startup-config, http-startup-state, broker-callback-routing, tws-domain-callback-decoder, tws-field-callback-decoder, http-domain-callback-projection, http-field-callback-projection, tws-domain-stream-http-projection, tws-field-stream-http-projection, account-callback-state, account-state, order-lifecycle, market-data-callback-state, market-data-streams, historical-pacing, option-market-data, order-safety, order-callback-state, paper-order-routing, live-order-routing, live-option-combo-routing, option-exercise-safety, backend-readiness"
                )),
            }
        }
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VerificationTrace {
        pub verifier: String,
        pub api_version: String,
        pub implementation: String,
        pub is_approved: bool,
        pub checks: Vec<VerificationCheck>,
        pub evidence: Value,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VerificationCheck {
        pub id: String,
        pub is_approved: bool,
        pub message: String,
    }

    pub async fn run(kind: VerifierKind) -> VerificationTrace {
        match kind {
            VerifierKind::BackendReadiness => backend_readiness_trace().await,
            local_kind => run_local_backend_verifier(local_kind).await,
        }
    }

    async fn run_local_backend_verifier(kind: VerifierKind) -> VerificationTrace {
        match kind {
            VerifierKind::RuntimePreflight => runtime_preflight_trace(),
            VerifierKind::ApiSurface => api_surface_trace(),
            VerifierKind::DisconnectedSurface => disconnected_surface_trace(),
            VerifierKind::AuditIdempotency => audit_idempotency_trace(),
            VerifierKind::FailureTaxonomy => failure_taxonomy_trace(),
            VerifierKind::ObservabilityRedaction => observability_redaction_trace(),
            VerifierKind::StartupSafety => startup_safety_trace(),
            VerifierKind::ServerTimeProvenance => server_time_provenance_trace(),
            VerifierKind::BrokerSessionManagement => broker_session_management_trace(),
            VerifierKind::TwsWireCodec => tws_wire_codec_trace(),
            VerifierKind::TwsTransportStartup => tws_transport_startup_trace().await,
            VerifierKind::TwsTcpStartup => tws_tcp_startup_trace().await,
            VerifierKind::BrokerStartupConfig => broker_startup_config_trace().await,
            VerifierKind::HttpStartupState => http_startup_state_trace().await,
            VerifierKind::BrokerCallbackRouting => broker_callback_routing_trace(),
            VerifierKind::TwsDomainCallbackDecoder => tws_domain_callback_decoder_trace(),
            VerifierKind::TwsFieldCallbackDecoder => tws_field_callback_decoder_trace(),
            VerifierKind::HttpDomainCallbackProjection => http_domain_callback_projection_trace(),
            VerifierKind::HttpFieldCallbackProjection => http_field_callback_projection_trace(),
            VerifierKind::TwsDomainStreamHttpProjection => {
                tws_domain_stream_http_projection_trace().await
            }
            VerifierKind::TwsFieldStreamHttpProjection => {
                tws_field_stream_http_projection_trace().await
            }
            VerifierKind::AccountCallbackState => account_callback_state_trace(),
            VerifierKind::AccountState => account_state_trace(),
            VerifierKind::OrderLifecycle => order_lifecycle_trace(),
            VerifierKind::MarketDataCallbackState => market_data_callback_state_trace(),
            VerifierKind::MarketDataStreams => market_data_streams_trace(),
            VerifierKind::HistoricalPacing => historical_pacing_trace(),
            VerifierKind::OptionMarketData => option_market_data_trace(),
            VerifierKind::OrderSafety => order_safety_trace(),
            VerifierKind::OrderCallbackState => order_callback_state_trace(),
            VerifierKind::PaperOrderRouting => paper_order_routing_trace(),
            VerifierKind::LiveOrderRouting => live_order_routing_trace(),
            VerifierKind::LiveOptionComboRouting => live_option_combo_routing_trace(),
            VerifierKind::OptionExerciseSafety => option_exercise_safety_trace(),
            VerifierKind::BackendReadiness => {
                unreachable!("backend-readiness is an aggregate verifier")
            }
        }
    }

    fn local_backend_verifier_kinds() -> [VerifierKind; 34] {
        [
            VerifierKind::RuntimePreflight,
            VerifierKind::ApiSurface,
            VerifierKind::DisconnectedSurface,
            VerifierKind::AuditIdempotency,
            VerifierKind::FailureTaxonomy,
            VerifierKind::ObservabilityRedaction,
            VerifierKind::StartupSafety,
            VerifierKind::ServerTimeProvenance,
            VerifierKind::BrokerSessionManagement,
            VerifierKind::TwsWireCodec,
            VerifierKind::TwsTransportStartup,
            VerifierKind::TwsTcpStartup,
            VerifierKind::BrokerStartupConfig,
            VerifierKind::HttpStartupState,
            VerifierKind::BrokerCallbackRouting,
            VerifierKind::TwsDomainCallbackDecoder,
            VerifierKind::TwsFieldCallbackDecoder,
            VerifierKind::HttpDomainCallbackProjection,
            VerifierKind::HttpFieldCallbackProjection,
            VerifierKind::TwsDomainStreamHttpProjection,
            VerifierKind::TwsFieldStreamHttpProjection,
            VerifierKind::AccountCallbackState,
            VerifierKind::AccountState,
            VerifierKind::OrderLifecycle,
            VerifierKind::MarketDataCallbackState,
            VerifierKind::MarketDataStreams,
            VerifierKind::HistoricalPacing,
            VerifierKind::OptionMarketData,
            VerifierKind::OrderSafety,
            VerifierKind::OrderCallbackState,
            VerifierKind::PaperOrderRouting,
            VerifierKind::LiveOrderRouting,
            VerifierKind::LiveOptionComboRouting,
            VerifierKind::OptionExerciseSafety,
        ]
    }

    async fn backend_readiness_trace() -> VerificationTrace {
        let mut traces = Vec::new();
        for kind in local_backend_verifier_kinds() {
            traces.push(run_local_backend_verifier(kind).await);
        }
        let approved_verifier_count = traces.iter().filter(|trace| trace.is_approved).count();
        let local_verifier_count = traces.len();
        let checks = traces
            .iter()
            .map(|trace| VerificationCheck {
                id: trace.verifier.clone(),
                is_approved: trace.is_approved,
                message: format!(
                    "{} verifier {}",
                    trace.verifier,
                    if trace.is_approved {
                        "approved"
                    } else {
                        "failed"
                    }
                ),
            })
            .collect::<Vec<_>>();

        VerificationTrace {
            verifier: "backend-readiness".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: approved_verifier_count == local_verifier_count,
            checks,
            evidence: json!({
                "localVerifierCount": local_verifier_count,
                "approvedVerifierCount": approved_verifier_count,
                "externalEvidenceRequired": capabilities().real_session_evidence_required,
                "completionBoundary": "local backend readiness does not prove external IBKR Gateway/TWS paper or live readiness",
                "traces": traces
            }),
        }
    }

    fn runtime_preflight_trace() -> VerificationTrace {
        let trace = runtime_preflight();
        VerificationTrace {
            verifier: "runtime-preflight".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: trace.is_approved,
            checks: trace
                .checks
                .iter()
                .map(|check| VerificationCheck {
                    id: check.id.clone(),
                    is_approved: check.is_approved,
                    message: check.message.clone(),
                })
                .collect(),
            evidence: json!(trace),
        }
    }

    fn api_surface_trace() -> VerificationTrace {
        let capabilities = capabilities();
        let route_count = capabilities.routes.len();
        let event_count = capabilities.event_names.len();
        let failure_count = capabilities.failure_codes.len();
        let java_wrapper_manifest = capabilities.kind == "ibkr-java-wrapper-capabilities"
            && capabilities.route_count == route_count
            && capabilities.routes.iter().all(|route| {
                route.requires_tws_connection == route.broker_session_required
                    && !route.category.is_empty()
            });
        let route_safety_flags = capabilities.routes.iter().any(|route| {
            route.method == "POST"
                && route.path == "/v1/orders/live"
                && route.requires_idempotency_key
                && route.requires_exact_confirmation
                && route.returns_async_acknowledgement
        }) && capabilities.routes.iter().any(|route| {
            route.method == "POST"
                && route.path == "/v1/orders/global-cancel"
                && !route.requires_idempotency_key
                && route.requires_exact_confirmation
                && route.returns_async_acknowledgement
        });
        let capability_buckets = capabilities
            .market_data
            .iter()
            .any(|capability| capability == "historicalTicks")
            && capabilities
                .order_capabilities
                .iter()
                .any(|capability| capability == "paperGlobalCancel")
            && capabilities
                .risk_and_safety_gates
                .iter()
                .any(|gate| gate == "requestDerivedIdempotency")
            && capabilities
                .graph_and_ticket_data
                .iter()
                .any(|capability| capability == "liveTicketGate")
            && capabilities
                .real_session_evidence_required
                .iter()
                .any(|gate| {
                    gate == "real Gateway/TWS live dry-run or explicitly approved placement"
                });
        VerificationTrace {
            verifier: "api-surface".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: route_count == 30
                && event_count == 17
                && failure_count >= 12
                && java_wrapper_manifest
                && route_safety_flags
                && capability_buckets,
            checks: vec![
                check(
                    "wire-version",
                    capabilities.api_version == API_VERSION,
                    "capability manifest keeps the Swift wire version",
                ),
                check(
                    "route-count",
                    route_count == 30,
                    "capability manifest exposes all 30 frozen routes",
                ),
                check(
                    "event-count",
                    event_count == 17,
                    "capability manifest exposes all 17 frozen event names",
                ),
                check(
                    "failure-codes",
                    failure_count >= 12,
                    "capability manifest exposes Swift-decodable failure codes",
                ),
                check(
                    "java-wrapper-manifest-shape",
                    java_wrapper_manifest,
                    "capability manifest decodes as the existing Swift IBKRJavaWrapperCapabilities model",
                ),
                check(
                    "route-safety-flags",
                    route_safety_flags,
                    "capability routes expose TWS, idempotency, confirmation, and async acknowledgement flags",
                ),
                check(
                    "capability-buckets",
                    capability_buckets,
                    "capability manifest exposes market, order, risk, graph, and external evidence buckets",
                ),
            ],
            evidence: json!(capabilities),
        }
    }

    fn disconnected_surface_trace() -> VerificationTrace {
        let broker_routes = routes()
            .into_iter()
            .filter(|route| route.broker_session_required)
            .collect::<Vec<_>>();
        let broker_routes_fail_closed = broker_routes
            .iter()
            .all(|route| route.disconnected_failure_code.as_deref() == Some("disconnectedGateway"));
        VerificationTrace {
            verifier: "disconnected-surface".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: broker_routes.len() == 26 && broker_routes_fail_closed,
            checks: vec![
                check(
                    "broker-route-count",
                    broker_routes.len() == 26,
                    "all broker-facing routes are classified",
                ),
                check(
                    "fail-closed",
                    broker_routes_fail_closed,
                    "broker-facing routes return disconnectedGateway before broker readiness",
                ),
                check(
                    "event-replay",
                    event_names().contains(&"adapter.failure"),
                    "adapter.failure events are part of the replay surface",
                ),
                check(
                    "failure-code",
                    failure_codes().contains(&"disconnectedGateway"),
                    "disconnectedGateway is a stable failure code",
                ),
            ],
            evidence: json!({
                "brokerRoutes": broker_routes,
                "failureCode": "disconnectedGateway"
            }),
        }
    }

    fn audit_idempotency_trace() -> VerificationTrace {
        let ledger = OperationLedger::default();
        let body = br#"{"accountID":"DU1234567","environment":"ibkrPaper","requestID":"intent-00000000-0000-0000-0000-000000000001","apiToken":"REDACT_ME"}"#;
        let changed_body = br#"{"accountID":"DU1234567","environment":"ibkrPaper","requestID":"intent-00000000-0000-0000-0000-000000000001","quantity":2}"#;
        let first = ledger
            .record(
                "POST",
                "/v1/orders/paper",
                Some("00000000-0000-0000-0000-000000000001".to_string()),
                "POST /v1/orders/paper".to_string(),
                body,
            )
            .expect("paper order receipt");
        let replay = ledger
            .record(
                "POST",
                "/v1/orders/paper",
                Some("00000000-0000-0000-0000-000000000001".to_string()),
                "POST /v1/orders/paper".to_string(),
                body,
            )
            .expect("paper order replay receipt");
        let mismatch = ledger
            .record(
                "POST",
                "/v1/orders/paper",
                Some("00000000-0000-0000-0000-000000000001".to_string()),
                "POST /v1/orders/paper".to_string(),
                changed_body,
            )
            .expect("paper order mismatch receipt");
        let missing = ledger
            .record(
                "POST",
                "/v1/options/exercise",
                None,
                "POST /v1/options/exercise".to_string(),
                br#"{"accountID":"DU1234567","environment":"ibkrPaper"}"#,
            )
            .expect("option exercise missing idempotency receipt");

        let receipts = vec![
            first.receipt.clone(),
            replay.receipt.clone(),
            mismatch.receipt.clone(),
            missing.receipt.clone(),
        ];
        let serialized = serde_json::to_string(&receipts).expect("receipt json");
        let accepted = first.receipt.decision == LedgerDecisionKind::Accepted;
        let replayed = replay.receipt.decision == LedgerDecisionKind::Replayed;
        let rejected_mismatch = mismatch.receipt.decision
            == LedgerDecisionKind::RejectedIdempotencyMismatch
            && mismatch.should_return_rejected_order;
        let missing_key = missing.receipt.decision
            == LedgerDecisionKind::RejectedMissingIdempotencyKey
            && missing.should_return_rejected_order;
        let redacted = !serialized.contains("DU1234567") && !serialized.contains("REDACT_ME");

        VerificationTrace {
            verifier: "audit-idempotency".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: accepted && replayed && rejected_mismatch && missing_key && redacted,
            checks: vec![
                check(
                    "first-accepts",
                    accepted,
                    "first idempotent request creates an audit receipt",
                ),
                check(
                    "same-body-replays",
                    replayed,
                    "same idempotency key and body replays the existing operation",
                ),
                check(
                    "body-mismatch-rejects",
                    rejected_mismatch,
                    "same idempotency key with a different body is rejected",
                ),
                check(
                    "missing-key-rejects",
                    missing_key,
                    "idempotent command without Idempotency-Key is rejected",
                ),
                check(
                    "audit-redaction",
                    redacted,
                    "audit receipts do not contain raw account ids or redaction sentinels",
                ),
            ],
            evidence: json!({ "receipts": receipts }),
        }
    }

    fn failure_taxonomy_trace() -> VerificationTrace {
        let taxonomy = failure_taxonomy();
        let codes = taxonomy
            .iter()
            .map(|entry| entry.code.as_str())
            .collect::<Vec<_>>();
        let all_codes_mapped = failure_codes().iter().all(|code| codes.contains(code));
        let statuses_valid = taxonomy
            .iter()
            .all(|entry| (400..=599).contains(&entry.http_status));
        let all_emit_events = taxonomy.iter().all(|entry| entry.emits_event);
        let stable_categories = taxonomy.iter().all(|entry| !entry.category.is_empty());

        VerificationTrace {
            verifier: "failure-taxonomy".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: all_codes_mapped && statuses_valid && all_emit_events && stable_categories,
            checks: vec![
                check(
                    "all-codes-mapped",
                    all_codes_mapped,
                    "every advertised failure code has taxonomy metadata",
                ),
                check(
                    "http-statuses",
                    statuses_valid,
                    "failure taxonomy uses explicit 4xx/5xx statuses",
                ),
                check(
                    "event-emission",
                    all_emit_events,
                    "failure taxonomy can be emitted as adapter.failure events",
                ),
                check(
                    "categories",
                    stable_categories,
                    "failure taxonomy entries have stable categories",
                ),
            ],
            evidence: json!({ "failureTaxonomy": taxonomy }),
        }
    }

    fn observability_redaction_trace() -> VerificationTrace {
        let raw =
            "account DU1234567 used apiToken REDACT_ME for route /v1/accounts/DU1234567/fills";
        let redacted = redact_text(raw);
        let account_masked = redacted.contains("DU***4567") && !redacted.contains("DU1234567");
        let secret_redacted = !redacted.contains("REDACT_ME") && redacted.contains("[redacted]");
        let field_redacted = !redacted.contains("apiToken") && redacted.contains("redactedField");

        VerificationTrace {
            verifier: "observability-redaction".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: account_masked && secret_redacted && field_redacted,
            checks: vec![
                check(
                    "account-mask",
                    account_masked,
                    "observability redaction masks full account ids",
                ),
                check(
                    "secret-redaction",
                    secret_redacted,
                    "observability redaction removes secret sentinel values",
                ),
                check(
                    "field-redaction",
                    field_redacted,
                    "observability redaction removes sensitive field names",
                ),
            ],
            evidence: json!({
                "redactedSample": redacted
            }),
        }
    }

    fn startup_safety_trace() -> VerificationTrace {
        let paper_gateway = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 4002,
                client_id: 42,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrPaper,
            },
            live_trading_enabled: false,
            live_trading_confirmation: None,
        });
        let paper_tws = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7497,
                client_id: 43,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrPaper,
            },
            live_trading_enabled: false,
            live_trading_confirmation: None,
        });
        let paper_rejects_live_port = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 4001,
                client_id: 44,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrPaper,
            },
            live_trading_enabled: false,
            live_trading_confirmation: None,
        });
        let live_rejects_without_gate = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 4001,
                client_id: 45,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: false,
            live_trading_confirmation: None,
        });
        let live_rejects_wrong_confirmation =
            evaluate_startup(crate::runtime_state::StartupRequest {
                endpoint: crate::adapter_contract::Endpoint {
                    host: "127.0.0.1".to_string(),
                    port: 7496,
                    client_id: 46,
                    environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
                },
                live_trading_enabled: true,
                live_trading_confirmation: Some("WRONG".to_string()),
            });
        let live_rejects_paper_port = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 4002,
                client_id: 47,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: true,
            live_trading_confirmation: Some(LIVE_TRADING_STARTUP_CONFIRMATION.to_string()),
        });
        let live_accepts_exact_gate = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7496,
                client_id: 48,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: true,
            live_trading_confirmation: Some(LIVE_TRADING_STARTUP_CONFIRMATION.to_string()),
        });
        let duplicate_client_id = evaluate_duplicate_client_id(42, &[40, 41, 42]);

        let paper_ports_approved = paper_gateway.is_approved && paper_tws.is_approved;
        let paper_live_ports_rejected = !paper_rejects_live_port.is_approved;
        let live_gates_rejected =
            !live_rejects_without_gate.is_approved && !live_rejects_wrong_confirmation.is_approved;
        let live_port_and_gate_approved =
            !live_rejects_paper_port.is_approved && live_accepts_exact_gate.is_approved;
        let duplicate_rejected = !duplicate_client_id.is_approved;

        VerificationTrace {
            verifier: "startup-safety".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: paper_ports_approved
                && paper_live_ports_rejected
                && live_gates_rejected
                && live_port_and_gate_approved
                && duplicate_rejected,
            checks: vec![
                check(
                    "paper-ports",
                    paper_ports_approved,
                    "paper accepts only Gateway/TWS paper ports",
                ),
                check(
                    "paper-rejects-live-port",
                    paper_live_ports_rejected,
                    "paper startup rejects live ports",
                ),
                check(
                    "live-gates",
                    live_gates_rejected,
                    "live startup requires enablement and exact confirmation",
                ),
                check(
                    "live-port-and-gate",
                    live_port_and_gate_approved,
                    "live startup accepts only live ports with exact gates",
                ),
                check(
                    "duplicate-client-id",
                    duplicate_rejected,
                    "duplicate client id is rejected before broker connect",
                ),
            ],
            evidence: json!({
                "paperGateway": paper_gateway,
                "paperTws": paper_tws,
                "paperRejectsLivePort": paper_rejects_live_port,
                "liveRejectsWithoutGate": live_rejects_without_gate,
                "liveRejectsWrongConfirmation": live_rejects_wrong_confirmation,
                "liveRejectsPaperPort": live_rejects_paper_port,
                "liveAcceptsExactGate": live_accepts_exact_gate,
                "duplicateClientID": duplicate_client_id
            }),
        }
    }

    fn server_time_provenance_trace() -> VerificationTrace {
        let endpoint = crate::adapter_contract::default_endpoint();
        let disconnected = BrokerSessionSnapshot::disconnected(endpoint.clone());
        let connected = BrokerSessionSnapshot::connected(endpoint.clone());
        let stale = BrokerSessionSnapshot::stale(endpoint.clone());
        let reconnecting = BrokerSessionSnapshot::reconnecting(endpoint);

        let disconnected_unavailable = disconnected.server_time.is_none()
            && disconnected.server_time_provenance.source == "unavailable";
        let connected_callback_backed = connected.is_ready()
            && connected.server_time_provenance.source == "twsReqCurrentTime"
            && !connected.server_time_provenance.heartbeat_stale;
        let stale_fails_closed = stale.connection_state.as_wire_value() == "stale"
            && stale.server_time_provenance.heartbeat_stale
            && !stale.order_id_allocation_available
            && !stale.is_ready();
        let reconnecting_blocks_order_id = reconnecting.connection_state.as_wire_value()
            == "reconnecting"
            && !reconnecting.next_valid_id_ready
            && !reconnecting.order_id_allocation_available
            && !reconnecting.is_ready();

        VerificationTrace {
            verifier: "server-time-provenance".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: disconnected_unavailable
                && connected_callback_backed
                && stale_fails_closed
                && reconnecting_blocks_order_id,
            checks: vec![
                check(
                    "disconnected-unavailable",
                    disconnected_unavailable,
                    "disconnected status has no server time and unavailable provenance",
                ),
                check(
                    "callback-backed",
                    connected_callback_backed,
                    "connected status requires callback-backed twsReqCurrentTime provenance",
                ),
                check(
                    "stale-fails-closed",
                    stale_fails_closed,
                    "stale heartbeat disables order id allocation",
                ),
                check(
                    "reconnecting-blocks-order-id",
                    reconnecting_blocks_order_id,
                    "reconnecting state clears order id readiness",
                ),
            ],
            evidence: json!({
                "disconnected": disconnected,
                "connected": connected,
                "stale": stale,
                "reconnecting": reconnecting
            }),
        }
    }

    fn broker_session_management_trace() -> VerificationTrace {
        let evidence = broker_protocol::deterministic_session_evidence();
        let callback_backed_ready = evidence.connected.is_ready()
            && evidence.connected.next_valid_id_ready
            && evidence.connected.server_time_provenance.source == "twsReqCurrentTime"
            && evidence.health_ready.is_ready;
        let stale_fails_closed = evidence.stale.connection_state.as_wire_value() == "stale"
            && evidence.stale.server_time_provenance.heartbeat_stale
            && !evidence.stale.order_id_allocation_available
            && !evidence.stale.is_ready();
        let reconnect_clears_order_id = evidence.reconnecting.connection_state.as_wire_value()
            == "reconnecting"
            && !evidence.reconnecting.next_valid_id_ready
            && !evidence.reconnecting.order_id_allocation_available
            && evidence.read_loop_failure.code == "disconnectedGateway";
        let health_rejections = !evidence.health_rejects_disconnected.is_ready
            && evidence
                .health_rejects_disconnected
                .rejections
                .iter()
                .any(|message| message.contains("connectionState"))
            && !evidence.health_rejects_wrong_endpoint.is_ready
            && evidence
                .health_rejects_wrong_endpoint
                .rejections
                .iter()
                .any(|message| message.contains("endpoint port"));
        let connection_event = evidence.connection_event.event == "connection.status"
            && evidence.connection_event.payload["connectionState"] == "connected";
        let protocol_callbacks = evidence
            .protocol_event_names
            .iter()
            .any(|event| event == "callback.nextValidId")
            && evidence
                .protocol_event_names
                .iter()
                .any(|event| event == "callback.currentTime")
            && evidence
                .protocol_event_names
                .iter()
                .any(|event| event == "callback.managedAccounts");

        VerificationTrace {
            verifier: "broker-session-management".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: evidence.startup_accepts
                && evidence.duplicate_client_rejected
                && callback_backed_ready
                && stale_fails_closed
                && reconnect_clears_order_id
                && health_rejections
                && connection_event
                && protocol_callbacks,
            checks: vec![
                check(
                    "startup-and-client-id",
                    evidence.startup_accepts && evidence.duplicate_client_rejected,
                    "startup policy and duplicate client id checks run before broker connect",
                ),
                check(
                    "callback-backed-readiness",
                    callback_backed_ready,
                    "session is connected only after nextValidId and twsReqCurrentTime callbacks",
                ),
                check(
                    "heartbeat-stale-fails-closed",
                    stale_fails_closed,
                    "stale server-time heartbeat disables order id allocation",
                ),
                check(
                    "reconnect-clears-order-id",
                    reconnect_clears_order_id,
                    "read-loop failure enters reconnecting and clears order id readiness",
                ),
                check(
                    "health-check-contract",
                    health_rejections,
                    "health checks reject disconnected, non-callback-backed, or wrong-endpoint status",
                ),
                check(
                    "connection-status-event",
                    connection_event && protocol_callbacks,
                    "protocol callbacks publish a Swift-decodable connection.status event",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn tws_wire_codec_trace() -> VerificationTrace {
        let evidence =
            tws_wire::deterministic_wire_evidence(crate::adapter_contract::default_endpoint());
        let outbound_request_codes = evidence.start_api_fields == vec!["71", "2", "42", ""]
            && evidence.req_managed_accounts_fields == vec!["17", "1"]
            && evidence.req_current_time_fields == vec!["49", "1"];
        let length_prefix_round_trip =
            evidence.split_decode_frame_count == 3 && evidence.partial_remaining_bytes > 0;
        let callbacks_drive_session = evidence.session.is_ready()
            && evidence.session.next_valid_id_ready
            && evidence.session.server_time_provenance.source == "twsReqCurrentTime"
            && evidence
                .decoded_callbacks
                .iter()
                .any(|callback| matches!(callback, tws_wire::TwsCallback::NextValidId { .. }))
            && evidence
                .decoded_callbacks
                .iter()
                .any(|callback| matches!(callback, tws_wire::TwsCallback::CurrentTime { .. }))
            && evidence
                .decoded_callbacks
                .iter()
                .any(|callback| matches!(callback, tws_wire::TwsCallback::ManagedAccounts { .. }));
        let broker_error_reconnects = evidence
            .reconnecting_after_error
            .connection_state
            .as_wire_value()
            == "reconnecting"
            && !evidence
                .reconnecting_after_error
                .order_id_allocation_available;
        let malformed_frame_rejected = evidence.malformed_error.code == "missingTrailingNul";

        VerificationTrace {
            verifier: "tws-wire-codec".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: outbound_request_codes
                && length_prefix_round_trip
                && callbacks_drive_session
                && broker_error_reconnects
                && malformed_frame_rejected,
            checks: vec![
                check(
                    "outbound-request-codes",
                    outbound_request_codes,
                    "wire codec emits startApi, reqManagedAccts, and reqCurrentTime fields",
                ),
                check(
                    "length-prefix-round-trip",
                    length_prefix_round_trip,
                    "length-prefixed TWS frames round-trip and preserve partial bytes",
                ),
                check(
                    "callbacks-drive-session",
                    callbacks_drive_session,
                    "nextValidId, currentTime, and managedAccounts callbacks drive readiness",
                ),
                check(
                    "broker-error-reconnects",
                    broker_error_reconnects,
                    "broker connectivity errors enter reconnecting and lock order allocation",
                ),
                check(
                    "malformed-frame-rejected",
                    malformed_frame_rejected,
                    "malformed wire payloads are rejected before callback routing",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    async fn tws_transport_startup_trace() -> VerificationTrace {
        let evidence = match tws_transport::deterministic_transport_evidence(
            crate::adapter_contract::default_endpoint(),
        )
        .await
        {
            Ok(evidence) => evidence,
            Err(error) => {
                return VerificationTrace {
                    verifier: "tws-transport-startup".to_string(),
                    api_version: API_VERSION.to_string(),
                    implementation: IMPLEMENTATION.to_string(),
                    is_approved: false,
                    checks: vec![check(
                        "transport-fixture",
                        false,
                        "async transport fixture failed before producing evidence",
                    )],
                    evidence: json!({ "error": error }),
                };
            }
        };

        let expected_requests = vec![
            vec![
                "71".to_string(),
                "2".to_string(),
                "42".to_string(),
                String::new(),
            ],
            vec!["17".to_string(), "1".to_string()],
            vec!["49".to_string(), "1".to_string()],
        ];
        let outbound_requests = evidence.ready_session.sent_request_fields == expected_requests
            && evidence.gateway_observed_ready_requests == expected_requests
            && evidence.gateway_observed_reconnect_requests == expected_requests;
        let ready_session =
            evidence.ready_session.termination == tws_transport::TwsTransportTermination::Ready
                && evidence.ready_session.session.is_ready()
                && evidence
                    .ready_session
                    .callbacks
                    .iter()
                    .any(|callback| matches!(callback, tws_wire::TwsCallback::NextValidId { .. }))
                && evidence
                    .ready_session
                    .callbacks
                    .iter()
                    .any(|callback| matches!(callback, tws_wire::TwsCallback::CurrentTime { .. }))
                && evidence.ready_session.callbacks.iter().any(|callback| {
                    matches!(callback, tws_wire::TwsCallback::ManagedAccounts { .. })
                });
        let reconnecting_session = evidence.reconnecting_session.termination
            == tws_transport::TwsTransportTermination::Reconnecting
            && evidence
                .reconnecting_session
                .session
                .connection_state
                .as_wire_value()
                == "reconnecting"
            && !evidence
                .reconnecting_session
                .session
                .order_id_allocation_available
            && evidence
                .reconnecting_session
                .callbacks
                .iter()
                .any(|callback| {
                    matches!(callback, tws_wire::TwsCallback::Error { code: 1100, .. })
                });
        let byte_accounting = evidence.ready_session.bytes_written > 0
            && evidence.ready_session.bytes_read > 0
            && evidence.reconnecting_session.bytes_written > 0
            && evidence.reconnecting_session.bytes_read > 0;

        VerificationTrace {
            verifier: "tws-transport-startup".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: outbound_requests && ready_session && reconnecting_session && byte_accounting,
            checks: vec![
                check(
                    "startup-requests-written",
                    outbound_requests,
                    "async transport writes startApi, reqManagedAccts, and reqCurrentTime frames",
                ),
                check(
                    "callbacks-drive-ready-session",
                    ready_session,
                    "read loop routes nextValidId, currentTime, and managedAccounts callbacks into a ready session",
                ),
                check(
                    "connectivity-error-reconnects",
                    reconnecting_session,
                    "read loop maps TWS connectivity loss into reconnecting state and locks order allocation",
                ),
                check(
                    "transport-byte-accounting",
                    byte_accounting,
                    "transport proof records bytes written and read for startup and reconnect paths",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    async fn tws_tcp_startup_trace() -> VerificationTrace {
        let evidence = match tws_transport::deterministic_tcp_startup_evidence(
            crate::adapter_contract::default_endpoint(),
        )
        .await
        {
            Ok(evidence) => evidence,
            Err(error) => {
                return VerificationTrace {
                    verifier: "tws-tcp-startup".to_string(),
                    api_version: API_VERSION.to_string(),
                    implementation: IMPLEMENTATION.to_string(),
                    is_approved: false,
                    checks: vec![check(
                        "tcp-fixture",
                        false,
                        "loopback TCP fixture failed before producing evidence",
                    )],
                    evidence: json!({ "error": error }),
                };
            }
        };

        let tcp_endpoint = evidence.endpoint.host == "127.0.0.1"
            && evidence.endpoint.port > 0
            && evidence.listener_address.starts_with("127.0.0.1:");
        let request_exchange = evidence.transcript.sent_request_fields
            == evidence.gateway_observed_requests
            && evidence.gateway_observed_requests.len() == 3;
        let ready_session =
            evidence.transcript.termination == tws_transport::TwsTransportTermination::Ready
                && evidence.transcript.session.is_ready()
                && evidence.transcript.callbacks.iter().any(|callback| {
                    matches!(callback, tws_wire::TwsCallback::ManagedAccounts { .. })
                });
        let byte_accounting =
            evidence.transcript.bytes_written > 0 && evidence.transcript.bytes_read > 0;

        VerificationTrace {
            verifier: "tws-tcp-startup".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: tcp_endpoint && request_exchange && ready_session && byte_accounting,
            checks: vec![
                check(
                    "loopback-tcp-endpoint",
                    tcp_endpoint,
                    "transport can connect over an actual loopback TCP socket",
                ),
                check(
                    "gateway-observes-startup-requests",
                    request_exchange,
                    "fake Gateway observes the same startup request frames the client writes",
                ),
                check(
                    "tcp-callbacks-drive-ready-session",
                    ready_session,
                    "callbacks read over TCP drive the broker session to ready state",
                ),
                check(
                    "tcp-byte-accounting",
                    byte_accounting,
                    "TCP proof records nonzero read and write byte counts",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    async fn broker_startup_config_trace() -> VerificationTrace {
        let endpoint = crate::adapter_contract::default_endpoint();
        let evidence = match tws_transport::deterministic_configured_startup_evidence(
            tws_transport::TwsBrokerStartupConfig {
                endpoint: endpoint.clone(),
                live_trading_enabled: false,
                live_trading_confirmation: None,
                max_callbacks: 8,
            },
        )
        .await
        {
            Ok(evidence) => evidence,
            Err(error) => {
                return VerificationTrace {
                    verifier: "broker-startup-config".to_string(),
                    api_version: API_VERSION.to_string(),
                    implementation: IMPLEMENTATION.to_string(),
                    is_approved: false,
                    checks: vec![check(
                        "configured-startup-fixture",
                        false,
                        "configured broker startup failed before producing evidence",
                    )],
                    evidence: json!({ "error": error }),
                };
            }
        };

        let live_endpoint = crate::adapter_contract::Endpoint {
            host: "127.0.0.1".to_string(),
            port: 7496,
            client_id: 52,
            environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
        };
        let live_rejection =
            tws_transport::run_configured_startup(tws_transport::TwsBrokerStartupConfig {
                endpoint: live_endpoint,
                live_trading_enabled: false,
                live_trading_confirmation: None,
                max_callbacks: 1,
            })
            .await
            .expect_err("live startup must reject before network connect");

        let policy_accepts_endpoint = evidence.startup_decision.is_approved
            && evidence.startup_decision.endpoint == endpoint
            && evidence
                .startup_decision
                .messages
                .iter()
                .any(|message| message.contains("paper endpoint accepted"));
        let configured_endpoint_preserved = evidence.transcript.endpoint == endpoint
            && evidence.transcript.session.endpoint == endpoint
            && evidence.transcript.sent_request_fields[0][2] == endpoint.client_id.to_string();
        let gateway_observed_requests =
            evidence
                .gateway_observed_requests
                .as_ref()
                .is_some_and(|requests| {
                    requests == &evidence.transcript.sent_request_fields && requests.len() == 3
                });
        let ready_session = evidence.transcript.session.is_ready()
            && evidence.transcript.termination == tws_transport::TwsTransportTermination::Ready
            && evidence.transcript.session.server_time_provenance.source == "twsReqCurrentTime";
        let live_gate_fails_closed = live_rejection.code == "startupRejected"
            && live_rejection.message.contains("enable-live-trading")
            && live_rejection
                .message
                .contains("live startup requires exact confirmation");

        VerificationTrace {
            verifier: "broker-startup-config".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: policy_accepts_endpoint
                && configured_endpoint_preserved
                && gateway_observed_requests
                && ready_session
                && live_gate_fails_closed,
            checks: vec![
                check(
                    "startup-policy-before-connect",
                    policy_accepts_endpoint && live_gate_fails_closed,
                    "configured broker startup evaluates paper/live policy before opening a socket",
                ),
                check(
                    "configured-endpoint-preserved",
                    configured_endpoint_preserved,
                    "transport transcript and status keep the configured broker endpoint identity",
                ),
                check(
                    "startup-requests-observed",
                    gateway_observed_requests,
                    "configured startup writes startApi, reqManagedAccts, and reqCurrentTime frames",
                ),
                check(
                    "configured-startup-ready",
                    ready_session,
                    "configured startup reaches ready state from callback-backed Gateway evidence",
                ),
            ],
            evidence: json!({
                "startup": evidence,
                "liveGateRejection": live_rejection
            }),
        }
    }

    async fn http_startup_state_trace() -> VerificationTrace {
        let disconnected = http_interface::AppState::default();
        let connected = http_interface::AppState::connected_fixture();
        let tcp = match http_interface::AppState::tcp_startup_fixture().await {
            Ok(state) => state,
            Err(error) => {
                return VerificationTrace {
                    verifier: "http-startup-state".to_string(),
                    api_version: API_VERSION.to_string(),
                    implementation: IMPLEMENTATION.to_string(),
                    is_approved: false,
                    checks: vec![check(
                        "tcp-startup-state",
                        false,
                        "TCP startup fixture failed before HTTP state projection",
                    )],
                    evidence: json!({ "error": error }),
                };
            }
        };

        let default_disconnected =
            disconnected.broker_session.status().connection_state == "disconnected";
        let connected_status = connected.broker_session.status().connection_state == "connected"
            && connected
                .broker_session
                .status()
                .server_time_provenance
                .source
                == "twsReqCurrentTime";
        let tcp_status = tcp.broker_session.status().connection_state == "connected"
            && tcp.broker_session.endpoint.host == "127.0.0.1"
            && tcp.broker_session.endpoint.port > 0;
        let connected_event = connected
            .event_hub
            .initial_events()
            .first()
            .is_some_and(|event| {
                event.event == "connection.status"
                    && event.payload["connectionState"] == "connected"
            });
        let tcp_event = tcp.event_hub.initial_events().first().is_some_and(|event| {
            event.event == "connection.status" && event.payload["connectionState"] == "connected"
        });
        let connected_account_state = connected.account_state.snapshot();
        let connected_market_state = connected.market_state.snapshot();
        let callback_route_stores = connected_account_state.has_replayable_events()
            && connected_account_state.flex_export_matches_fixture()
            && connected_market_state.market_events_are_replayable()
            && connected_market_state.option_chain_and_quote_are_complete();

        VerificationTrace {
            verifier: "http-startup-state".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: default_disconnected
                && connected_status
                && tcp_status
                && connected_event
                && tcp_event
                && callback_route_stores,
            checks: vec![
                check(
                    "default-fails-closed",
                    default_disconnected,
                    "default HTTP state still reports disconnected",
                ),
                check(
                    "connected-fixture-status",
                    connected_status,
                    "connected fixture projects callback-backed session status",
                ),
                check(
                    "tcp-startup-status",
                    tcp_status,
                    "TCP startup fixture projects connected loopback endpoint status",
                ),
                check(
                    "connection-event-replay",
                    connected_event && tcp_event,
                    "event replay begins with the state-specific connection.status event",
                ),
                check(
                    "callback-route-stores",
                    callback_route_stores,
                    "connected HTTP fixtures source account and market routes from shared callback stores",
                ),
            ],
            evidence: json!({
                "disconnected": disconnected.broker_session.status(),
                "connected": connected.broker_session.status(),
                "tcp": tcp.broker_session.status(),
                "connectedInitialEvent": connected.event_hub.initial_events().first(),
                "tcpInitialEvent": tcp.event_hub.initial_events().first(),
                "connectedAccountEvents": connected_account_state.event_transcript.iter().map(|event| event.event.clone()).collect::<Vec<_>>(),
                "connectedMarketEvents": connected_market_state.event_transcript.iter().map(|event| event.event.clone()).collect::<Vec<_>>()
            }),
        }
    }

    fn broker_callback_routing_trace() -> VerificationTrace {
        let evidence = broker_callback_router::deterministic_router_evidence();
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let session_callbacks = evidence.session.is_ready()
            && evidence.outcomes.iter().any(|outcome| {
                outcome.route == "protocol"
                    && outcome
                        .published_event_names
                        .iter()
                        .any(|event| event == "connection.status")
            });
        let account_callbacks = evidence
            .account_state
            .summary_for_account(PAPER_ACCOUNT_ID)
            .is_some_and(|summary| summary == account_fixture.summaries[0])
            && evidence.outcomes.iter().any(|outcome| {
                outcome.route == "account"
                    && outcome
                        .published_event_names
                        .iter()
                        .any(|event| event == "account.summary")
            });
        let market_callbacks = evidence.market_state.quote == market_fixture.quote
            && evidence.outcomes.iter().any(|outcome| {
                outcome.route == "marketData"
                    && outcome
                        .published_event_names
                        .iter()
                        .any(|event| event == "quote.snapshot")
            });
        let order_callbacks = evidence
            .order_routing_state
            .placement_acknowledgements
            .iter()
            .any(|ack| ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID)
            && evidence.outcomes.iter().any(|outcome| {
                outcome.route == "orderRouting"
                    && outcome
                        .published_event_names
                        .iter()
                        .any(|event| event == "order.status")
            });
        let wire_domain_callbacks = evidence
            .decoded_tws_callbacks
            .iter()
            .any(|callback| matches!(callback, tws_wire::TwsCallback::NextValidId { .. }))
            && evidence
                .decoded_tws_callbacks
                .iter()
                .any(|callback| matches!(callback, tws_wire::TwsCallback::CurrentTime { .. }))
            && evidence.decoded_tws_callbacks.iter().any(|callback| {
                matches!(
                    callback,
                    tws_wire::TwsCallback::Domain {
                        callback
                    } if matches!(callback.as_ref(), broker_callback_router::BrokerCallback::Account { .. })
                )
            })
            && evidence.decoded_tws_callbacks.iter().any(|callback| {
                matches!(
                    callback,
                    tws_wire::TwsCallback::Domain {
                        callback
                    } if matches!(callback.as_ref(), broker_callback_router::BrokerCallback::MarketData { .. })
                )
            })
            && evidence.decoded_tws_callbacks.iter().any(|callback| {
                matches!(
                    callback,
                    tws_wire::TwsCallback::Domain {
                        callback
                    } if matches!(callback.as_ref(), broker_callback_router::BrokerCallback::OrderRouting { .. })
                )
            });
        let event_hub_replay = [
            "connection.status",
            "account.summary",
            "quote.snapshot",
            "order.status",
        ]
        .iter()
        .all(|event| evidence.event_replay_names.iter().any(|name| name == event));

        VerificationTrace {
            verifier: "broker-callback-routing".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: session_callbacks
                && account_callbacks
                && market_callbacks
                && order_callbacks
                && wire_domain_callbacks
                && event_hub_replay,
            checks: vec![
                check(
                    "session-callback-routing",
                    session_callbacks,
                    "protocol callbacks drive session readiness and publish connection.status",
                ),
                check(
                    "account-callback-routing",
                    account_callbacks,
                    "account callbacks route through the shared account store and publish account.summary",
                ),
                check(
                    "market-callback-routing",
                    market_callbacks,
                    "market callbacks route through the shared market store and publish quote.snapshot",
                ),
                check(
                    "order-callback-routing",
                    order_callbacks,
                    "order callbacks route through the shared order-routing store and publish order.status",
                ),
                check(
                    "wire-domain-callback-routing",
                    wire_domain_callbacks,
                    "decoded TWS callback frames convert into protocol and domain router inputs",
                ),
                check(
                    "callback-router-event-replay",
                    event_hub_replay,
                    "callback router records routed domain events in the shared event hub replay",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn tws_domain_callback_decoder_trace() -> VerificationTrace {
        let evidence = broker_callback_router::deterministic_callback_record_decoder_evidence();
        let required_methods = [
            "accountSummary",
            "position",
            "orderStatus",
            "execDetails",
            "commissionReport",
            "contractDetails",
            "marketRule",
            "tickPrice",
            "historicalData",
            "historicalTicks",
            "securityDefinitionOptionParameter",
            "optionContract",
            "optionContractDetails",
            "tickOptionComputation",
            "whatIfPreview",
            "placeOrderAcknowledgement",
        ];
        let method_coverage = required_methods.iter().all(|method| {
            evidence
                .decoded_methods
                .iter()
                .any(|decoded| decoded == method)
        });
        let callback_records_decode = evidence.decoded_tws_callbacks.iter().all(|callback| {
            matches!(
                callback,
                tws_wire::TwsCallback::CallbackRecord { callback, .. }
                    if matches!(
                        callback.as_ref(),
                        broker_callback_router::BrokerCallback::Account { .. }
                            | broker_callback_router::BrokerCallback::MarketData { .. }
                            | broker_callback_router::BrokerCallback::OrderRouting { .. }
                    )
            )
        });
        let route_coverage = ["account", "marketData", "orderRouting"]
            .iter()
            .all(|route| {
                evidence
                    .outcomes
                    .iter()
                    .any(|outcome| outcome.route == *route)
            });
        let account_projection = evidence
            .account_state
            .summary_for_account(PAPER_ACCOUNT_ID)
            .is_some()
            && evidence
                .account_state
                .positions_for_account(PAPER_ACCOUNT_ID)
                .iter()
                .any(|position| {
                    position.instrument.con_id == crate::market_read_model::AAPL_CON_ID
                })
            && evidence
                .account_state
                .fills_for_account(PAPER_ACCOUNT_ID)
                .iter()
                .any(|fill| fill.commission_reported_at.is_some());
        let market_projection = evidence.market_state.quote.contract.con_id
            == crate::market_read_model::AAPL_CON_ID
            && evidence.market_state.historical_bars.bars.len() >= 2
            && evidence
                .market_state
                .option_quote
                .greeks
                .as_ref()
                .is_some_and(|greeks| greeks.delta.as_deref() == Some("0.48"));
        let order_projection = evidence
            .order_routing_state
            .previews
            .iter()
            .any(|preview| preview.intent_id == order_routing::PAPER_ORDER_REQUEST_ID)
            && evidence
                .order_routing_state
                .placement_acknowledgements
                .iter()
                .any(|ack| ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID);
        let event_replay = [
            "account.summary",
            "position.snapshot",
            "order.status",
            "fill.report",
            "contract.details",
            "quote.snapshot",
            "bars.snapshot",
            "ticks.snapshot",
            "option.chain",
            "option.contract",
            "option.contract-details",
            "option.quote",
        ]
        .iter()
        .all(|event| evidence.event_replay_names.iter().any(|name| name == event));

        VerificationTrace {
            verifier: "tws-domain-callback-decoder".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: method_coverage
                && callback_records_decode
                && route_coverage
                && account_projection
                && market_projection
                && order_projection
                && event_replay,
            checks: vec![
                check(
                    "e-wrapper-method-coverage",
                    method_coverage,
                    "callback-record decoder covers account, position, order, fill, commission, market-data, option, preview, and acknowledgement methods",
                ),
                check(
                    "callback-records-decode",
                    callback_records_decode,
                    "EWrapper-style callback records decode into typed broker callback router inputs",
                ),
                check(
                    "router-route-coverage",
                    route_coverage,
                    "decoded callback records reach account, market-data, and order-routing stores",
                ),
                check(
                    "account-projection",
                    account_projection,
                    "account callback records reconstruct summaries, positions, order status, fills, and commission updates",
                ),
                check(
                    "market-projection",
                    market_projection,
                    "market callback records reconstruct contract details, quotes, bars, ticks, options, and greeks",
                ),
                check(
                    "order-routing-projection",
                    order_projection,
                    "order callback records reconstruct preview and asynchronous placement acknowledgement state",
                ),
                check(
                    "event-replay",
                    event_replay,
                    "decoded callback records publish Swift-compatible event names through the shared event hub",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn tws_field_callback_decoder_trace() -> VerificationTrace {
        let evidence = broker_callback_router::deterministic_field_callback_decoder_evidence();
        let required_methods = [
            "accountSummary",
            "position",
            "orderStatus",
            "tickPrice",
            "placeOrderAcknowledgement",
        ];
        let method_coverage = required_methods.iter().all(|method| {
            evidence
                .decoded_methods
                .iter()
                .any(|decoded| decoded == method)
        });
        let field_records_decode = evidence.decoded_tws_callbacks.iter().all(|callback| {
            matches!(
                callback,
                tws_wire::TwsCallback::FieldRecord { callback, .. }
                    if matches!(
                        callback.as_ref(),
                        broker_callback_router::BrokerCallback::Account { .. }
                            | broker_callback_router::BrokerCallback::MarketData { .. }
                            | broker_callback_router::BrokerCallback::OrderRouting { .. }
                    )
            )
        });
        let field_pair_accounting = evidence.field_pair_counts == vec![8, 12, 14, 19, 9];
        let route_coverage = ["account", "marketData", "orderRouting"]
            .iter()
            .all(|route| {
                evidence
                    .outcomes
                    .iter()
                    .any(|outcome| outcome.route == *route)
            });
        let account_projection = evidence
            .account_state
            .summary_for_account(PAPER_ACCOUNT_ID)
            .is_some()
            && evidence
                .account_state
                .positions_for_account(PAPER_ACCOUNT_ID)
                .iter()
                .any(|position| {
                    position.instrument.con_id == crate::market_read_model::AAPL_CON_ID
                })
            && evidence
                .account_state
                .open_orders_for_account(PAPER_ACCOUNT_ID)
                .iter()
                .any(|status| {
                    status.broker_order_id == "1000"
                        && status.status == "submitted"
                        && status.remaining_quantity == "2"
                });
        let market_projection = evidence.market_state.quote.contract.con_id
            == crate::market_read_model::AAPL_CON_ID
            && evidence.market_state.quote.bid == "208.10"
            && evidence.market_state.quote.ask == "208.14";
        let order_projection = evidence
            .order_routing_state
            .placement_acknowledgements
            .iter()
            .any(|ack| ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID);
        let event_replay = [
            "account.summary",
            "position.snapshot",
            "order.status",
            "quote.snapshot",
        ]
        .iter()
        .all(|event| evidence.event_replay_names.iter().any(|name| name == event));
        let malformed_rejects = evidence.malformed_error.code == "invalidFieldCallback";

        VerificationTrace {
            verifier: "tws-field-callback-decoder".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: method_coverage
                && field_records_decode
                && field_pair_accounting
                && route_coverage
                && account_projection
                && market_projection
                && order_projection
                && event_replay
                && malformed_rejects,
            checks: vec![
                check(
                    "field-method-coverage",
                    method_coverage,
                    "field callback decoder covers account summary, position, order status, quote, and placement acknowledgement methods",
                ),
                check(
                    "field-records-decode",
                    field_records_decode,
                    "TWS-framed key/value field records decode into typed broker callback router inputs without JSON payloads",
                ),
                check(
                    "field-pair-accounting",
                    field_pair_accounting,
                    "deterministic field records retain expected key/value pair counts for parser coverage",
                ),
                check(
                    "router-route-coverage",
                    route_coverage,
                    "decoded field records reach account, market-data, and order-routing stores",
                ),
                check(
                    "account-projection",
                    account_projection,
                    "field records reconstruct account summary, position snapshot, and order status state",
                ),
                check(
                    "market-projection",
                    market_projection,
                    "field records reconstruct quote state with lossless decimal strings",
                ),
                check(
                    "order-routing-projection",
                    order_projection,
                    "field records reconstruct asynchronous placement acknowledgement state",
                ),
                check(
                    "event-replay",
                    event_replay,
                    "decoded field records publish Swift-compatible event names through the shared event hub",
                ),
                check(
                    "malformed-field-rejection",
                    malformed_rejects,
                    "odd key/value field counts are rejected before router projection",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn http_domain_callback_projection_trace() -> VerificationTrace {
        let mut state = http_interface::AppState::connected_fixture();
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let mut summary = account_fixture.summaries[0].clone();
        summary.net_liquidation = "250000.42".to_string();
        summary.buying_power = "125000.21".to_string();
        summary.captured_at = "2027-01-15T18:31:00Z".to_string();
        let mut order_status = account_fixture.open_orders[0].clone();
        order_status.remaining_quantity = "3".to_string();
        order_status.updated_at = "2027-01-15T18:31:01Z".to_string();
        let mut quote = market_fixture.quote.clone();
        quote.bid = "209.01".to_string();
        quote.ask = "209.05".to_string();
        quote.quote_timestamp = "2027-01-15T18:31:02Z".to_string();
        quote.captured_at = "2027-01-15T18:31:02.100Z".to_string();
        let paper_order = order_routing::paper_order_body();
        let paper_idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let mut acknowledgement =
            order_routing::paper_acknowledgement(&paper_order, Some(&paper_idempotency_key), false)
                .expect("deterministic paper acknowledgement");
        acknowledgement.broker_order_id = "IBKR-HTTP-CB-9001".to_string();
        acknowledgement.acknowledged_at = "2027-01-15T18:31:03Z".to_string();

        let decoded_tws_callbacks = [
            tws_wire::callback_record_fields("accountSummary", &summary)
                .expect("accountSummary callback record"),
            tws_wire::callback_record_fields("orderStatus", &order_status)
                .expect("orderStatus callback record"),
            tws_wire::callback_record_fields("tickPrice", &quote)
                .expect("tickPrice callback record"),
            tws_wire::callback_record_fields("placeOrderAcknowledgement", &acknowledgement)
                .expect("placeOrderAcknowledgement callback record"),
        ]
        .into_iter()
        .map(|fields| {
            tws_wire::TwsFrame::new(fields)
                .and_then(|frame| tws_wire::decode_callback(&frame))
                .expect("HTTP projection callback record decodes")
        })
        .collect::<Vec<_>>();

        let mut outcomes = Vec::new();
        for callback in &decoded_tws_callbacks {
            if let Some(outcome) = state.record_tws_callback(callback) {
                outcomes.push(outcome);
            }
        }

        let account_snapshot = state.account_state.snapshot();
        let market_snapshot = state.market_state.snapshot();
        let order_routing_snapshot = state.order_routing_state.snapshot();
        let projected_summary = account_snapshot.summary_for_account(PAPER_ACCOUNT_ID);
        let projected_open_orders = account_snapshot.open_orders_for_account(PAPER_ACCOUNT_ID);
        let projected_quote = market_snapshot.quote_for_con_id(AAPL_CON_ID);
        let event_replay_names = state
            .event_hub
            .replay()
            .iter()
            .map(|event| event.event.clone())
            .collect::<Vec<_>>();
        let decoded_all_records = decoded_tws_callbacks
            .iter()
            .all(|callback| matches!(callback, tws_wire::TwsCallback::CallbackRecord { .. }));
        let route_coverage = ["account", "marketData", "orderRouting"]
            .iter()
            .all(|route| outcomes.iter().any(|outcome| outcome.route == *route));
        let account_http_projection = projected_summary
            .as_ref()
            .is_some_and(|summary| summary.net_liquidation == "250000.42")
            && projected_open_orders.iter().any(|status| {
                status.broker_order_id == order_status.broker_order_id
                    && status.remaining_quantity == "3"
            });
        let market_http_projection = projected_quote
            .as_ref()
            .is_some_and(|quote| quote.bid == "209.01" && quote.ask == "209.05");
        let order_routing_projection = order_routing_snapshot
            .placement_acknowledgements
            .iter()
            .any(|ack| ack.broker_order_id == "IBKR-HTTP-CB-9001");
        let event_replay_projection = ["account.summary", "order.status", "quote.snapshot"]
            .iter()
            .all(|event| event_replay_names.iter().any(|name| name == event));

        VerificationTrace {
            verifier: "http-domain-callback-projection".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: decoded_all_records
                && route_coverage
                && account_http_projection
                && market_http_projection
                && order_routing_projection
                && event_replay_projection,
            checks: vec![
                check(
                    "callback-record-input",
                    decoded_all_records,
                    "EWrapper-style callback records decode before reaching AppState",
                ),
                check(
                    "app-state-route-coverage",
                    route_coverage,
                    "AppState routes decoded callbacks into account, market-data, and order-routing stores",
                ),
                check(
                    "account-http-read-model",
                    account_http_projection,
                    "account summary and open-order read models reflect callback-updated values",
                ),
                check(
                    "market-http-read-model",
                    market_http_projection,
                    "quote read model reflects callback-updated bid/ask values",
                ),
                check(
                    "order-routing-read-model",
                    order_routing_projection,
                    "paper placement acknowledgements are retained by the AppState order-routing store",
                ),
                check(
                    "event-replay-projection",
                    event_replay_projection,
                    "callback-updated account, order, and quote events are published through the AppState event hub",
                ),
            ],
            evidence: json!({
                "decodedCallbackCount": decoded_tws_callbacks.len(),
                "outcomes": outcomes,
                "status": state.broker_session.status(),
                "projectedSummary": projected_summary,
                "projectedOpenOrders": projected_open_orders,
                "projectedQuote": projected_quote,
                "projectedOrderRouting": order_routing_snapshot,
                "eventReplayNames": event_replay_names
            }),
        }
    }

    fn http_field_callback_projection_trace() -> VerificationTrace {
        let mut state = http_interface::AppState::connected_fixture();
        let account_fixture = AccountStateFixture::deterministic();
        let market_fixture = MarketDataFixture::deterministic();
        let paper_order = order_routing::paper_order_body();
        let paper_idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let mut acknowledgement =
            order_routing::paper_acknowledgement(&paper_order, Some(&paper_idempotency_key), false)
                .expect("deterministic paper acknowledgement");
        acknowledgement.broker_order_id = "IBKR-HTTP-FIELD-9003".to_string();
        acknowledgement.acknowledged_at = "2027-01-15T18:33:03Z".to_string();

        let mut order_status = account_fixture.open_orders[0].clone();
        order_status.remaining_quantity = "1".to_string();
        order_status.updated_at = "2027-01-15T18:33:01Z".to_string();

        let decoded_tws_callbacks = [
            tws_wire::field_callback_fields(
                "accountSummary",
                [
                    ("accountID", PAPER_ACCOUNT_ID.to_string()),
                    ("displayName", "IBKR Paper Field".to_string()),
                    ("environment", "ibkrPaper".to_string()),
                    ("permissions", "stocks,options,paper-orders".to_string()),
                    ("netLiquidation", "260000.42".to_string()),
                    ("buyingPower", "130000.21".to_string()),
                    ("currency", "USD".to_string()),
                    ("capturedAt", "2027-01-15T18:33:00Z".to_string()),
                ],
            )
            .expect("accountSummary field record"),
            tws_wire::field_callback_fields(
                "orderStatus",
                [
                    ("brokerOrderID", order_status.broker_order_id.clone()),
                    (
                        "permanentID",
                        order_status.permanent_id.clone().unwrap_or_default(),
                    ),
                    ("clientID", order_status.client_id.to_string()),
                    ("intentID", order_status.intent_id.clone()),
                    ("accountID", order_status.account_id.clone()),
                    ("environment", "ibkrPaper".to_string()),
                    ("status", order_status.status.clone()),
                    ("submittedAt", order_status.submitted_at.clone()),
                    ("updatedAt", order_status.updated_at.clone()),
                    ("filledQuantity", order_status.filled_quantity.clone()),
                    ("remainingQuantity", order_status.remaining_quantity.clone()),
                    (
                        "averageFillPrice",
                        order_status.average_fill_price.clone().unwrap_or_default(),
                    ),
                    ("parentBrokerOrderID", String::new()),
                    ("ocaGroup", String::new()),
                ],
            )
            .expect("orderStatus field record"),
            tws_wire::field_callback_fields(
                "tickPrice",
                [
                    ("conID", market_fixture.quote.contract.con_id.to_string()),
                    ("symbol", market_fixture.quote.contract.symbol.clone()),
                    (
                        "securityType",
                        market_fixture.quote.contract.security_type.clone(),
                    ),
                    ("exchange", market_fixture.quote.contract.exchange.clone()),
                    (
                        "primaryExchange",
                        market_fixture
                            .quote
                            .contract
                            .primary_exchange
                            .clone()
                            .unwrap_or_default(),
                    ),
                    ("currency", market_fixture.quote.contract.currency.clone()),
                    (
                        "localSymbol",
                        market_fixture
                            .quote
                            .contract
                            .local_symbol
                            .clone()
                            .unwrap_or_default(),
                    ),
                    (
                        "tradingClass",
                        market_fixture
                            .quote
                            .contract
                            .trading_class
                            .clone()
                            .unwrap_or_default(),
                    ),
                    (
                        "timezoneIdentifier",
                        market_fixture
                            .quote
                            .contract
                            .timezone_identifier
                            .clone()
                            .unwrap_or_default(),
                    ),
                    (
                        "marketDataType",
                        market_fixture.quote.market_data_type.clone(),
                    ),
                    ("bid", "211.01".to_string()),
                    ("ask", "211.05".to_string()),
                    ("last", "211.03".to_string()),
                    ("bidSize", "120".to_string()),
                    ("askSize", "220".to_string()),
                    ("lastSize", "60".to_string()),
                    ("quoteTimestamp", "2027-01-15T18:33:02Z".to_string()),
                    ("capturedAt", "2027-01-15T18:33:02.100Z".to_string()),
                ],
            )
            .expect("tickPrice field record"),
            tws_wire::field_callback_fields(
                "placeOrderAcknowledgement",
                [
                    ("requestID", acknowledgement.request_id.clone()),
                    ("idempotencyKey", acknowledgement.idempotency_key.clone()),
                    ("brokerOrderID", acknowledgement.broker_order_id.clone()),
                    ("accountID", acknowledgement.account_id.clone()),
                    ("environment", "ibkrPaper".to_string()),
                    ("status", acknowledgement.status.clone()),
                    ("acknowledgedAt", acknowledgement.acknowledged_at.clone()),
                    (
                        "lifecycleStateSource",
                        acknowledgement.lifecycle_state_source.clone(),
                    ),
                    ("message", acknowledgement.message.clone()),
                ],
            )
            .expect("placeOrderAcknowledgement field record"),
        ]
        .into_iter()
        .map(|fields| {
            tws_wire::TwsFrame::new(fields)
                .and_then(|frame| tws_wire::decode_callback(&frame))
                .expect("HTTP projection field record decodes")
        })
        .collect::<Vec<_>>();

        let mut outcomes = Vec::new();
        for callback in &decoded_tws_callbacks {
            if let Some(outcome) = state.record_tws_callback(callback) {
                outcomes.push(outcome);
            }
        }

        let account_snapshot = state.account_state.snapshot();
        let market_snapshot = state.market_state.snapshot();
        let order_routing_snapshot = state.order_routing_state.snapshot();
        let projected_summary = account_snapshot.summary_for_account(PAPER_ACCOUNT_ID);
        let projected_open_orders = account_snapshot.open_orders_for_account(PAPER_ACCOUNT_ID);
        let projected_quote = market_snapshot.quote_for_con_id(AAPL_CON_ID);
        let event_replay_names = state
            .event_hub
            .replay()
            .iter()
            .map(|event| event.event.clone())
            .collect::<Vec<_>>();
        let decoded_all_field_records = decoded_tws_callbacks
            .iter()
            .all(|callback| matches!(callback, tws_wire::TwsCallback::FieldRecord { .. }));
        let route_coverage = ["account", "marketData", "orderRouting"]
            .iter()
            .all(|route| outcomes.iter().any(|outcome| outcome.route == *route));
        let account_http_projection = projected_summary.as_ref().is_some_and(|summary| {
            summary.net_liquidation == "260000.42"
                && summary.buying_power == "130000.21"
                && summary.account.display_name == "IBKR Paper Field"
        }) && projected_open_orders.iter().any(|status| {
            status.broker_order_id == order_status.broker_order_id
                && status.remaining_quantity == "1"
        });
        let market_http_projection = projected_quote
            .as_ref()
            .is_some_and(|quote| quote.bid == "211.01" && quote.ask == "211.05");
        let order_routing_projection = order_routing_snapshot
            .placement_acknowledgements
            .iter()
            .any(|ack| ack.broker_order_id == "IBKR-HTTP-FIELD-9003");
        let event_replay_projection = ["account.summary", "order.status", "quote.snapshot"]
            .iter()
            .all(|event| event_replay_names.iter().any(|name| name == event));

        VerificationTrace {
            verifier: "http-field-callback-projection".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: decoded_all_field_records
                && route_coverage
                && account_http_projection
                && market_http_projection
                && order_routing_projection
                && event_replay_projection,
            checks: vec![
                check(
                    "field-record-input",
                    decoded_all_field_records,
                    "key/value field callback records decode before reaching AppState",
                ),
                check(
                    "app-state-route-coverage",
                    route_coverage,
                    "AppState routes decoded field callbacks into account, market-data, and order-routing stores",
                ),
                check(
                    "account-http-read-model",
                    account_http_projection,
                    "account summary and open-order read models reflect field-callback updated values",
                ),
                check(
                    "market-http-read-model",
                    market_http_projection,
                    "quote read model reflects field-callback updated bid/ask values",
                ),
                check(
                    "order-routing-read-model",
                    order_routing_projection,
                    "paper placement acknowledgements from field callbacks are retained by the AppState order-routing store",
                ),
                check(
                    "event-replay-projection",
                    event_replay_projection,
                    "field-callback updated account, order, and quote events are published through the AppState event hub",
                ),
            ],
            evidence: json!({
                "decodedCallbackCount": decoded_tws_callbacks.len(),
                "outcomes": outcomes,
                "status": state.broker_session.status(),
                "projectedSummary": projected_summary,
                "projectedOpenOrders": projected_open_orders,
                "projectedQuote": projected_quote,
                "projectedOrderRouting": order_routing_snapshot,
                "eventReplayNames": event_replay_names
            }),
        }
    }

    async fn tws_domain_stream_http_projection_trace() -> VerificationTrace {
        let evidence = match tws_transport::deterministic_app_state_callback_stream_evidence(
            crate::adapter_contract::default_endpoint(),
        )
        .await
        {
            Ok(evidence) => evidence,
            Err(error) => {
                return VerificationTrace {
                    verifier: "tws-domain-stream-http-projection".to_string(),
                    api_version: API_VERSION.to_string(),
                    implementation: IMPLEMENTATION.to_string(),
                    is_approved: false,
                    checks: vec![check(
                        "stream-fixture-runs",
                        false,
                        "deterministic post-ready callback stream failed",
                    )],
                    evidence: json!(error),
                };
            }
        };
        let startup_ready = evidence.startup.termination
            == tws_transport::TwsTransportTermination::Ready
            && evidence.startup.session.is_ready();
        let startup_requests = [
            tws_wire::OUT_START_API,
            tws_wire::OUT_REQ_MANAGED_ACCOUNTS,
            tws_wire::OUT_REQ_CURRENT_TIME,
        ]
        .iter()
        .all(|message_id| {
            evidence
                .gateway_observed_requests
                .iter()
                .any(|fields| fields.first().is_some_and(|field| field == message_id))
        });
        let post_ready_callback_records = evidence.post_ready_callbacks.len() == 4
            && evidence
                .post_ready_callbacks
                .iter()
                .all(|callback| matches!(callback, tws_wire::TwsCallback::CallbackRecord { .. }));
        let app_state_projection = evidence.app_state_status.connection_state == "connected"
            && evidence
                .projected_summary_net_liquidation
                .as_deref()
                .is_some_and(|value| value == "275000.11")
            && evidence
                .projected_quote_bid
                .as_deref()
                .is_some_and(|value| value == "210.01")
            && evidence
                .projected_order_acknowledgements
                .iter()
                .any(|broker_order_id| broker_order_id == "IBKR-STREAM-CB-9002");
        let event_replay_projection = [
            "connection.status",
            "account.summary",
            "order.status",
            "quote.snapshot",
        ]
        .iter()
        .all(|event| evidence.event_replay_names.iter().any(|name| name == event));
        let transport_accounting =
            evidence.startup.bytes_written > 0 && evidence.post_ready_bytes_read > 0;

        VerificationTrace {
            verifier: "tws-domain-stream-http-projection".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: startup_ready
                && startup_requests
                && post_ready_callback_records
                && app_state_projection
                && event_replay_projection
                && transport_accounting,
            checks: vec![
                check(
                    "startup-ready-before-domain-stream",
                    startup_ready,
                    "TWS transport reaches callback-backed readiness before domain callbacks are consumed",
                ),
                check(
                    "startup-requests-observed",
                    startup_requests,
                    "fake Gateway observes startApi, reqManagedAccts, and reqCurrentTime before sending callbacks",
                ),
                check(
                    "post-ready-callback-records",
                    post_ready_callback_records,
                    "post-ready stream frames decode into typed callback records",
                ),
                check(
                    "http-serving-state-projection",
                    app_state_projection,
                    "post-ready callbacks mutate the AppState account, market-data, and order-routing read models",
                ),
                check(
                    "event-replay-projection",
                    event_replay_projection,
                    "post-ready callback events are published through the AppState event hub",
                ),
                check(
                    "transport-byte-accounting",
                    transport_accounting,
                    "startup and post-ready callback reads account for bytes on the TWS stream",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    async fn tws_field_stream_http_projection_trace() -> VerificationTrace {
        let evidence = match tws_transport::deterministic_app_state_field_callback_stream_evidence(
            crate::adapter_contract::default_endpoint(),
        )
        .await
        {
            Ok(evidence) => evidence,
            Err(error) => {
                return VerificationTrace {
                    verifier: "tws-field-stream-http-projection".to_string(),
                    api_version: API_VERSION.to_string(),
                    implementation: IMPLEMENTATION.to_string(),
                    is_approved: false,
                    checks: vec![check(
                        "stream-fixture-runs",
                        false,
                        "deterministic post-ready field callback stream failed",
                    )],
                    evidence: json!(error),
                };
            }
        };
        let startup_ready = evidence.startup.termination
            == tws_transport::TwsTransportTermination::Ready
            && evidence.startup.session.is_ready();
        let startup_requests = [
            tws_wire::OUT_START_API,
            tws_wire::OUT_REQ_MANAGED_ACCOUNTS,
            tws_wire::OUT_REQ_CURRENT_TIME,
        ]
        .iter()
        .all(|message_id| {
            evidence
                .gateway_observed_requests
                .iter()
                .any(|fields| fields.first().is_some_and(|field| field == message_id))
        });
        let post_ready_field_records = evidence.post_ready_callbacks.len() == 4
            && evidence
                .post_ready_callbacks
                .iter()
                .all(|callback| matches!(callback, tws_wire::TwsCallback::FieldRecord { .. }));
        let app_state_projection = evidence.app_state_status.connection_state == "connected"
            && evidence
                .projected_summary_net_liquidation
                .as_deref()
                .is_some_and(|value| value == "285000.33")
            && evidence
                .projected_quote_bid
                .as_deref()
                .is_some_and(|value| value == "212.01")
            && evidence
                .projected_order_acknowledgements
                .iter()
                .any(|broker_order_id| broker_order_id == "IBKR-STREAM-FIELD-9004");
        let event_replay_projection = [
            "connection.status",
            "account.summary",
            "order.status",
            "quote.snapshot",
        ]
        .iter()
        .all(|event| evidence.event_replay_names.iter().any(|name| name == event));
        let transport_accounting =
            evidence.startup.bytes_written > 0 && evidence.post_ready_bytes_read > 0;

        VerificationTrace {
            verifier: "tws-field-stream-http-projection".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: startup_ready
                && startup_requests
                && post_ready_field_records
                && app_state_projection
                && event_replay_projection
                && transport_accounting,
            checks: vec![
                check(
                    "startup-ready-before-field-stream",
                    startup_ready,
                    "TWS transport reaches callback-backed readiness before field callbacks are consumed",
                ),
                check(
                    "startup-requests-observed",
                    startup_requests,
                    "fake Gateway observes startApi, reqManagedAccts, and reqCurrentTime before sending field callbacks",
                ),
                check(
                    "post-ready-field-records",
                    post_ready_field_records,
                    "post-ready stream frames decode into typed key/value field records",
                ),
                check(
                    "http-serving-state-projection",
                    app_state_projection,
                    "post-ready field callbacks mutate the AppState account, market-data, and order-routing read models",
                ),
                check(
                    "event-replay-projection",
                    event_replay_projection,
                    "post-ready field callback events are published through the AppState event hub",
                ),
                check(
                    "transport-byte-accounting",
                    transport_accounting,
                    "startup and post-ready field callback reads account for bytes on the TWS stream",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn account_state_trace() -> VerificationTrace {
        let fixture = AccountStateFixture::deterministic();
        let paper_live_split = fixture.paper_live_accounts_are_distinct();
        let summaries_scoped = fixture.summaries_are_account_scoped();
        let positions_include_option = fixture.positions_include_option_exercise_source();
        let read_routes_decode = fixture.summary_for_account(PAPER_ACCOUNT_ID).is_some()
            && !fixture.positions_for_account(PAPER_ACCOUNT_ID).is_empty()
            && fixture
                .accounts
                .iter()
                .all(|account| !account.account_id.is_empty());
        let exact_decimal_strings = fixture.summaries.iter().all(|summary| {
            summary.net_liquidation.contains('.') && summary.buying_power.contains('.')
        }) && fixture
            .positions
            .iter()
            .all(|position| !position.average_cost.is_empty());

        VerificationTrace {
            verifier: "account-state".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: paper_live_split
                && summaries_scoped
                && positions_include_option
                && read_routes_decode
                && exact_decimal_strings,
            checks: vec![
                check(
                    "paper-live-account-split",
                    paper_live_split,
                    "managed accounts keep paper/live ids, permissions, and environment flags distinct",
                ),
                check(
                    "summary-provenance",
                    summaries_scoped,
                    "account summaries carry account, currency, and non-negative decimal strings",
                ),
                check(
                    "option-position-source",
                    positions_include_option,
                    "position snapshots include option data required before exercise/lapse safety",
                ),
                check(
                    "read-route-shapes",
                    read_routes_decode,
                    "accounts, summaries, and positions expose Swift-compatible response shapes",
                ),
                check(
                    "lossless-decimal-strings",
                    exact_decimal_strings,
                    "account and position values remain decimal strings instead of float-normalized values",
                ),
            ],
            evidence: json!({
                "accounts": fixture.accounts,
                "summaries": fixture.summaries,
                "positions": fixture.positions
            }),
        }
    }

    fn account_callback_state_trace() -> VerificationTrace {
        let evidence = AccountStateFixture::deterministic_callback_evidence();
        let state = &evidence.account_state;
        let fixture = AccountStateFixture::deterministic();
        let managed_accounts =
            state.accounts == fixture.accounts && state.paper_live_accounts_are_distinct();
        let summaries_positions = state.summaries == fixture.summaries
            && state.positions == fixture.positions
            && state.positions_include_option_exercise_source();
        let latest_order_projection = state.open_orders == fixture.open_orders
            && state.completed_orders == fixture.completed_orders
            && state.has_parent_oca_linkage();
        let fill_commission_projection = state.fills == fixture.fills
            && state.late_commission_update_republishes_fill()
            && state.lifecycle_is_sorted_and_commissioned();
        let flex_export = state.flex_export_matches_fixture()
            && evidence
                .flex_export_rows
                .iter()
                .all(|row| row.account_id == PAPER_ACCOUNT_ID && !row.commission.is_empty());
        let replayable_events = state.has_replayable_events()
            && evidence
                .event_names
                .iter()
                .any(|event| event == "fill.report")
            && evidence
                .event_names
                .iter()
                .any(|event| event == "order.status");

        VerificationTrace {
            verifier: "account-callback-state".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: managed_accounts
                && summaries_positions
                && latest_order_projection
                && fill_commission_projection
                && flex_export
                && replayable_events,
            checks: vec![
                check(
                    "managed-accounts-callback",
                    managed_accounts,
                    "managed-account callback state preserves paper/live account split",
                ),
                check(
                    "summary-position-callbacks",
                    summaries_positions,
                    "account summary and position callbacks rebuild Swift-compatible read models",
                ),
                check(
                    "latest-order-projection",
                    latest_order_projection,
                    "order status callbacks project latest open/completed order state",
                ),
                check(
                    "fill-commission-callbacks",
                    fill_commission_projection,
                    "fill and commission callbacks update fill reports and lifecycle cache",
                ),
                check(
                    "flex-export-from-callbacks",
                    flex_export,
                    "callback-backed fills export Flex reconciliation rows",
                ),
                check(
                    "callback-events-replayable",
                    replayable_events,
                    "callback-backed account, position, order, and fill events are replayable",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn order_lifecycle_trace() -> VerificationTrace {
        let fixture = AccountStateFixture::deterministic();
        let account_scoped = fixture.reconciliation_is_account_scoped();
        let parent_oca_linkage = fixture.has_parent_oca_linkage();
        let lifecycle_sorted = fixture.lifecycle_is_sorted_and_commissioned();
        let late_commission_update = fixture.late_commission_update_republishes_fill();
        let replayable_events = fixture.has_replayable_events();
        let flex_export = fixture.flex_export_matches_fixture();
        let flex_export_rows = fixture.flex_export_rows(PAPER_ACCOUNT_ID);

        VerificationTrace {
            verifier: "order-lifecycle".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: account_scoped
                && parent_oca_linkage
                && lifecycle_sorted
                && late_commission_update
                && replayable_events
                && flex_export,
            checks: vec![
                check(
                    "account-scoped-reconciliation",
                    account_scoped,
                    "open orders, completed orders, and fills are filtered to account/environment provenance",
                ),
                check(
                    "parent-oca-linkage",
                    parent_oca_linkage,
                    "order status snapshots preserve parent order and OCA bracket linkage",
                ),
                check(
                    "sorted-lifecycle-cache",
                    lifecycle_sorted,
                    "lifecycle records keep sorted status and fill timelines with commission summary fields",
                ),
                check(
                    "late-commission-update",
                    late_commission_update,
                    "late commission callbacks update the fill and republish fill.report",
                ),
                check(
                    "event-names",
                    replayable_events,
                    "account.summary, position.snapshot, order.status, and fill.report events are replayable",
                ),
                check(
                    "flex-export-shape",
                    flex_export,
                    "broker fills export normalized fields used by Flex reconciliation",
                ),
            ],
            evidence: json!({
                "openOrders": fixture.open_orders,
                "completedOrders": fixture.completed_orders,
                "fills": fixture.fills,
                "lifecycleRecords": fixture.lifecycle_records,
                "initialFillEvent": fixture.initial_fill_event,
                "commissionUpdateEvent": fixture.commission_update_event,
                "eventTranscript": fixture.event_transcript,
                "flexExportRows": flex_export_rows
            }),
        }
    }

    fn market_data_callback_state_trace() -> VerificationTrace {
        let evidence = MarketDataFixture::deterministic_callback_evidence();
        let state = &evidence.market_state;
        let fixture = MarketDataFixture::deterministic();
        let contract_callbacks = state.stock_details == fixture.stock_details
            && state.option_details == fixture.option_details
            && state.market_rule == fixture.market_rule
            && state.contract_shapes_are_valid()
            && state.market_rule_is_sorted_and_aligned();
        let quote_history_callbacks = state.quote == fixture.quote
            && state.historical_bars == fixture.historical_bars
            && state.historical_ticks == fixture.historical_ticks
            && state.quote_is_fresh_and_ordered()
            && state.bars_and_ticks_are_sorted();
        let option_callbacks = state.option_chain == fixture.option_chain
            && state.option_contract == fixture.option_contract
            && state.option_quote == fixture.option_quote
            && state.option_chain_and_quote_are_complete();
        let pacing_callbacks =
            state.pacing == fixture.pacing && state.pacing_rules_are_fail_closed();
        let replayable_events = state.market_event_payloads_match(&fixture)
            && state.market_events_are_replayable()
            && evidence
                .event_names
                .iter()
                .any(|event| event == "quote.snapshot")
            && evidence
                .event_names
                .iter()
                .any(|event| event == "option.quote");
        let callback_count = evidence.callback_count == fixture.broker_callback_transcript().len();

        VerificationTrace {
            verifier: "market-data-callback-state".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: contract_callbacks
                && quote_history_callbacks
                && option_callbacks
                && pacing_callbacks
                && replayable_events
                && callback_count,
            checks: vec![
                check(
                    "contract-callbacks",
                    contract_callbacks,
                    "contract details and market-rule callbacks rebuild stock and option contract read models",
                ),
                check(
                    "quote-history-callbacks",
                    quote_history_callbacks,
                    "quote, historical bar, and historical tick callbacks rebuild ordered market data",
                ),
                check(
                    "option-callbacks",
                    option_callbacks,
                    "option chain, selected contract, and option quote callbacks rebuild option market data",
                ),
                check(
                    "pacing-callbacks",
                    pacing_callbacks,
                    "historical pacing callbacks preserve fail-closed request limits and cached fallback metadata",
                ),
                check(
                    "callback-events-replayable",
                    replayable_events && callback_count,
                    "callback-backed market-data events are replayable through the adapter event transcript",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn market_data_streams_trace() -> VerificationTrace {
        let fixture = MarketDataFixture::deterministic();
        let contract_shapes = fixture.contract_shapes_are_valid();
        let market_rule = fixture.market_rule_is_sorted_and_aligned();
        let quote = fixture.quote_is_fresh_and_ordered();
        let bars_ticks = fixture.bars_and_ticks_are_sorted();
        let events = fixture.market_events_are_replayable();
        let event_hub = EventHub::default();
        let mut broadcast_receiver = event_hub.subscribe();
        let broadcast_event = fixture.event_transcript[1].clone();
        event_hub.record(broadcast_event.clone());
        let live_event_fanout = broadcast_receiver.try_recv().is_ok_and(|event| {
            event.event == broadcast_event.event && event.payload == broadcast_event.payload
        });
        let subscriptions = MarketDataSubscriptionStore::default();
        let quote_subscription =
            subscriptions.subscribe(MarketDataStreamKind::Quote, AAPL_CON_ID, 1);
        let bars_subscription = subscriptions.subscribe(MarketDataStreamKind::Bars, AAPL_CON_ID, 1);
        let quote_unsubscription =
            subscriptions.unsubscribe(MarketDataStreamKind::Quote, AAPL_CON_ID);
        let subscription_state = quote_subscription.active
            && quote_subscription.stream == "quote"
            && quote_subscription.replayed_event_count == 1
            && bars_subscription.active
            && bars_subscription.stream == "bars"
            && bars_subscription.replayed_event_count == 1
            && quote_unsubscription.status == "stopped"
            && !quote_unsubscription.active
            && !subscriptions.is_active(MarketDataStreamKind::Quote, AAPL_CON_ID)
            && subscriptions.is_active(MarketDataStreamKind::Bars, AAPL_CON_ID);

        VerificationTrace {
            verifier: "market-data-streams".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: contract_shapes
                && market_rule
                && quote
                && bars_ticks
                && events
                && live_event_fanout
                && subscription_state,
            checks: vec![
                check(
                    "contract-details",
                    contract_shapes,
                    "stock and option contract identities keep conID, security type, route, and market-rule provenance",
                ),
                check(
                    "market-rule",
                    market_rule,
                    "minimum tick increments start at zero and remain sorted",
                ),
                check(
                    "quote-snapshot",
                    quote,
                    "quote snapshot keeps bid <= ask, market-data type, and timestamp provenance",
                ),
                check(
                    "historical-bars-ticks",
                    bars_ticks,
                    "historical bars and ticks are sorted and count-consistent",
                ),
                check(
                    "event-names",
                    events,
                    "contract.details, quote.snapshot, bars.snapshot, and ticks.snapshot events are replayable",
                ),
                check(
                    "live-event-fanout",
                    live_event_fanout,
                    "event hub publishes future market-data events to live subscribers in addition to replay storage",
                ),
                check(
                    "subscription-state",
                    subscription_state,
                    "quote and bar subscription start-stop state is tracked without changing the frozen event-name surface",
                ),
            ],
            evidence: json!({
                "contractDetails": fixture.stock_details,
                "marketRule": fixture.market_rule,
                "quote": fixture.quote,
                "historicalBars": fixture.historical_bars,
                "historicalTicks": fixture.historical_ticks,
                "eventTranscript": fixture.event_transcript,
                "fanoutEvent": broadcast_event,
                "quoteSubscription": quote_subscription,
                "barsSubscription": bars_subscription,
                "quoteUnsubscription": quote_unsubscription,
                "activeSubscriptions": subscriptions.snapshot()
            }),
        }
    }

    fn historical_pacing_trace() -> VerificationTrace {
        let fixture = MarketDataFixture::deterministic();
        let pacing = fixture.pacing_rules_are_fail_closed();
        let ticks_sorted = fixture.bars_and_ticks_are_sorted();
        let failure_taxonomy_has_pacing = failure_codes().contains(&"pacingLimit");
        let cached_fallback =
            fixture.pacing.cached_fallback_available && fixture.pacing.retry_after_seconds == 30;

        VerificationTrace {
            verifier: "historical-pacing".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: pacing && ticks_sorted && failure_taxonomy_has_pacing && cached_fallback,
            checks: vec![
                check(
                    "request-limits",
                    pacing,
                    "historical pacing preserves active caps, duplicate suppression, BID_ASK weighting, and retryAfterSeconds",
                ),
                check(
                    "cached-fallback",
                    cached_fallback,
                    "pacing rejection can serve a cached historical response instead of touching the broker",
                ),
                check(
                    "typed-failure",
                    failure_taxonomy_has_pacing,
                    "pacingLimit remains an advertised Swift-decodable failure code",
                ),
                check(
                    "historical-payloads",
                    ticks_sorted,
                    "historical bar and tick payloads are sorted and count-consistent",
                ),
            ],
            evidence: json!({
                "pacing": fixture.pacing,
                "historicalBars": fixture.historical_bars,
                "historicalTicks": fixture.historical_ticks
            }),
        }
    }

    fn option_market_data_trace() -> VerificationTrace {
        let fixture = MarketDataFixture::deterministic();
        let contract_shapes = fixture.contract_shapes_are_valid();
        let chain_quote = fixture.option_chain_and_quote_are_complete();
        let market_rule = fixture.market_rule_is_sorted_and_aligned();
        let events = fixture.market_events_are_replayable();

        VerificationTrace {
            verifier: "option-market-data".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: contract_shapes && chain_quote && market_rule && events,
            checks: vec![
                check(
                    "option-contract",
                    contract_shapes,
                    "selected option contract is fully hydrated and linked to its underlying conID",
                ),
                check(
                    "option-chain",
                    chain_quote,
                    "option chain contains expirations, strikes, rights, and selected quote data",
                ),
                check(
                    "option-market-rule",
                    market_rule,
                    "option details preserve market-rule ids and minimum tick",
                ),
                check(
                    "option-events",
                    events,
                    "option.chain, option.contract, option.contract-details, and option.quote events are replayable",
                ),
            ],
            evidence: json!({
                "optionChain": fixture.option_chain,
                "optionContract": fixture.option_contract,
                "optionDetails": fixture.option_details,
                "optionQuote": fixture.option_quote,
                "eventTranscript": fixture.event_transcript
            }),
        }
    }

    fn order_safety_trace() -> VerificationTrace {
        let evidence = order_routing::order_safety_evidence();
        let idempotency = evidence.idempotency_key
            == order_routing::idempotency_key_for_request_id(&evidence.request_id);
        let preview = order_routing::preview_from_mapped_order(
            &evidence.paper_order,
            Some(evidence.idempotency_key.as_str()),
        )
        .is_ok();
        let mut bad_transmit = evidence.paper_order.clone();
        bad_transmit["transmit"] = json!("true");
        let fail_closed_boolean = order_routing::paper_acknowledgement(
            &bad_transmit,
            Some(evidence.idempotency_key.as_str()),
            false,
        )
        .is_err();
        let live_confirmation = order_routing::live_acknowledgement(
            &evidence.live_order,
            Some(
                order_routing::idempotency_key_for_request_id(order_routing::LIVE_ORDER_REQUEST_ID)
                    .as_str(),
            ),
            false,
        )
        .is_ok();
        let modification = order_routing::modification_acknowledgement(
            &evidence.modification_order,
            Some(
                order_routing::idempotency_key_for_request_id(order_routing::MODIFY_REQUEST_ID)
                    .as_str(),
            ),
            order_routing::MODIFIED_BROKER_ORDER_ID,
            false,
        )
        .is_ok();
        let global_cancel =
            order_routing::global_cancel_acknowledgement(&evidence.global_cancel).is_ok();

        VerificationTrace {
            verifier: "order-safety".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: idempotency
                && preview
                && fail_closed_boolean
                && live_confirmation
                && modification
                && global_cancel,
            checks: vec![
                check(
                    "request-derived-idempotency",
                    idempotency,
                    "mapped request ids derive the bare UUID Idempotency-Key",
                ),
                check(
                    "what-if-preview",
                    preview,
                    "mapped order preview validates route, tick, exchange, and transmit evidence",
                ),
                check(
                    "json-boolean-fail-closed",
                    fail_closed_boolean,
                    "mapped-order transmit must decode as a JSON boolean before broker access",
                ),
                check(
                    "live-confirmation",
                    live_confirmation,
                    "live mapped orders require exact per-order confirmation text",
                ),
                check(
                    "modification-confirmation",
                    modification,
                    "order modification requires exact environment/account/order/request confirmation text",
                ),
                check(
                    "global-cancel-confirmation",
                    global_cancel,
                    "global cancel is paper-only and account-confirmed",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn order_callback_state_trace() -> VerificationTrace {
        let account_state = AccountStateFixture::default();
        let evidence = order_routing::deterministic_routing_callback_evidence(
            &account_state.positions,
            &account_state.open_orders,
        );
        let state = &evidence.routing_state;
        let paper_live_acknowledgements =
            state.placement_acknowledgements.iter().any(|ack| {
                ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID
                    && ack.environment == crate::adapter_contract::BrokerEnvironment::IbkrPaper
                    && ack.status == "accepted"
            }) && state.placement_acknowledgements.iter().any(|ack| {
                ack.broker_order_id == order_routing::LIVE_BROKER_ORDER_ID
                    && ack.environment == crate::adapter_contract::BrokerEnvironment::IbkrLive
                    && ack.status == "accepted"
            });
        let duplicate_reuse = state.placement_acknowledgements.iter().any(|ack| {
            ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID
                && ack.status == "duplicate"
                && ack.lifecycle_state_source == "/v1/events and reconciliation endpoints"
        });
        let option_combo_acknowledgements =
            state.placement_acknowledgements.iter().any(|ack| {
                ack.broker_order_id == order_routing::LIVE_OPTION_BROKER_ORDER_ID
                    && ack.environment == crate::adapter_contract::BrokerEnvironment::IbkrLive
            }) && state.placement_acknowledgements.iter().any(|ack| {
                ack.broker_order_id == order_routing::LIVE_COMBO_BROKER_ORDER_ID
                    && ack.environment == crate::adapter_contract::BrokerEnvironment::IbkrLive
            });
        let commands = state.modification_acknowledgements.iter().any(|ack| {
            ack.broker_order_id == order_routing::MODIFIED_BROKER_ORDER_ID
                && ack.status == "accepted"
        }) && state.cancel_responses.iter().any(|response| {
            response.status.status == "cancelled" && response.status.remaining_quantity == "0"
        }) && state.global_cancel_acknowledgements.iter().any(|ack| {
            ack.environment == crate::adapter_contract::BrokerEnvironment::IbkrPaper
                && ack.status == "accepted"
        }) && state.option_exercise_acknowledgements.iter().any(|ack| {
            ack.action == "exercise"
                && ack.status == "accepted"
                && ack.lifecycle_state_source.contains("exerciseOptions")
        });
        let replayable_events = state.routing_events_are_replayable()
            && evidence
                .event_names
                .iter()
                .any(|event| event == "order.status")
            && evidence
                .event_names
                .iter()
                .any(|event| event == "option.exercise");
        let callback_count = evidence.callback_count
            == order_routing::deterministic_routing_callback_transcript(
                &account_state.positions,
                &account_state.open_orders,
            )
            .len();

        VerificationTrace {
            verifier: "order-callback-state".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: paper_live_acknowledgements
                && duplicate_reuse
                && option_combo_acknowledgements
                && commands
                && replayable_events
                && callback_count,
            checks: vec![
                check(
                    "paper-live-acknowledgements",
                    paper_live_acknowledgements,
                    "paper and live placement callbacks rebuild accepted broker acknowledgement state",
                ),
                check(
                    "duplicate-acknowledgement-reuse",
                    duplicate_reuse,
                    "duplicate placement callbacks preserve broker order id reuse",
                ),
                check(
                    "option-combo-acknowledgements",
                    option_combo_acknowledgements,
                    "live option and combo callbacks rebuild accepted route acknowledgement state",
                ),
                check(
                    "modify-cancel-exercise-callbacks",
                    commands,
                    "modification, cancel, global cancel, and option exercise callbacks rebuild command acknowledgement state",
                ),
                check(
                    "callback-events-replayable",
                    replayable_events && callback_count,
                    "callback-backed order, modify, global cancel, and exercise events are replayable",
                ),
            ],
            evidence: json!(evidence),
        }
    }

    fn paper_order_routing_trace() -> VerificationTrace {
        let body = order_routing::paper_order_body();
        let idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
        let preview = order_routing::preview_from_mapped_order(&body, Some(&idempotency_key)).ok();
        let acknowledgement =
            order_routing::paper_acknowledgement(&body, Some(&idempotency_key), false).ok();
        let duplicate =
            order_routing::paper_acknowledgement(&body, Some(&idempotency_key), true).ok();
        let paper_acknowledged = acknowledgement.as_ref().is_some_and(|ack| {
            ack.status == "accepted"
                && ack.environment == crate::adapter_contract::BrokerEnvironment::IbkrPaper
        });
        let duplicate_reused = duplicate.as_ref().is_some_and(|ack| {
            ack.status == "duplicate" && ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID
        });
        let rejects_live_payload = order_routing::paper_acknowledgement(
            &order_routing::live_order_body(),
            Some(&order_routing::idempotency_key_for_request_id(
                order_routing::LIVE_ORDER_REQUEST_ID,
            )),
            false,
        )
        .is_err();
        let event_names = event_names().contains(&"order.status")
            && event_names().contains(&"fill.report")
            && event_names().contains(&"adapter.failure");

        VerificationTrace {
            verifier: "paper-order-routing".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: preview.is_some()
                && paper_acknowledged
                && duplicate_reused
                && rejects_live_payload
                && event_names,
            checks: vec![
                check(
                    "broker-preview",
                    preview.is_some_and(|preview| preview.broker_accepted),
                    "paper route requires a broker-accepted preview before placement",
                ),
                check(
                    "paper-acknowledgement",
                    paper_acknowledged,
                    "paper placement returns asynchronous accepted acknowledgement",
                ),
                check(
                    "duplicate-acknowledgement",
                    duplicate_reused,
                    "duplicate paper placement reuses acknowledgement state",
                ),
                check(
                    "rejects-live-payload",
                    rejects_live_payload,
                    "paper placement rejects live mapped-order payloads",
                ),
                check(
                    "routing-events",
                    event_names,
                    "paper routing reserves order.status, fill.report, and adapter.failure event behavior",
                ),
            ],
            evidence: json!({
                "mappedOrder": body,
                "acknowledgement": acknowledgement,
                "duplicateAcknowledgement": duplicate
            }),
        }
    }

    fn live_order_routing_trace() -> VerificationTrace {
        let body = order_routing::live_order_body();
        let idempotency_key =
            order_routing::idempotency_key_for_request_id(order_routing::LIVE_ORDER_REQUEST_ID);
        let acknowledgement =
            order_routing::live_acknowledgement(&body, Some(&idempotency_key), false).ok();
        let mut wrong_confirmation = body.clone();
        wrong_confirmation["liveConfirmationText"] = json!("WRONG");
        let rejects_wrong_confirmation =
            order_routing::live_acknowledgement(&wrong_confirmation, Some(&idempotency_key), false)
                .is_err();
        let rejects_wrong_idempotency =
            order_routing::live_acknowledgement(&body, Some("wrong-key"), false).is_err();
        let live_startup = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7496,
                client_id: 52,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: true,
            live_trading_confirmation: Some(LIVE_TRADING_STARTUP_CONFIRMATION.to_string()),
        })
        .is_approved;
        let event_names = event_names().contains(&"order.status")
            && event_names().contains(&"fill.report")
            && event_names().contains(&"adapter.failure");

        VerificationTrace {
            verifier: "live-order-routing".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: acknowledgement.is_some()
                && rejects_wrong_confirmation
                && rejects_wrong_idempotency
                && live_startup
                && event_names,
            checks: vec![
                check(
                    "live-startup-gate",
                    live_startup,
                    "live routing requires live startup enablement, live port, and exact startup confirmation",
                ),
                check(
                    "per-order-confirmation",
                    acknowledgement
                        .as_ref()
                        .is_some_and(|ack| ack.environment == crate::adapter_contract::BrokerEnvironment::IbkrLive),
                    "live placement requires exact per-order confirmation",
                ),
                check(
                    "wrong-confirmation-rejects",
                    rejects_wrong_confirmation,
                    "wrong live confirmation text rejects before broker access",
                ),
                check(
                    "request-derived-idempotency",
                    rejects_wrong_idempotency,
                    "live placement rejects idempotency keys that do not match the mapped request id",
                ),
                check(
                    "routing-events",
                    event_names,
                    "live routing reserves order.status, fill.report, and adapter.failure event behavior",
                ),
            ],
            evidence: json!({
                "mappedOrder": body,
                "acknowledgement": acknowledgement,
                "requiredConfirmation": order_routing::live_confirmation_text("U1234567", order_routing::LIVE_ORDER_REQUEST_ID)
            }),
        }
    }

    fn live_option_combo_routing_trace() -> VerificationTrace {
        let option_body = order_routing::live_option_order_body();
        let combo_body = order_routing::live_combo_order_body();
        let option_idempotency_key = order_routing::idempotency_key_for_request_id(
            order_routing::LIVE_OPTION_ORDER_REQUEST_ID,
        );
        let combo_idempotency_key = order_routing::idempotency_key_for_request_id(
            order_routing::LIVE_COMBO_ORDER_REQUEST_ID,
        );
        let option_acknowledgement =
            order_routing::live_acknowledgement(&option_body, Some(&option_idempotency_key), false)
                .ok();
        let option_duplicate =
            order_routing::live_acknowledgement(&option_body, Some(&option_idempotency_key), true)
                .ok();
        let combo_acknowledgement =
            order_routing::live_acknowledgement(&combo_body, Some(&combo_idempotency_key), false)
                .ok();
        let combo_duplicate =
            order_routing::live_acknowledgement(&combo_body, Some(&combo_idempotency_key), true)
                .ok();
        let option_hydration = order_routing::mapped_contract_hydration(&option_body).ok();
        let combo_hydration = order_routing::mapped_contract_hydration(&combo_body).ok();
        let option_required_confirmation = order_routing::live_confirmation_text(
            "U1234567",
            order_routing::LIVE_OPTION_ORDER_REQUEST_ID,
        );
        let combo_required_confirmation = order_routing::live_confirmation_text(
            "U1234567",
            order_routing::LIVE_COMBO_ORDER_REQUEST_ID,
        );

        let live_startup = evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7496,
                client_id: 52,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: true,
            live_trading_confirmation: Some(LIVE_TRADING_STARTUP_CONFIRMATION.to_string()),
        })
        .is_approved;
        let disabled_startup_rejects = !evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7496,
                client_id: 52,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: false,
            live_trading_confirmation: Some(LIVE_TRADING_STARTUP_CONFIRMATION.to_string()),
        })
        .is_approved;
        let wrong_port_rejects = !evaluate_startup(crate::runtime_state::StartupRequest {
            endpoint: crate::adapter_contract::Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7497,
                client_id: 52,
                environment: crate::adapter_contract::BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: true,
            live_trading_confirmation: Some(LIVE_TRADING_STARTUP_CONFIRMATION.to_string()),
        })
        .is_approved;

        let mut paper_option_body = option_body.clone();
        paper_option_body["environment"] = json!("ibkrPaper");
        let option_paper_environment_rejects = order_routing::live_acknowledgement(
            &paper_option_body,
            Some(&option_idempotency_key),
            false,
        )
        .is_err();
        let mut paper_combo_body = combo_body.clone();
        paper_combo_body["environment"] = json!("ibkrPaper");
        let combo_paper_environment_rejects = order_routing::live_acknowledgement(
            &paper_combo_body,
            Some(&combo_idempotency_key),
            false,
        )
        .is_err();

        let mut option_missing_confirmation = option_body.clone();
        option_missing_confirmation["liveConfirmationText"] = json!("");
        let option_missing_confirmation_rejects = order_routing::live_acknowledgement(
            &option_missing_confirmation,
            Some(&option_idempotency_key),
            false,
        )
        .is_err();
        let mut combo_wrong_confirmation = combo_body.clone();
        combo_wrong_confirmation["liveConfirmationText"] = json!("wrong");
        let combo_wrong_confirmation_rejects = order_routing::live_acknowledgement(
            &combo_wrong_confirmation,
            Some(&combo_idempotency_key),
            false,
        )
        .is_err();

        let option_route_rejects = order_routing::live_acknowledgement(
            &order_routing::live_option_order_body_with(
                "CBOE",
                "0.05",
                Some(option_required_confirmation.clone()),
            ),
            Some(&option_idempotency_key),
            false,
        )
        .is_err();
        let option_tick_rejects = order_routing::live_acknowledgement(
            &order_routing::live_option_order_body_with(
                "SMART",
                "0.10",
                Some(option_required_confirmation.clone()),
            ),
            Some(&option_idempotency_key),
            false,
        )
        .is_err();
        let combo_route_rejects = order_routing::live_acknowledgement(
            &order_routing::live_combo_order_body_with(
                "ISE",
                "0.01",
                Some(combo_required_confirmation.clone()),
            ),
            Some(&combo_idempotency_key),
            false,
        )
        .is_err();
        let combo_tick_rejects = order_routing::live_acknowledgement(
            &order_routing::live_combo_order_body_with(
                "SMART",
                "0.03",
                Some(combo_required_confirmation.clone()),
            ),
            Some(&combo_idempotency_key),
            false,
        )
        .is_err();
        let single_leg_combo_rejects = order_routing::mapped_contract_hydration(
            &order_routing::live_single_leg_combo_order_body(),
        )
        .is_err();
        let option_route_passed = option_acknowledgement.as_ref().is_some_and(|ack| {
            ack.broker_order_id == order_routing::LIVE_OPTION_BROKER_ORDER_ID
                && ack.status == "accepted"
        }) && option_duplicate
            .as_ref()
            .is_some_and(|ack| ack.status == "duplicate")
            && option_hydration.as_ref().is_some_and(|hydration| {
                hydration.security_type == "OPT"
                    && hydration.hydrates_con_id
                    && hydration.required_option_fields_present
                    && hydration.con_id == order_routing::LIVE_OPTION_CON_ID
            })
            && option_route_rejects
            && option_tick_rejects;
        let combo_route_passed = combo_acknowledgement.as_ref().is_some_and(|ack| {
            ack.broker_order_id == order_routing::LIVE_COMBO_BROKER_ORDER_ID
                && ack.status == "accepted"
        }) && combo_duplicate
            .as_ref()
            .is_some_and(|ack| ack.status == "duplicate")
            && combo_hydration.as_ref().is_some_and(|hydration| {
                hydration.security_type == "BAG"
                    && !hydration.hydrates_con_id
                    && hydration.combo_leg_count == 2
                    && hydration.combo_legs[0].action == "BUY"
                    && hydration.combo_legs[1].action == "SELL"
            })
            && combo_route_rejects
            && combo_tick_rejects
            && single_leg_combo_rejects;
        let startup_passed = live_startup
            && disabled_startup_rejects
            && wrong_port_rejects
            && option_paper_environment_rejects
            && combo_paper_environment_rejects;
        let confirmation_passed = option_missing_confirmation_rejects
            && combo_wrong_confirmation_rejects
            && option_body["liveConfirmationText"] == option_required_confirmation
            && combo_body["liveConfirmationText"] == combo_required_confirmation;
        let event_names = event_names().contains(&"order.status")
            && event_names().contains(&"fill.report")
            && event_names().contains(&"adapter.failure");

        VerificationTrace {
            verifier: "live-option-combo-routing".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: startup_passed
                && confirmation_passed
                && option_route_passed
                && combo_route_passed
                && event_names,
            checks: vec![
                check(
                    "live-startup-gate",
                    startup_passed,
                    "live option and combo routes require live startup, live port, and live environment",
                ),
                check(
                    "per-order-confirmation",
                    confirmation_passed,
                    "live option and combo routes require exact per-order confirmation text",
                ),
                check(
                    "option-hydration",
                    option_route_passed,
                    "live option routing hydrates complete OPT contract fields and applies route/tick constraints",
                ),
                check(
                    "combo-hydration",
                    combo_route_passed,
                    "live combo routing hydrates a BAG contract with at least two normalized combo legs",
                ),
                check(
                    "routing-events",
                    event_names,
                    "live option/combo routing reserves order.status, fill.report, and adapter.failure event behavior",
                ),
            ],
            evidence: json!({
                "capability": "liveOptionOrComboGated",
                "startupGate": {
                    "passed": startup_passed,
                    "liveGatewayAllowed": live_startup,
                    "disabledStartupRejection": "liveTradingDisabled",
                    "wrongPortRejection": "livePortRejected",
                    "optionPaperEnvironmentRejection": "rejectedOrder",
                    "comboPaperEnvironmentRejection": "rejectedOrder"
                },
                "confirmationGate": {
                    "passed": confirmation_passed,
                    "optionRequiredText": option_required_confirmation,
                    "optionMissingConfirmationRejection": "rejectedOrder",
                    "comboRequiredText": combo_required_confirmation,
                    "comboWrongConfirmationRejection": "rejectedOrder"
                },
                "optionRoute": {
                    "passed": option_route_passed,
                    "expectedIdempotencyKey": option_idempotency_key,
                    "securityType": option_hydration.as_ref().map(|hydration| hydration.security_type.clone()),
                    "mappedContract": option_hydration,
                    "limitPrice": option_body["limitPrice"],
                    "limitMinimumTick": option_body["limitMinimumTick"],
                    "routeRejection": "rejectedOrder",
                    "tickRejection": "rejectedOrder",
                    "accepted": option_acknowledgement,
                    "duplicate": option_duplicate
                },
                "comboRoute": {
                    "passed": combo_route_passed,
                    "expectedIdempotencyKey": combo_idempotency_key,
                    "securityType": combo_hydration.as_ref().map(|hydration| hydration.security_type.clone()),
                    "comboLegCount": combo_hydration.as_ref().map(|hydration| hydration.combo_leg_count),
                    "mappedContract": combo_hydration,
                    "limitPrice": combo_body["limitPrice"],
                    "limitMinimumTick": combo_body["limitMinimumTick"],
                    "routeRejection": "rejectedOrder",
                    "tickRejection": "rejectedOrder",
                    "singleLegComboRejection": "invalidContract",
                    "accepted": combo_acknowledgement,
                    "duplicate": combo_duplicate
                },
                "reconciliation": {
                    "passed": event_names,
                    "events": ["order.status", "fill.report", "adapter.failure"]
                }
            }),
        }
    }

    fn option_exercise_safety_trace() -> VerificationTrace {
        let fixture = AccountStateFixture::deterministic();
        let body = order_routing::option_exercise_body(
            crate::adapter_contract::BrokerEnvironment::IbkrPaper,
            "exercise",
        );
        let idempotency_key = order_routing::idempotency_key_for_request_id(
            order_routing::OPTION_EXERCISE_REQUEST_ID,
        );
        let acknowledgement = order_routing::option_exercise_acknowledgement(
            &body,
            Some(&idempotency_key),
            &fixture.positions,
            false,
        )
        .ok();
        let duplicate = order_routing::option_exercise_acknowledgement(
            &body,
            Some(&idempotency_key),
            &fixture.positions,
            true,
        )
        .ok();
        let action_codes = order_routing::option_action_code("exercise") == Some(1)
            && order_routing::option_action_code("lapse") == Some(2);
        let mut malformed_bool = body.clone();
        malformed_bool["overrideNaturalAction"] = json!("false");
        let malformed_bool_rejects = order_routing::option_exercise_acknowledgement(
            &malformed_bool,
            Some(&idempotency_key),
            &fixture.positions,
            false,
        )
        .is_err();
        let mut wrong_confirmation = body.clone();
        wrong_confirmation["confirmationText"] = json!("WRONG");
        let wrong_confirmation_rejects = order_routing::option_exercise_acknowledgement(
            &wrong_confirmation,
            Some(&idempotency_key),
            &fixture.positions,
            false,
        )
        .is_err();
        let missing_position_rejects = order_routing::option_exercise_acknowledgement(
            &body,
            Some(&idempotency_key),
            &[],
            false,
        )
        .is_err();
        let event_names = event_names().contains(&"option.exercise")
            && event_names().contains(&"adapter.failure");

        VerificationTrace {
            verifier: "option-exercise-safety".to_string(),
            api_version: API_VERSION.to_string(),
            implementation: IMPLEMENTATION.to_string(),
            is_approved: acknowledgement.is_some()
                && duplicate.as_ref().is_some_and(|ack| ack.status == "duplicate")
                && action_codes
                && malformed_bool_rejects
                && wrong_confirmation_rejects
                && missing_position_rejects
                && event_names,
            checks: vec![
                check(
                    "action-code-mapping",
                    action_codes,
                    "exercise maps to TWS action code 1 and lapse maps to 2",
                ),
                check(
                    "position-required",
                    missing_position_rejects,
                    "option exercise rejects before broker access unless a matching option position exists",
                ),
                check(
                    "confirmation-required",
                    wrong_confirmation_rejects,
                    "option exercise/lapse requires exact account and request-specific confirmation text",
                ),
                check(
                    "json-boolean-fail-closed",
                    malformed_bool_rejects,
                    "overrideNaturalAction must decode as a JSON boolean",
                ),
                check(
                    "duplicate-acknowledgement",
                    duplicate.as_ref().is_some_and(|ack| ack.status == "duplicate"),
                    "duplicate option exercise requests reuse acknowledgement state",
                ),
                check(
                    "event-names",
                    event_names,
                    "option.exercise and adapter.failure events are reserved for reconciliation",
                ),
            ],
            evidence: json!({
                "request": body,
                "acknowledgement": acknowledgement,
                "duplicateAcknowledgement": duplicate,
                "requiredConfirmation": order_routing::option_confirmation_text(
                    "exercise",
                    crate::adapter_contract::BrokerEnvironment::IbkrPaper,
                    PAPER_ACCOUNT_ID,
                    order_routing::OPTION_EXERCISE_REQUEST_ID
                ).unwrap()
            }),
        }
    }

    fn check(id: &str, is_approved: bool, message: &str) -> VerificationCheck {
        VerificationCheck {
            id: id.to_string(),
            is_approved,
            message: message.to_string(),
        }
    }
}

pub mod cli {
    use crate::{
        adapter_contract::{BrokerEnvironment, Endpoint},
        http_interface, tws_transport, verifier,
    };
    use clap::{Parser, Subcommand, ValueEnum};
    use std::{net::SocketAddr, path::PathBuf};

    #[derive(Debug, Parser)]
    #[command(name = "agentic-trading-adapter")]
    #[command(about = "Rust local broker adapter for Agentic Trading")]
    struct Args {
        #[command(subcommand)]
        command: Option<Command>,
    }

    #[derive(Debug, Subcommand)]
    enum Command {
        Serve {
            #[arg(long, default_value = "127.0.0.1:8765")]
            listen: SocketAddr,
            #[arg(long, value_enum, default_value_t = ServeStartupMode::Disconnected)]
            startup_mode: ServeStartupMode,
            #[arg(long, default_value = "127.0.0.1")]
            broker_host: String,
            #[arg(long, default_value_t = 4002)]
            broker_port: u16,
            #[arg(long, default_value_t = 42)]
            broker_client_id: u32,
            #[arg(long, value_enum, default_value_t = CliBrokerEnvironment::IbkrPaper)]
            broker_environment: CliBrokerEnvironment,
            #[arg(long, default_value_t = false)]
            enable_live_trading: bool,
            #[arg(long)]
            live_trading_confirmation: Option<String>,
            #[arg(long, default_value_t = 8)]
            startup_callbacks: usize,
        },
        Verify {
            verifier: String,
            #[arg(long)]
            output: Option<PathBuf>,
        },
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
    enum ServeStartupMode {
        Disconnected,
        ConnectedFixture,
        TcpFixture,
        Broker,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
    enum CliBrokerEnvironment {
        IbkrPaper,
        IbkrLive,
    }

    impl From<CliBrokerEnvironment> for BrokerEnvironment {
        fn from(value: CliBrokerEnvironment) -> Self {
            match value {
                CliBrokerEnvironment::IbkrPaper => Self::IbkrPaper,
                CliBrokerEnvironment::IbkrLive => Self::IbkrLive,
            }
        }
    }

    pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
        let args = Args::parse();
        match args.command.unwrap_or(Command::Serve {
            listen: "127.0.0.1:8765".parse().expect("default listen address"),
            startup_mode: ServeStartupMode::Disconnected,
            broker_host: "127.0.0.1".to_string(),
            broker_port: 4002,
            broker_client_id: 42,
            broker_environment: CliBrokerEnvironment::IbkrPaper,
            enable_live_trading: false,
            live_trading_confirmation: None,
            startup_callbacks: 8,
        }) {
            Command::Serve {
                listen,
                startup_mode,
                broker_host,
                broker_port,
                broker_client_id,
                broker_environment,
                enable_live_trading,
                live_trading_confirmation,
                startup_callbacks,
            } => {
                let state = match startup_mode {
                    ServeStartupMode::Disconnected => http_interface::AppState::default(),
                    ServeStartupMode::ConnectedFixture => {
                        http_interface::AppState::connected_fixture()
                    }
                    ServeStartupMode::TcpFixture => http_interface::AppState::tcp_startup_fixture()
                        .await
                        .map_err(|error| {
                            std::io::Error::other(format!(
                                "tcp fixture startup failed: {}: {}",
                                error.code, error.message
                            ))
                        })?,
                    ServeStartupMode::Broker => {
                        let endpoint = Endpoint {
                            host: broker_host,
                            port: broker_port,
                            client_id: broker_client_id,
                            environment: broker_environment.into(),
                        };
                        http_interface::AppState::broker_startup(
                            tws_transport::TwsBrokerStartupConfig {
                                endpoint,
                                live_trading_enabled: enable_live_trading,
                                live_trading_confirmation,
                                max_callbacks: startup_callbacks,
                            },
                        )
                        .await
                        .map_err(|error| {
                            std::io::Error::other(format!(
                                "broker startup failed: {}: {}",
                                error.code, error.message
                            ))
                        })?
                    }
                };
                http_interface::serve_with_state(listen, state).await?;
            }
            Command::Verify {
                verifier: name,
                output,
            } => {
                let kind = verifier::VerifierKind::parse(&name)?;
                let trace = verifier::run(kind).await;
                let json = serde_json::to_string_pretty(&trace)?;
                if let Some(path) = output {
                    std::fs::write(path, format!("{json}\n"))?;
                } else {
                    println!("{json}");
                }
                if !trace.is_approved {
                    return Err(
                        format!("verifier '{name}' did not approve the backend surface").into(),
                    );
                }
            }
        }
        Ok(())
    }
}

pub mod telemetry {
    use tracing_subscriber::{fmt, EnvFilter};

    pub fn init() {
        let filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("agentic_trading_adapter=info,warn"));
        let _ = fmt().with_env_filter(filter).try_init();
    }
}
