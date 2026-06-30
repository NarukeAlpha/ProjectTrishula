use agentic_trading_adapter::{
    adapter_contract::{self, BrokerEnvironment, Endpoint, API_VERSION, IMPLEMENTATION},
    broker_callback_router::{BrokerCallback, BrokerCallbackRouter},
    broker_protocol,
    broker_read_model::{
        AccountStateCallback, AccountStateFixture, AccountStateStore, PAPER_ACCOUNT_ID,
    },
    event_hub::EventHub,
    http_interface::{self, AppState},
    market_read_model::{
        self, MarketDataCallback, MarketDataFixture, MarketDataStore, MarketDataStreamKind,
    },
    order_routing, tws_transport, tws_wire,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

async fn request_json(method: &str, uri: &str) -> (StatusCode, Value) {
    let app = http_interface::router();
    request_json_with_app(app, method, uri, [], "").await
}

async fn request_json_with_state(
    state: AppState,
    method: &str,
    uri: &str,
    headers: [(&str, &str); 1],
    body: &str,
) -> (StatusCode, Value) {
    let app = http_interface::router_with_state(state);
    request_json_with_app(app, method, uri, headers, body).await
}

async fn request_json_with_app<const N: usize>(
    app: Router,
    method: &str,
    uri: &str,
    headers: [(&str, &str); N],
    body: &str,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    let request = builder.body(Body::from(body.to_string())).expect("request");
    let response = app.oneshot(request).await.expect("response");
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    (status, serde_json::from_slice(&body).expect("json"))
}

fn capability_route<'a>(routes: &'a [Value], method: &str, path: &str) -> &'a Value {
    routes
        .iter()
        .find(|route| route["method"] == method && route["path"] == path)
        .unwrap_or_else(|| panic!("missing capability route {method} {path}"))
}

fn json_string_array_contains(value: &Value, expected: &str) -> bool {
    value
        .as_array()
        .expect("string array")
        .iter()
        .any(|item| item == expected)
}

fn decode_tws_callback(fields: Vec<String>) -> tws_wire::TwsCallback {
    tws_wire::TwsFrame::new(fields)
        .and_then(|frame| tws_wire::decode_callback(&frame))
        .expect("decode TWS callback frame")
}

#[test]
fn event_hub_broadcasts_future_events_to_subscribers() {
    let hub = EventHub::default();
    let mut receiver = hub.subscribe();
    let event = adapter_contract::event_envelope(
        "quote.snapshot",
        json!({ "contract": { "conID": 265598 }, "bid": "208.10", "ask": "208.14" }),
    );

    hub.record(event.clone());

    let received = receiver.try_recv().expect("broadcast event");
    assert_eq!(received.event, event.event);
    assert_eq!(received.payload, event.payload);
    assert_eq!(hub.replay().len(), 1);
}

#[tokio::test]
async fn status_reports_disconnected_rust_adapter() {
    let (status, json) = request_json("GET", "/v1/status").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["apiVersion"], API_VERSION);
    assert_eq!(json["implementation"], IMPLEMENTATION);
    assert_eq!(json["connectionState"], "disconnected");
    assert_eq!(json["serverTime"], Value::Null);
    assert_eq!(json["serverTimeProvenance"]["source"], "unavailable");
    assert_eq!(json["serverTimeProvenance"]["heartbeatStale"], false);
    assert_eq!(json["endpoint"]["environment"], "ibkrPaper");
}

#[tokio::test]
async fn status_reports_connected_state_from_app_state() {
    let state = AppState::connected_fixture();
    let (status, json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/status",
        [("X-Request-ID", "status")],
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["connectionState"], "connected");
    assert_eq!(json["serverTimeProvenance"]["source"], "twsReqCurrentTime");
    let initial_events = state.event_hub.initial_events();
    assert_eq!(initial_events[0].event, "connection.status");
    assert_eq!(initial_events[0].payload["connectionState"], "connected");
}

#[tokio::test]
async fn tcp_startup_fixture_status_supports_adapter_healthy_surface() {
    let state = AppState::tcp_startup_fixture()
        .await
        .expect("tcp startup fixture");
    let (status, json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/status",
        [("X-Request-ID", "status")],
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["connectionState"], "connected");
    assert_eq!(json["endpoint"]["host"], "127.0.0.1");
    assert!(json["endpoint"]["port"].as_u64().expect("port") > 0);
    let initial_events = state.event_hub.initial_events();
    assert_eq!(initial_events[0].event, "connection.status");
    assert_eq!(initial_events[0].payload["connectionState"], "connected");
}

#[tokio::test]
async fn capabilities_freeze_route_and_event_surface() {
    let (status, json) = request_json("GET", "/v1/capabilities").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["apiVersion"], API_VERSION);
    assert_eq!(json["implementation"], IMPLEMENTATION);
    assert_eq!(json["kind"], "ibkr-java-wrapper-capabilities");
    assert_eq!(json["routeCount"], 30);
    assert_eq!(json["eventReplayCapacity"], 100);
    let routes = json["routes"].as_array().expect("routes");
    assert_eq!(routes.len(), 30);
    assert_eq!(json["eventNames"].as_array().expect("events").len(), 17);
    assert!(json["eventNames"]
        .as_array()
        .expect("events")
        .iter()
        .any(|event| event == "adapter.failure"));
    let status_route = capability_route(routes, "GET", "/v1/status");
    assert_eq!(status_route["category"], "connection");
    assert_eq!(status_route["requiresTwsConnection"], false);
    let preview_route = capability_route(routes, "POST", "/v1/orders/preview");
    assert_eq!(preview_route["category"], "orders");
    assert_eq!(preview_route["requiresIdempotencyKey"], true);
    assert_eq!(preview_route["requiresExactConfirmation"], false);
    assert_eq!(preview_route["returnsAsyncAcknowledgement"], false);
    let live_route = capability_route(routes, "POST", "/v1/orders/live");
    assert_eq!(live_route["requiresTwsConnection"], true);
    assert_eq!(live_route["requiresIdempotencyKey"], true);
    assert_eq!(live_route["requiresExactConfirmation"], true);
    assert_eq!(live_route["returnsAsyncAcknowledgement"], true);
    let global_cancel_route = capability_route(routes, "POST", "/v1/orders/global-cancel");
    assert_eq!(global_cancel_route["requiresIdempotencyKey"], false);
    assert_eq!(global_cancel_route["requiresExactConfirmation"], true);
    assert_eq!(global_cancel_route["returnsAsyncAcknowledgement"], true);
    assert!(json_string_array_contains(
        &json["marketData"],
        "historicalTicks"
    ));
    assert!(json_string_array_contains(
        &json["orderCapabilities"],
        "paperGlobalCancel"
    ));
    assert!(json_string_array_contains(
        &json["riskAndSafetyGates"],
        "requestDerivedIdempotency"
    ));
    assert!(json_string_array_contains(
        &json["graphAndTicketData"],
        "liveTicketGate"
    ));
    assert!(json_string_array_contains(
        &json["realSessionEvidenceRequired"],
        "real Gateway/TWS live dry-run or explicitly approved placement"
    ));
}

#[tokio::test]
async fn broker_facing_routes_fail_closed_with_adapter_failure_envelope() {
    let (status, json) = request_json("GET", "/v1/accounts").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "disconnectedGateway");
    assert_eq!(json["requestID"], "GET /v1/accounts");
    assert!(json["message"]
        .as_str()
        .expect("message")
        .contains("no IBKR Gateway or TWS session"));
}

#[tokio::test]
async fn idempotent_mutating_routes_reject_missing_idempotency_before_broker_access() {
    let (status, json) = request_json("POST", "/v1/orders/paper").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["code"], "rejectedOrder");
    assert!(json["message"]
        .as_str()
        .expect("message")
        .contains("Idempotency-Key"));
}

#[tokio::test]
async fn idempotent_mutating_routes_reject_same_key_with_different_body() {
    let state = AppState::default();
    let key = "00000000-0000-0000-0000-000000000001";
    let first_body = r#"{"accountID":"DU1234567","environment":"ibkrPaper","quantity":1}"#;
    let second_body = r#"{"accountID":"DU1234567","environment":"ibkrPaper","quantity":2}"#;

    let (first_status, first_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/paper",
        [("Idempotency-Key", key)],
        first_body,
    )
    .await;
    assert_eq!(first_status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(first_json["code"], "disconnectedGateway");

    let (second_status, second_json) = request_json_with_state(
        state,
        "POST",
        "/v1/orders/paper",
        [("Idempotency-Key", key)],
        second_body,
    )
    .await;
    assert_eq!(second_status, StatusCode::BAD_REQUEST);
    assert_eq!(second_json["code"], "rejectedOrder");
    assert!(second_json["message"]
        .as_str()
        .expect("message")
        .contains("different request body"));
}

#[tokio::test]
async fn connected_fixture_serves_account_and_reconciliation_shapes() {
    let state = AppState::connected_fixture();
    let (accounts_status, accounts_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts",
        [("X-Request-ID", "accounts")],
        "",
    )
    .await;
    assert_eq!(accounts_status, StatusCode::OK);
    assert_eq!(accounts_json.as_array().expect("accounts").len(), 2);
    assert_eq!(accounts_json[0]["accountID"], "DU1234567");
    assert_eq!(accounts_json[0]["environment"], "ibkrPaper");
    assert_eq!(accounts_json[0]["isPaperTrading"], true);

    let (summary_status, summary_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts/DU1234567/summary",
        [("X-Request-ID", "summary")],
        "",
    )
    .await;
    assert_eq!(summary_status, StatusCode::OK);
    assert_eq!(summary_json["account"]["accountID"], "DU1234567");
    assert_eq!(summary_json["netLiquidation"], "125000.50");

    let (positions_status, positions_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts/DU1234567/positions",
        [("X-Request-ID", "positions")],
        "",
    )
    .await;
    assert_eq!(positions_status, StatusCode::OK);
    assert!(positions_json
        .as_array()
        .expect("positions")
        .iter()
        .any(|position| position["instrument"]["securityType"] == "OPT"));

    let (orders_status, orders_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts/DU1234567/orders/open",
        [("X-Request-ID", "open-orders")],
        "",
    )
    .await;
    assert_eq!(orders_status, StatusCode::OK);
    assert_eq!(orders_json[0]["linkage"]["parentBrokerOrderID"], "1000");
    assert_eq!(orders_json[0]["linkage"]["ocaGroup"], "bracket-11111111");

    let (completed_orders_status, completed_orders_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts/DU1234567/orders/completed",
        [("X-Request-ID", "completed-orders")],
        "",
    )
    .await;
    assert_eq!(completed_orders_status, StatusCode::OK);
    assert_eq!(completed_orders_json[0]["brokerOrderID"], "1000");
    assert_eq!(completed_orders_json[0]["status"], "filled");
    assert_eq!(completed_orders_json[0]["filledQuantity"], "2");

    let (fills_status, fills_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts/DU1234567/fills",
        [("X-Request-ID", "fills")],
        "",
    )
    .await;
    assert_eq!(fills_status, StatusCode::OK);
    assert_eq!(fills_json[0]["brokerOrderID"], "1000");
    assert_eq!(
        fills_json[0]["commissionReportedAt"],
        "2027-01-15T18:30:02.500Z"
    );
    let account_snapshot = state.account_state.snapshot();
    assert!(account_snapshot.has_replayable_events());
    assert!(account_snapshot.flex_export_matches_fixture());
}

#[test]
fn callback_backed_account_state_reconstructs_lifecycle_and_flex_rows() {
    let fixture = AccountStateFixture::deterministic();
    let callback_state =
        AccountStateFixture::from_broker_callbacks(&fixture.broker_callback_transcript());

    assert_eq!(callback_state.accounts, fixture.accounts);
    assert_eq!(callback_state.summaries, fixture.summaries);
    assert_eq!(callback_state.positions, fixture.positions);
    assert_eq!(callback_state.open_orders, fixture.open_orders);
    assert_eq!(callback_state.completed_orders, fixture.completed_orders);
    assert_eq!(callback_state.fills, fixture.fills);
    assert!(callback_state.late_commission_update_republishes_fill());
    assert!(callback_state.has_replayable_events());
    assert_eq!(
        callback_state.flex_export_rows(PAPER_ACCOUNT_ID),
        fixture.flex_export_rows(PAPER_ACCOUNT_ID)
    );
}

#[test]
fn broker_protocol_session_requires_callback_backed_readiness() {
    let endpoint = agentic_trading_adapter::adapter_contract::default_endpoint();
    let mut session = broker_protocol::BrokerSessionManager::disconnected(endpoint.clone());
    session.apply(broker_protocol::BrokerProtocolEvent::connect_requested());
    session.apply(broker_protocol::BrokerProtocolEvent::socket_connected());
    assert_eq!(
        session.snapshot().connection_state.as_wire_value(),
        "connecting"
    );
    assert!(!session.snapshot().order_id_allocation_available);

    session.apply(broker_protocol::BrokerProtocolEvent::next_valid_id(
        broker_protocol::FIXTURE_NEXT_VALID_ORDER_ID,
    ));
    assert_eq!(
        session.snapshot().connection_state.as_wire_value(),
        "connecting"
    );

    session.apply(broker_protocol::BrokerProtocolEvent::server_time(
        broker_protocol::FIXTURE_SERVER_TIME,
    ));
    let connected = session.snapshot();
    assert_eq!(connected.connection_state.as_wire_value(), "connected");
    assert_eq!(connected.server_time_provenance.source, "twsReqCurrentTime");
    assert!(connected.order_id_allocation_available);
    assert!(broker_protocol::health_check(endpoint, session.status()).is_ready);

    session.apply(broker_protocol::BrokerProtocolEvent::read_loop_failure(
        "read-loop-smoke",
    ));
    let reconnecting = session.snapshot();
    assert_eq!(
        reconnecting.connection_state.as_wire_value(),
        "reconnecting"
    );
    assert!(!reconnecting.next_valid_id_ready);
    assert!(!reconnecting.order_id_allocation_available);
    assert_eq!(
        session.last_failure.expect("read loop failure").code,
        "disconnectedGateway"
    );
}

#[test]
fn tws_wire_codec_round_trips_callbacks_into_protocol_session() {
    let endpoint = agentic_trading_adapter::adapter_contract::default_endpoint();
    let evidence = tws_wire::deterministic_wire_evidence(endpoint);
    assert_eq!(evidence.start_api_fields, vec!["71", "2", "42", ""]);
    assert_eq!(evidence.req_managed_accounts_fields, vec!["17", "1"]);
    assert_eq!(evidence.req_current_time_fields, vec!["49", "1"]);
    assert_eq!(evidence.split_decode_frame_count, 3);
    assert!(evidence.partial_remaining_bytes > 0);
    assert_eq!(
        evidence.session.connection_state.as_wire_value(),
        "connected"
    );
    assert_eq!(
        evidence.session.server_time_provenance.source,
        "twsReqCurrentTime"
    );
    assert_eq!(
        evidence
            .reconnecting_after_error
            .connection_state
            .as_wire_value(),
        "reconnecting"
    );
    assert_eq!(evidence.malformed_error.code, "missingTrailingNul");
}

#[tokio::test]
async fn tws_transport_startup_harness_drives_readiness_and_reconnect() {
    let endpoint = agentic_trading_adapter::adapter_contract::default_endpoint();
    let evidence = tws_transport::deterministic_transport_evidence(endpoint)
        .await
        .expect("transport evidence");
    assert_eq!(
        evidence.ready_session.termination,
        tws_transport::TwsTransportTermination::Ready
    );
    assert!(evidence.ready_session.session.is_ready());
    assert_eq!(
        evidence.ready_session.sent_request_fields,
        evidence.gateway_observed_ready_requests
    );
    assert!(evidence.ready_session.bytes_written > 0);
    assert!(evidence.ready_session.bytes_read > 0);
    assert_eq!(
        evidence.reconnecting_session.termination,
        tws_transport::TwsTransportTermination::Reconnecting
    );
    assert_eq!(
        evidence
            .reconnecting_session
            .session
            .connection_state
            .as_wire_value(),
        "reconnecting"
    );
    assert!(
        !evidence
            .reconnecting_session
            .session
            .order_id_allocation_available
    );
}

#[tokio::test]
async fn tws_tcp_startup_harness_connects_over_loopback_socket() {
    let endpoint = adapter_contract::default_endpoint();
    let evidence = tws_transport::deterministic_tcp_startup_evidence(endpoint)
        .await
        .expect("tcp evidence");
    assert!(evidence.listener_address.starts_with("127.0.0.1:"));
    assert_eq!(evidence.endpoint.host, "127.0.0.1");
    assert!(evidence.endpoint.port > 0);
    assert_eq!(
        evidence.transcript.sent_request_fields,
        evidence.gateway_observed_requests
    );
    assert_eq!(
        evidence.transcript.termination,
        tws_transport::TwsTransportTermination::Ready
    );
    assert!(evidence.transcript.session.is_ready());
    assert!(evidence.transcript.bytes_written > 0);
    assert!(evidence.transcript.bytes_read > 0);
}

#[tokio::test]
async fn configured_broker_startup_preserves_endpoint_and_live_gate() {
    let endpoint = adapter_contract::default_endpoint();
    let evidence = tws_transport::deterministic_configured_startup_evidence(
        tws_transport::TwsBrokerStartupConfig {
            endpoint: endpoint.clone(),
            live_trading_enabled: false,
            live_trading_confirmation: None,
            max_callbacks: 8,
        },
    )
    .await
    .expect("configured startup evidence");

    assert!(evidence.startup_decision.is_approved);
    assert_eq!(evidence.startup_decision.endpoint, endpoint);
    assert_eq!(evidence.transcript.endpoint, endpoint);
    assert_eq!(evidence.transcript.session.endpoint, endpoint);
    assert_eq!(
        evidence.transcript.termination,
        tws_transport::TwsTransportTermination::Ready
    );
    assert_eq!(
        evidence.gateway_observed_requests.as_ref().unwrap(),
        &evidence.transcript.sent_request_fields
    );

    let live_rejection =
        tws_transport::run_configured_startup(tws_transport::TwsBrokerStartupConfig {
            endpoint: Endpoint {
                host: "127.0.0.1".to_string(),
                port: 7496,
                client_id: 52,
                environment: BrokerEnvironment::IbkrLive,
            },
            live_trading_enabled: false,
            live_trading_confirmation: None,
            max_callbacks: 1,
        })
        .await
        .expect_err("live startup rejects before connecting");
    assert_eq!(live_rejection.code, "startupRejected");
    assert!(live_rejection.message.contains("enable-live-trading"));
}

#[tokio::test]
async fn connected_fixture_serves_market_and_option_shapes() {
    let state = AppState::connected_fixture();
    let stock_query = "?symbol=AAPL&securityType=STK";
    let underlying_query = "?symbol=AAPL&exchange=SMART&primaryExchange=NASDAQ&currency=USD&localSymbol=AAPL&tradingClass=NMS&timezoneIdentifier=America%2FNew_York";
    let option_resolve_query = "?underlyingConID=265598&symbol=AAPL&expiration=20270115&strike=210&right=C&exchange=SMART&currency=USD";
    let option_query = "?underlyingConID=265598&symbol=AAPL&expiration=20270115&strike=210&right=C&exchange=SMART&currency=USD&tradingClass=AAPL&multiplier=100";
    let (contract_status, contract_json) = request_json_with_state(
        state.clone(),
        "GET",
        &format!("/v1/contracts/resolve{stock_query}"),
        [("X-Request-ID", "contract")],
        "",
    )
    .await;
    assert_eq!(contract_status, StatusCode::OK);
    assert_eq!(contract_json["contract"]["conID"], 265598);
    assert_eq!(contract_json["minimumTick"], "0.01");

    let (quote_status, quote_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/quotes/265598",
        [("X-Request-ID", "quote")],
        "",
    )
    .await;
    assert_eq!(quote_status, StatusCode::OK);
    assert_eq!(quote_json["bid"], "208.10");
    assert_eq!(quote_json["ask"], "208.14");
    assert_eq!(quote_json["marketDataType"], "delayed");

    let (market_rule_status, market_rule_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/market-rules/26",
        [("X-Request-ID", "market-rule")],
        "",
    )
    .await;
    assert_eq!(market_rule_status, StatusCode::OK);
    assert_eq!(market_rule_json["marketRuleID"], "26");
    assert_eq!(market_rule_json["minimumTick"], "0.01");
    assert_eq!(market_rule_json["increments"][0]["increment"], "0.01");

    let (bars_status, bars_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/bars/265598?timeframe=1m&barLimit=3&duration=1%20D&whatToShow=TRADES&regularTradingHoursOnly=true",
        [("X-Request-ID", "bars")],
        "",
    )
    .await;
    assert_eq!(bars_status, StatusCode::OK);
    assert_eq!(bars_json["timeframe"]["value"], 1);
    assert_eq!(bars_json["timeframe"]["unit"], "minute");
    assert_eq!(bars_json["bars"].as_array().expect("bars").len(), 3);
    assert_eq!(bars_json["whatToShow"], "TRADES");

    let (ticks_status, ticks_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/ticks/265598?numberOfTicks=2&whatToShow=TRADES&regularTradingHoursOnly=true&ignoreSize=true&endDateTime=20270115%2013%3A30%3A00%20US%2FEastern",
        [("X-Request-ID", "ticks")],
        "",
    )
    .await;
    assert_eq!(ticks_status, StatusCode::OK);
    assert_eq!(ticks_json["requestedTickCount"], 2);
    assert_eq!(ticks_json["tickCount"], 2);
    assert_eq!(ticks_json["whatToShow"], "TRADES");
    assert_eq!(ticks_json["ticks"][0]["kind"], "last");

    let (chain_status, chain_json) = request_json_with_state(
        state.clone(),
        "GET",
        &format!("/v1/options/chains/265598{underlying_query}"),
        [("X-Request-ID", "chain")],
        "",
    )
    .await;
    assert_eq!(chain_status, StatusCode::OK);
    assert_eq!(chain_json["strikes"][1], "210");
    assert_eq!(chain_json["rights"][0], "C");

    let (option_contract_status, option_contract_json) = request_json_with_state(
        state.clone(),
        "GET",
        &format!("/v1/options/contracts/resolve{option_resolve_query}"),
        [("X-Request-ID", "option-contract")],
        "",
    )
    .await;
    assert_eq!(option_contract_status, StatusCode::OK);
    assert_eq!(option_contract_json["contract"]["conID"], 76792991);
    assert_eq!(option_contract_json["right"], "C");

    let (option_details_status, option_details_json) = request_json_with_state(
        state.clone(),
        "GET",
        &format!("/v1/options/contracts/76792991/details{option_query}"),
        [("X-Request-ID", "option-details")],
        "",
    )
    .await;
    assert_eq!(option_details_status, StatusCode::OK);
    assert_eq!(option_details_json["contract"]["securityType"], "OPT");

    let (option_quote_status, option_quote_json) = request_json_with_state(
        state.clone(),
        "GET",
        &format!("/v1/options/quotes/76792991{option_query}"),
        [("X-Request-ID", "option-quote")],
        "",
    )
    .await;
    assert_eq!(option_quote_status, StatusCode::OK);
    assert_eq!(
        option_quote_json["contract"]["contract"]["securityType"],
        "OPT"
    );
    assert_eq!(option_quote_json["greeks"]["delta"], "0.48");
    let market_snapshot = state.market_state.snapshot();
    assert!(market_snapshot.market_events_are_replayable());
    assert!(market_snapshot.option_chain_and_quote_are_complete());
}

#[tokio::test]
async fn connected_fixture_rejects_mismatched_market_queries() {
    let state = AppState::connected_fixture();

    let (contract_status, contract_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/contracts/resolve?symbol=MSFT&securityType=STK",
        [("X-Request-ID", "wrong-contract")],
        "",
    )
    .await;
    assert_eq!(contract_status, StatusCode::BAD_REQUEST);
    assert_eq!(contract_json["code"], "invalidContract");
    assert!(contract_json["message"]
        .as_str()
        .expect("message")
        .contains("symbol=MSFT"));

    let (bars_status, bars_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/bars/265598?timeframe=1x&barLimit=3&duration=1%20D&whatToShow=TRADES&regularTradingHoursOnly=true",
        [("X-Request-ID", "invalid-bars")],
        "",
    )
    .await;
    assert_eq!(bars_status, StatusCode::BAD_REQUEST);
    assert_eq!(bars_json["code"], "invalidContract");
    assert!(bars_json["message"]
        .as_str()
        .expect("message")
        .contains("timeframe unit"));

    let (ticks_status, ticks_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/ticks/265598?numberOfTicks=0&whatToShow=TRADES&regularTradingHoursOnly=true&ignoreSize=true&endDateTime=20270115%2013%3A30%3A00%20US%2FEastern",
        [("X-Request-ID", "invalid-ticks")],
        "",
    )
    .await;
    assert_eq!(ticks_status, StatusCode::BAD_REQUEST);
    assert_eq!(ticks_json["code"], "invalidContract");
    assert!(ticks_json["message"]
        .as_str()
        .expect("message")
        .contains("numberOfTicks"));

    let (option_status, option_json) = request_json_with_state(
        state,
        "GET",
        "/v1/options/contracts/resolve?underlyingConID=265598&symbol=AAPL&expiration=20270115&strike=999&right=C&exchange=SMART&currency=USD",
        [("X-Request-ID", "wrong-option")],
        "",
    )
    .await;
    assert_eq!(option_status, StatusCode::BAD_REQUEST);
    assert_eq!(option_json["code"], "invalidContract");
    assert!(option_json["message"]
        .as_str()
        .expect("message")
        .contains("strike=999"));
}

#[tokio::test]
async fn connected_fixture_manages_market_subscription_routes() {
    let state = AppState::connected_fixture();

    let (quote_status, quote_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/quotes/265598/subscribe",
        [("X-Request-ID", "quote-subscribe")],
        "",
    )
    .await;
    assert_eq!(quote_status, StatusCode::OK);
    assert_eq!(quote_json["contract"]["conID"], 265598);
    assert_eq!(quote_json["bid"], "208.10");
    assert_eq!(quote_json["ask"], "208.14");
    assert_eq!(quote_json["marketDataType"], "delayed");
    assert!(state
        .market_subscriptions
        .is_active(MarketDataStreamKind::Quote, market_read_model::AAPL_CON_ID));

    let (stop_quote_status, stop_quote_json) = request_json_with_state(
        state.clone(),
        "DELETE",
        "/v1/quotes/265598/subscribe",
        [("X-Request-ID", "quote-unsubscribe")],
        "",
    )
    .await;
    assert_eq!(stop_quote_status, StatusCode::OK);
    assert_eq!(stop_quote_json["connectionState"], "connected");
    assert_eq!(
        stop_quote_json["serverTimeProvenance"]["source"],
        "twsReqCurrentTime"
    );
    assert!(!state
        .market_subscriptions
        .is_active(MarketDataStreamKind::Quote, market_read_model::AAPL_CON_ID));

    let (option_quote_status, option_quote_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/quotes/76792991/subscribe",
        [("X-Request-ID", "option-quote-subscribe")],
        "",
    )
    .await;
    assert_eq!(option_quote_status, StatusCode::OK);
    assert_eq!(option_quote_json["contract"]["conID"], 76792991);
    assert_eq!(option_quote_json["contract"]["securityType"], "OPT");
    assert_eq!(option_quote_json["bid"], "3.35");
    assert_eq!(option_quote_json["ask"], "3.45");
    assert!(state.market_subscriptions.is_active(
        MarketDataStreamKind::Quote,
        market_read_model::AAPL_OPTION_CON_ID
    ));

    let (stop_option_quote_status, stop_option_quote_json) = request_json_with_state(
        state.clone(),
        "DELETE",
        "/v1/quotes/76792991/subscribe",
        [("X-Request-ID", "option-quote-unsubscribe")],
        "",
    )
    .await;
    assert_eq!(stop_option_quote_status, StatusCode::OK);
    assert_eq!(stop_option_quote_json["connectionState"], "connected");
    assert!(!state.market_subscriptions.is_active(
        MarketDataStreamKind::Quote,
        market_read_model::AAPL_OPTION_CON_ID
    ));

    let (bars_status, bars_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/bars/265598/stream",
        [("X-Request-ID", "bars-subscribe")],
        "",
    )
    .await;
    assert_eq!(bars_status, StatusCode::OK);
    assert_eq!(bars_json["stream"], "bars");
    assert_eq!(bars_json["status"], "active");
    assert!(state
        .market_subscriptions
        .is_active(MarketDataStreamKind::Bars, market_read_model::AAPL_CON_ID));
    assert_eq!(state.market_subscriptions.snapshot().len(), 1);

    let (stop_bars_status, stop_bars_json) = request_json_with_state(
        state.clone(),
        "DELETE",
        "/v1/bars/265598/stream",
        [("X-Request-ID", "bars-unsubscribe")],
        "",
    )
    .await;
    assert_eq!(stop_bars_status, StatusCode::OK);
    assert_eq!(stop_bars_json["stream"], "bars");
    assert_eq!(stop_bars_json["status"], "stopped");
    assert!(!state
        .market_subscriptions
        .is_active(MarketDataStreamKind::Bars, market_read_model::AAPL_CON_ID));
    assert!(state.market_subscriptions.snapshot().is_empty());

    let event_names = state
        .event_hub
        .replay()
        .iter()
        .map(|event| event.event.clone())
        .collect::<Vec<_>>();
    assert!(event_names.contains(&"quote.snapshot".to_string()));
    assert!(event_names.contains(&"bars.snapshot".to_string()));

    let (bad_status, bad_json) = request_json_with_state(
        state,
        "POST",
        "/v1/quotes/999999/subscribe",
        [("X-Request-ID", "bad-quote-subscribe")],
        "",
    )
    .await;
    assert_eq!(bad_status, StatusCode::NOT_FOUND);
    assert_eq!(bad_json["code"], "invalidContract");
}

#[tokio::test]
async fn disconnected_subscription_routes_fail_closed() {
    let (status, json) = request_json("POST", "/v1/quotes/265598/subscribe").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "disconnectedGateway");
    assert_eq!(json["requestID"], "POST /v1/quotes/265598/subscribe");
}

#[test]
fn market_data_fixture_reconstructs_from_broker_callbacks() {
    let deterministic = MarketDataFixture::deterministic();
    let callbacks = deterministic.broker_callback_transcript();
    let reconstructed = MarketDataFixture::from_broker_callbacks(&callbacks);

    assert_eq!(callbacks.len(), 10);
    assert_eq!(reconstructed.stock_contract, deterministic.stock_contract);
    assert_eq!(reconstructed.option_contract, deterministic.option_contract);
    assert_eq!(reconstructed.stock_details, deterministic.stock_details);
    assert_eq!(reconstructed.option_details, deterministic.option_details);
    assert_eq!(reconstructed.market_rule, deterministic.market_rule);
    assert_eq!(reconstructed.quote, deterministic.quote);
    assert_eq!(reconstructed.historical_bars, deterministic.historical_bars);
    assert_eq!(
        reconstructed.historical_ticks,
        deterministic.historical_ticks
    );
    assert_eq!(reconstructed.option_chain, deterministic.option_chain);
    assert_eq!(reconstructed.option_quote, deterministic.option_quote);
    assert_eq!(reconstructed.pacing, deterministic.pacing);
    assert!(reconstructed.market_event_payloads_match(&deterministic));
    assert!(reconstructed.contract_shapes_are_valid());
    assert!(reconstructed.market_rule_is_sorted_and_aligned());
    assert!(reconstructed.quote_is_fresh_and_ordered());
    assert!(reconstructed.bars_and_ticks_are_sorted());
    assert!(reconstructed.option_chain_and_quote_are_complete());
    assert!(reconstructed.pacing_rules_are_fail_closed());
    assert!(reconstructed.market_events_are_replayable());
}

#[test]
fn shared_callback_stores_rebuild_snapshots_and_emit_events() {
    let account_fixture = AccountStateFixture::deterministic();
    let account_store =
        AccountStateStore::from_callbacks(&account_fixture.broker_callback_transcript());
    let account_snapshot = account_store.snapshot();
    assert_eq!(account_snapshot.accounts, account_fixture.accounts);
    assert_eq!(account_snapshot.summaries, account_fixture.summaries);
    assert_eq!(account_snapshot.positions, account_fixture.positions);
    assert_eq!(account_snapshot.open_orders, account_fixture.open_orders);
    assert_eq!(
        account_snapshot.completed_orders,
        account_fixture.completed_orders
    );
    assert_eq!(account_snapshot.fills, account_fixture.fills);
    assert!(account_snapshot.has_replayable_events());

    let summary = account_fixture.summaries[0].clone();
    let account_events = account_store.record(AccountStateCallback::AccountSummary {
        summary: summary.clone(),
    });
    assert_eq!(account_events[0].event, "account.summary");
    assert_eq!(
        account_store
            .snapshot()
            .summary_for_account(PAPER_ACCOUNT_ID),
        Some(summary)
    );

    let market_fixture = MarketDataFixture::deterministic();
    let market_store =
        MarketDataStore::from_callbacks(&market_fixture.broker_callback_transcript());
    let market_snapshot = market_store.snapshot();
    assert_eq!(market_snapshot.stock_details, market_fixture.stock_details);
    assert_eq!(market_snapshot.market_rule, market_fixture.market_rule);
    assert_eq!(market_snapshot.quote, market_fixture.quote);
    assert_eq!(
        market_snapshot.historical_bars,
        market_fixture.historical_bars
    );
    assert_eq!(
        market_snapshot.historical_ticks,
        market_fixture.historical_ticks
    );
    assert_eq!(market_snapshot.option_chain, market_fixture.option_chain);
    assert_eq!(
        market_snapshot.option_contract,
        market_fixture.option_contract
    );
    assert_eq!(market_snapshot.option_quote, market_fixture.option_quote);
    assert!(market_snapshot.market_events_are_replayable());

    let quote = market_fixture.quote.clone();
    let market_events = market_store.record(MarketDataCallback::Quote {
        quote: Box::new(quote.clone()),
    });
    assert_eq!(market_events[0].event, "quote.snapshot");
    assert_eq!(
        market_store
            .snapshot()
            .quote_for_con_id(market_read_model::AAPL_CON_ID),
        Some(quote)
    );
}

#[test]
fn broker_callback_router_projects_domain_callbacks_into_shared_stores_and_event_hub() {
    let router = BrokerCallbackRouter::deterministic();
    let account_fixture = AccountStateFixture::deterministic();
    let market_fixture = MarketDataFixture::deterministic();

    router.route(BrokerCallback::Protocol {
        event: broker_protocol::BrokerProtocolEvent::connect_requested(),
    });
    router.route(BrokerCallback::Protocol {
        event: broker_protocol::BrokerProtocolEvent::socket_connected(),
    });
    let startup_frames = vec![
        vec![
            tws_wire::IN_NEXT_VALID_ID.to_string(),
            tws_wire::REQUEST_VERSION.to_string(),
            broker_protocol::FIXTURE_NEXT_VALID_ORDER_ID.to_string(),
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
    ];
    let mut ready = None;
    for fields in startup_frames {
        let callback = decode_tws_callback(fields);
        ready = router.route_tws_callback(&callback);
    }
    let ready = ready.expect("managed accounts routes to session");
    assert_eq!(ready.published_event_names, ["connection.status"]);
    assert_eq!(ready.session.connection_state.as_wire_value(), "connected");
    assert!(ready.session.is_ready());

    let account_callback = decode_tws_callback(
        tws_wire::domain_callback_fields(&BrokerCallback::Account {
            callback: AccountStateCallback::AccountSummary {
                summary: account_fixture.summaries[0].clone(),
            },
        })
        .expect("account domain callback fields"),
    );
    let account = router
        .route_tws_callback(&account_callback)
        .expect("account domain callback routes");
    assert_eq!(account.published_event_names, ["account.summary"]);
    assert_eq!(
        router
            .account_snapshot()
            .summary_for_account(PAPER_ACCOUNT_ID),
        Some(account_fixture.summaries[0].clone())
    );

    let market_callback = decode_tws_callback(
        tws_wire::domain_callback_fields(&BrokerCallback::MarketData {
            callback: MarketDataCallback::Quote {
                quote: Box::new(market_fixture.quote.clone()),
            },
        })
        .expect("market domain callback fields"),
    );
    let market = router
        .route_tws_callback(&market_callback)
        .expect("market domain callback routes");
    assert_eq!(market.published_event_names, ["quote.snapshot"]);
    assert_eq!(
        router
            .market_snapshot()
            .quote_for_con_id(market_read_model::AAPL_CON_ID),
        Some(market_fixture.quote)
    );

    let paper_order = order_routing::paper_order_body();
    let paper_key =
        order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
    let order_callback = decode_tws_callback(
        tws_wire::domain_callback_fields(&BrokerCallback::OrderRouting {
            callback: order_routing::OrderRoutingCallback::PlacementAcknowledgement {
                acknowledgement: Box::new(
                    order_routing::paper_acknowledgement(&paper_order, Some(&paper_key), false)
                        .expect("paper acknowledgement"),
                ),
            },
        })
        .expect("order domain callback fields"),
    );
    let order = router
        .route_tws_callback(&order_callback)
        .expect("order domain callback routes");
    assert!(order
        .published_event_names
        .iter()
        .any(|event| event == "order.status"));
    assert!(router
        .order_routing_snapshot()
        .placement_acknowledgements
        .iter()
        .any(|ack| ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID));

    let replay = router.event_replay();
    let replay_names = replay
        .iter()
        .map(|event| event.event.as_str())
        .collect::<Vec<_>>();
    for expected in [
        "connection.status",
        "account.summary",
        "quote.snapshot",
        "order.status",
    ] {
        assert!(replay_names.contains(&expected));
    }
}

#[test]
fn tws_callback_record_decoder_routes_e_wrapper_style_records() {
    let router = BrokerCallbackRouter::deterministic();
    let account_fixture = AccountStateFixture::deterministic();
    let market_fixture = MarketDataFixture::deterministic();
    let paper_order = order_routing::paper_order_body();
    let paper_key =
        order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
    let preview = order_routing::preview_from_mapped_order(&paper_order, Some(&paper_key))
        .expect("paper preview");
    let acknowledgement =
        order_routing::paper_acknowledgement(&paper_order, Some(&paper_key), false)
            .expect("paper acknowledgement");
    let initial_fill: agentic_trading_adapter::broker_read_model::FillReport =
        serde_json::from_value(account_fixture.initial_fill_event.payload.clone())
            .expect("initial fill payload");
    let commissioned_fill: agentic_trading_adapter::broker_read_model::FillReport =
        serde_json::from_value(
            account_fixture
                .commission_update_event
                .payload
                .get("fill")
                .cloned()
                .expect("commission fill payload"),
        )
        .expect("commission fill");

    let frames = vec![
        tws_wire::callback_record_fields("accountSummary", &account_fixture.summaries[0])
            .expect("accountSummary record"),
        tws_wire::callback_record_fields("position", &account_fixture.positions[0])
            .expect("position record"),
        tws_wire::callback_record_fields(
            "orderStatus",
            &account_fixture.lifecycle_records[0].status_timeline[0],
        )
        .expect("orderStatus record"),
        tws_wire::callback_record_fields("execDetails", &initial_fill).expect("execDetails record"),
        tws_wire::callback_record_fields(
            "commissionReport",
            &json!({
                "brokerOrderID": commissioned_fill.broker_order_id,
                "executionID": commissioned_fill.fill.id,
                "commission": commissioned_fill.commission.expect("commission"),
                "commissionReportedAt": commissioned_fill
                    .commission_reported_at
                    .expect("commission reported at"),
                "reportedAt": commissioned_fill.reported_at
            }),
        )
        .expect("commissionReport record"),
        tws_wire::callback_record_fields("contractDetails", &market_fixture.stock_details)
            .expect("contractDetails record"),
        tws_wire::callback_record_fields("marketRule", &market_fixture.market_rule)
            .expect("marketRule record"),
        tws_wire::callback_record_fields("tickPrice", &market_fixture.quote)
            .expect("tickPrice record"),
        tws_wire::callback_record_fields("historicalData", &market_fixture.historical_bars)
            .expect("historicalData record"),
        tws_wire::callback_record_fields("historicalTicks", &market_fixture.historical_ticks)
            .expect("historicalTicks record"),
        tws_wire::callback_record_fields(
            "securityDefinitionOptionParameter",
            &market_fixture.option_chain,
        )
        .expect("securityDefinitionOptionParameter record"),
        tws_wire::callback_record_fields("optionContract", &market_fixture.option_contract)
            .expect("optionContract record"),
        tws_wire::callback_record_fields("optionContractDetails", &market_fixture.option_details)
            .expect("optionContractDetails record"),
        tws_wire::callback_record_fields("tickOptionComputation", &market_fixture.option_quote)
            .expect("tickOptionComputation record"),
        tws_wire::callback_record_fields("whatIfPreview", &preview).expect("whatIfPreview record"),
        tws_wire::callback_record_fields("placeOrderAcknowledgement", &acknowledgement)
            .expect("placeOrderAcknowledgement record"),
    ];

    let mut decoded_methods = Vec::new();
    for fields in frames {
        let callback = decode_tws_callback(fields);
        if let tws_wire::TwsCallback::CallbackRecord { method, .. } = &callback {
            decoded_methods.push(method.clone());
        }
        router
            .route_tws_callback(&callback)
            .expect("callback record routes");
    }

    assert!(decoded_methods.contains(&"accountSummary".to_string()));
    assert!(decoded_methods.contains(&"tickOptionComputation".to_string()));
    assert!(decoded_methods.contains(&"placeOrderAcknowledgement".to_string()));
    assert_eq!(
        router
            .account_snapshot()
            .summary_for_account(PAPER_ACCOUNT_ID),
        Some(account_fixture.summaries[0].clone())
    );
    assert_eq!(
        router
            .market_snapshot()
            .quote_for_con_id(market_read_model::AAPL_CON_ID),
        Some(market_fixture.quote)
    );
    assert!(router
        .order_routing_snapshot()
        .placement_acknowledgements
        .iter()
        .any(|ack| ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID));
    let replay_names = router
        .event_replay()
        .iter()
        .map(|event| event.event.clone())
        .collect::<Vec<_>>();
    for expected in [
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
    ] {
        assert!(replay_names.contains(&expected.to_string()), "{expected}");
    }
}

#[test]
fn tws_field_callback_decoder_routes_key_value_records() {
    let evidence =
        agentic_trading_adapter::broker_callback_router::deterministic_field_callback_decoder_evidence();

    assert_eq!(
        evidence.decoded_methods,
        vec![
            "accountSummary",
            "position",
            "orderStatus",
            "tickPrice",
            "placeOrderAcknowledgement"
        ]
    );
    assert!(evidence
        .decoded_tws_callbacks
        .iter()
        .all(|callback| matches!(callback, tws_wire::TwsCallback::FieldRecord { .. })));
    assert_eq!(evidence.field_pair_counts, vec![8, 12, 14, 19, 9]);
    assert_eq!(evidence.malformed_error.code, "invalidFieldCallback");
    assert!(evidence
        .outcomes
        .iter()
        .any(|outcome| outcome.route == "account"));
    assert!(evidence
        .outcomes
        .iter()
        .any(|outcome| outcome.route == "marketData"));
    assert!(evidence
        .outcomes
        .iter()
        .any(|outcome| outcome.route == "orderRouting"));
    assert!(evidence
        .account_state
        .summary_for_account(PAPER_ACCOUNT_ID)
        .is_some());
    assert!(evidence
        .account_state
        .positions_for_account(PAPER_ACCOUNT_ID)
        .iter()
        .any(|position| position.instrument.con_id == market_read_model::AAPL_CON_ID));
    assert_eq!(
        evidence
            .market_state
            .quote_for_con_id(market_read_model::AAPL_CON_ID),
        Some(evidence.market_state.quote.clone())
    );
    assert!(evidence
        .order_routing_state
        .placement_acknowledgements
        .iter()
        .any(|ack| ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID));
    for expected in [
        "account.summary",
        "position.snapshot",
        "order.status",
        "quote.snapshot",
    ] {
        assert!(
            evidence.event_replay_names.contains(&expected.to_string()),
            "{expected}"
        );
    }
}

#[tokio::test]
async fn app_state_tws_callback_records_update_http_read_routes() {
    let mut state = AppState::connected_fixture();
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
    let paper_key =
        order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);
    let mut acknowledgement =
        order_routing::paper_acknowledgement(&paper_order, Some(&paper_key), false)
            .expect("paper acknowledgement");
    acknowledgement.broker_order_id = "IBKR-HTTP-CB-9001".to_string();
    acknowledgement.acknowledged_at = "2027-01-15T18:31:03Z".to_string();

    let frames = [
        tws_wire::callback_record_fields("accountSummary", &summary)
            .expect("accountSummary record"),
        tws_wire::callback_record_fields("orderStatus", &order_status).expect("orderStatus record"),
        tws_wire::callback_record_fields("tickPrice", &quote).expect("tickPrice record"),
        tws_wire::callback_record_fields("placeOrderAcknowledgement", &acknowledgement)
            .expect("placeOrderAcknowledgement record"),
    ];

    for fields in frames {
        let callback = decode_tws_callback(fields);
        state
            .record_tws_callback(&callback)
            .expect("callback record routes through AppState");
    }

    let (summary_status, summary_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts/DU1234567/summary",
        [("X-Request-ID", "summary-after-callback")],
        "",
    )
    .await;
    assert_eq!(summary_status, StatusCode::OK);
    assert_eq!(summary_json["netLiquidation"], "250000.42");
    assert_eq!(summary_json["buyingPower"], "125000.21");

    let (orders_status, orders_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/accounts/DU1234567/orders/open",
        [("X-Request-ID", "orders-after-callback")],
        "",
    )
    .await;
    assert_eq!(orders_status, StatusCode::OK);
    assert!(orders_json
        .as_array()
        .expect("orders array")
        .iter()
        .any(|order| {
            order["brokerOrderID"] == order_status.broker_order_id
                && order["remainingQuantity"] == "3"
        }));

    let (quote_status, quote_json) = request_json_with_state(
        state.clone(),
        "GET",
        "/v1/quotes/265598",
        [("X-Request-ID", "quote-after-callback")],
        "",
    )
    .await;
    assert_eq!(quote_status, StatusCode::OK);
    assert_eq!(quote_json["bid"], "209.01");
    assert_eq!(quote_json["ask"], "209.05");
    assert!(state
        .order_routing_state
        .snapshot()
        .placement_acknowledgements
        .iter()
        .any(|ack| ack.broker_order_id == "IBKR-HTTP-CB-9001"));

    let replay_names = state
        .event_hub
        .replay()
        .iter()
        .map(|event| event.event.clone())
        .collect::<Vec<_>>();
    for expected in ["account.summary", "order.status", "quote.snapshot"] {
        assert!(replay_names.contains(&expected.to_string()), "{expected}");
    }
}

#[tokio::test]
async fn connected_fixture_previews_and_acknowledges_paper_order_routing() {
    let state = AppState::connected_fixture();
    let body = order_routing::paper_order_body().to_string();
    let key = order_routing::idempotency_key_for_request_id(order_routing::PAPER_ORDER_REQUEST_ID);

    let (preview_status, preview_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/preview",
        [("Idempotency-Key", key.as_str())],
        &body,
    )
    .await;
    assert_eq!(preview_status, StatusCode::OK);
    assert_eq!(preview_json["brokerAccepted"], true);
    assert_eq!(
        preview_json["intentID"],
        order_routing::PAPER_ORDER_REQUEST_ID
    );

    let (paper_status, paper_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/paper",
        [("Idempotency-Key", key.as_str())],
        &body,
    )
    .await;
    assert_eq!(paper_status, StatusCode::ACCEPTED);
    assert_eq!(paper_json["status"], "accepted");
    assert_eq!(
        paper_json["brokerOrderID"],
        order_routing::PAPER_BROKER_ORDER_ID
    );
    assert_eq!(paper_json["environment"], "ibkrPaper");

    let (duplicate_status, duplicate_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/paper",
        [("Idempotency-Key", key.as_str())],
        &body,
    )
    .await;
    assert_eq!(duplicate_status, StatusCode::ACCEPTED);
    assert_eq!(duplicate_json["status"], "duplicate");
    assert_eq!(
        duplicate_json["brokerOrderID"],
        order_routing::PAPER_BROKER_ORDER_ID
    );
    let routing_state = state.order_routing_state.snapshot();
    assert_eq!(routing_state.previews.len(), 1);
    assert_eq!(routing_state.placement_acknowledgements.len(), 2);
    assert!(routing_state
        .placement_acknowledgements
        .iter()
        .any(|ack| ack.status == "duplicate"));
    assert!(routing_state
        .event_transcript
        .iter()
        .any(|event| event.event == "order.status"));
}

#[test]
fn order_routing_callbacks_reconstruct_acknowledgements_and_events() {
    let account_state = AccountStateFixture::default();
    let callbacks = order_routing::deterministic_routing_callback_transcript(
        &account_state.positions,
        &account_state.open_orders,
    );
    let state = order_routing::OrderRoutingCallbackState::from_broker_callbacks(&callbacks);

    assert_eq!(callbacks.len(), 10);
    assert_eq!(state.previews.len(), 1);
    assert!(state.previews[0].broker_accepted);
    assert!(state.placement_acknowledgements.iter().any(|ack| {
        ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID
            && ack.environment == BrokerEnvironment::IbkrPaper
            && ack.status == "accepted"
    }));
    assert!(state.placement_acknowledgements.iter().any(|ack| {
        ack.broker_order_id == order_routing::LIVE_BROKER_ORDER_ID
            && ack.environment == BrokerEnvironment::IbkrLive
            && ack.status == "accepted"
    }));
    assert!(state.placement_acknowledgements.iter().any(|ack| {
        ack.status == "duplicate" && ack.broker_order_id == order_routing::PAPER_BROKER_ORDER_ID
    }));
    assert!(state.placement_acknowledgements.iter().any(|ack| {
        ack.broker_order_id == order_routing::LIVE_OPTION_BROKER_ORDER_ID
            && ack.environment == BrokerEnvironment::IbkrLive
    }));
    assert!(state.placement_acknowledgements.iter().any(|ack| {
        ack.broker_order_id == order_routing::LIVE_COMBO_BROKER_ORDER_ID
            && ack.environment == BrokerEnvironment::IbkrLive
    }));
    assert_eq!(
        state.modification_acknowledgements[0].broker_order_id,
        order_routing::MODIFIED_BROKER_ORDER_ID
    );
    assert_eq!(state.cancel_responses[0].status.status, "cancelled");
    assert_eq!(
        state.global_cancel_acknowledgements[0].environment,
        BrokerEnvironment::IbkrPaper
    );
    assert_eq!(state.option_exercise_acknowledgements[0].action, "exercise");
    assert!(state.routing_events_are_replayable());
}

#[tokio::test]
async fn connected_fixture_acknowledges_live_modify_global_cancel_and_option_exercise() {
    let live_state = AppState::live_connected_fixture();
    let live_body = order_routing::live_order_body().to_string();
    let live_key =
        order_routing::idempotency_key_for_request_id(order_routing::LIVE_ORDER_REQUEST_ID);
    let (live_status, live_json) = request_json_with_state(
        live_state,
        "POST",
        "/v1/orders/live",
        [("Idempotency-Key", live_key.as_str())],
        &live_body,
    )
    .await;
    assert_eq!(live_status, StatusCode::ACCEPTED);
    assert_eq!(live_json["environment"], "ibkrLive");
    assert_eq!(live_json["status"], "accepted");

    let state = AppState::connected_fixture();
    let modify_body = order_routing::modification_order_body(
        agentic_trading_adapter::adapter_contract::BrokerEnvironment::IbkrPaper,
    )
    .to_string();
    let modify_key =
        order_routing::idempotency_key_for_request_id(order_routing::MODIFY_REQUEST_ID);
    let (modify_status, modify_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/IBKR-1001/modify",
        [("Idempotency-Key", modify_key.as_str())],
        &modify_body,
    )
    .await;
    assert_eq!(modify_status, StatusCode::ACCEPTED);
    assert_eq!(modify_json["brokerOrderID"], "IBKR-1001");

    let (cancel_status, cancel_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/1001/cancel?accountID=DU1234567",
        [("X-Request-ID", "cancel-1001")],
        "{}",
    )
    .await;
    assert_eq!(cancel_status, StatusCode::OK);
    assert_eq!(cancel_json["status"]["status"], "cancelled");
    assert_eq!(cancel_json["status"]["accountID"], "DU1234567");

    let (missing_cancel_account_status, missing_cancel_account_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/1001/cancel",
        [("X-Request-ID", "cancel-missing-account")],
        "{}",
    )
    .await;
    assert_eq!(missing_cancel_account_status, StatusCode::BAD_REQUEST);
    assert_eq!(missing_cancel_account_json["code"], "rejectedOrder");
    assert!(missing_cancel_account_json["message"]
        .as_str()
        .expect("missing account cancel message")
        .contains("accountID"));

    let (wrong_cancel_account_status, wrong_cancel_account_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/1001/cancel?accountID=U1234567",
        [("X-Request-ID", "cancel-wrong-account")],
        "{}",
    )
    .await;
    assert_eq!(wrong_cancel_account_status, StatusCode::NOT_FOUND);
    assert_eq!(wrong_cancel_account_json["code"], "orderNotFound");

    let global_body = order_routing::global_cancel_body().to_string();
    let (global_status, global_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/global-cancel",
        [("X-Request-ID", "global-cancel-valid")],
        &global_body,
    )
    .await;
    assert_eq!(global_status, StatusCode::ACCEPTED);
    assert_eq!(global_json["status"], "accepted");
    assert_eq!(global_json["accountID"], "DU1234567");

    let exercise_body = order_routing::option_exercise_body(
        agentic_trading_adapter::adapter_contract::BrokerEnvironment::IbkrPaper,
        "exercise",
    )
    .to_string();
    let exercise_key =
        order_routing::idempotency_key_for_request_id(order_routing::OPTION_EXERCISE_REQUEST_ID);
    let (exercise_status, exercise_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/options/exercise",
        [("Idempotency-Key", exercise_key.as_str())],
        &exercise_body,
    )
    .await;
    assert_eq!(exercise_status, StatusCode::ACCEPTED);
    assert_eq!(exercise_json["action"], "exercise");
    assert_eq!(exercise_json["conID"], 76792991);
    let routing_state = state.order_routing_state.snapshot();
    assert_eq!(routing_state.modification_acknowledgements.len(), 1);
    assert_eq!(routing_state.cancel_responses.len(), 1);
    assert_eq!(routing_state.global_cancel_acknowledgements.len(), 1);
    assert_eq!(routing_state.option_exercise_acknowledgements.len(), 1);
    assert!(routing_state.routing_events_are_replayable());
}

#[tokio::test]
async fn connected_fixture_acknowledges_live_option_and_combo_routes() {
    let state = AppState::live_connected_fixture();

    let option_body = order_routing::live_option_order_body().to_string();
    let option_key =
        order_routing::idempotency_key_for_request_id(order_routing::LIVE_OPTION_ORDER_REQUEST_ID);
    let (option_status, option_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/live",
        [("Idempotency-Key", option_key.as_str())],
        &option_body,
    )
    .await;
    assert_eq!(option_status, StatusCode::ACCEPTED);
    assert_eq!(
        option_json["brokerOrderID"],
        order_routing::LIVE_OPTION_BROKER_ORDER_ID
    );
    assert_eq!(option_json["environment"], "ibkrLive");

    let combo_body = order_routing::live_combo_order_body().to_string();
    let combo_key =
        order_routing::idempotency_key_for_request_id(order_routing::LIVE_COMBO_ORDER_REQUEST_ID);
    let (combo_status, combo_json) = request_json_with_state(
        state.clone(),
        "POST",
        "/v1/orders/live",
        [("Idempotency-Key", combo_key.as_str())],
        &combo_body,
    )
    .await;
    assert_eq!(combo_status, StatusCode::ACCEPTED);
    assert_eq!(
        combo_json["brokerOrderID"],
        order_routing::LIVE_COMBO_BROKER_ORDER_ID
    );

    let bad_combo_body = order_routing::live_single_leg_combo_order_body().to_string();
    let (bad_combo_status, bad_combo_json) = request_json_with_state(
        AppState::live_connected_fixture(),
        "POST",
        "/v1/orders/live",
        [("Idempotency-Key", combo_key.as_str())],
        &bad_combo_body,
    )
    .await;
    assert_eq!(bad_combo_status, StatusCode::BAD_REQUEST);
    assert_eq!(bad_combo_json["code"], "rejectedOrder");
    assert!(bad_combo_json["message"]
        .as_str()
        .expect("message")
        .contains("comboLegs"));
}

#[tokio::test]
async fn connected_fixture_rejects_wrong_execution_confirmations_before_acknowledgement() {
    let state = AppState::connected_fixture();
    let mut body = order_routing::option_exercise_body(
        agentic_trading_adapter::adapter_contract::BrokerEnvironment::IbkrPaper,
        "exercise",
    );
    body["confirmationText"] = serde_json::json!("WRONG");
    let key =
        order_routing::idempotency_key_for_request_id(order_routing::OPTION_EXERCISE_REQUEST_ID);
    let (status, json) = request_json_with_state(
        state,
        "POST",
        "/v1/options/exercise",
        [("Idempotency-Key", key.as_str())],
        &body.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["code"], "rejectedOrder");
    assert!(json["message"]
        .as_str()
        .expect("message")
        .contains("confirmation"));
}

#[test]
fn verifier_api_surface_approves_frozen_contract() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "api-surface"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][1]["id"], "route-count");
}

#[test]
fn verifier_audit_idempotency_approves_replay_and_reject_semantics() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "audit-idempotency"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][2]["id"], "body-mismatch-rejects");
}

#[test]
fn verifier_startup_safety_approves_paper_live_port_and_gate_matrix() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "startup-safety"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "paper-ports");
    assert_eq!(json["checks"][4]["id"], "duplicate-client-id");
}

#[test]
fn verifier_server_time_provenance_approves_readiness_states() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "server-time-provenance"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(
        json["evidence"]["connected"]["serverTimeProvenance"]["source"],
        "twsReqCurrentTime"
    );
    assert_eq!(
        json["evidence"]["stale"]["orderIdAllocationAvailable"],
        false
    );
}

#[test]
fn verifier_broker_session_management_approves_protocol_state_machine() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "broker-session-management"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][1]["id"], "callback-backed-readiness");
    assert_eq!(
        json["evidence"]["connected"]["serverTimeProvenance"]["source"],
        "twsReqCurrentTime"
    );
    assert_eq!(
        json["evidence"]["readLoopFailure"]["code"],
        "disconnectedGateway"
    );
}

#[test]
fn verifier_tws_wire_codec_approves_framing_and_callback_replay() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "tws-wire-codec"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "outbound-request-codes");
    assert_eq!(json["evidence"]["startApiFields"][0], "71");
    assert_eq!(
        json["evidence"]["session"]["serverTimeProvenance"]["source"],
        "twsReqCurrentTime"
    );
    assert_eq!(
        json["evidence"]["malformedError"]["code"],
        "missingTrailingNul"
    );
}

#[test]
fn verifier_tws_transport_startup_approves_async_read_loop() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "tws-transport-startup"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "startup-requests-written");
    assert_eq!(json["evidence"]["readySession"]["termination"], "ready");
    assert_eq!(
        json["evidence"]["readySession"]["session"]["connectionState"],
        "connected"
    );
    assert_eq!(
        json["evidence"]["reconnectingSession"]["session"]["connectionState"],
        "reconnecting"
    );
}

#[test]
fn verifier_tws_tcp_startup_approves_loopback_socket_path() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "tws-tcp-startup"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "loopback-tcp-endpoint");
    assert_eq!(json["evidence"]["endpoint"]["host"], "127.0.0.1");
    assert_eq!(
        json["evidence"]["transcript"]["session"]["connectionState"],
        "connected"
    );
    assert_eq!(
        json["evidence"]["gatewayObservedRequests"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn verifier_broker_startup_config_approves_endpoint_policy_and_transport() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "broker-startup-config"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "startup-policy-before-connect");
    assert_eq!(
        json["evidence"]["startup"]["startupDecision"]["isApproved"],
        true
    );
    assert_eq!(
        json["evidence"]["startup"]["transcript"]["endpoint"]["port"],
        4002
    );
    assert_eq!(
        json["evidence"]["startup"]["transcript"]["session"]["connectionState"],
        "connected"
    );
    assert_eq!(
        json["evidence"]["liveGateRejection"]["code"],
        "startupRejected"
    );
}

#[test]
fn verifier_http_startup_state_approves_status_projection() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "http-startup-state"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "default-fails-closed");
    assert_eq!(
        json["evidence"]["disconnected"]["connectionState"],
        "disconnected"
    );
    assert_eq!(
        json["evidence"]["connected"]["connectionState"],
        "connected"
    );
    assert_eq!(json["evidence"]["tcp"]["connectionState"], "connected");
    assert_eq!(
        json["evidence"]["tcpInitialEvent"]["payload"]["connectionState"],
        "connected"
    );
}

#[test]
fn verifier_http_domain_callback_projection_approves_serving_state_updates() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "http-domain-callback-projection"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "callback-record-input");
    assert_eq!(
        json["evidence"]["projectedSummary"]["netLiquidation"],
        "250000.42"
    );
    assert_eq!(json["evidence"]["projectedQuote"]["bid"], "209.01");
    assert!(json["evidence"]["eventReplayNames"]
        .as_array()
        .expect("event replay names")
        .iter()
        .any(|event| event == "order.status"));
}

#[test]
fn verifier_tws_domain_stream_http_projection_approves_post_ready_callbacks() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "tws-domain-stream-http-projection"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(
        json["checks"][0]["id"],
        "startup-ready-before-domain-stream"
    );
    assert_eq!(
        json["evidence"]["projectedSummaryNetLiquidation"],
        "275000.11"
    );
    assert_eq!(json["evidence"]["projectedQuoteBid"], "210.01");
    assert!(json["evidence"]["projectedOrderAcknowledgements"]
        .as_array()
        .expect("ack ids")
        .iter()
        .any(|broker_order_id| broker_order_id == "IBKR-STREAM-CB-9002"));
}

#[test]
fn verifier_tws_field_stream_http_projection_approves_post_ready_field_callbacks() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "tws-field-stream-http-projection"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "startup-ready-before-field-stream");
    assert_eq!(
        json["evidence"]["projectedSummaryNetLiquidation"],
        "285000.33"
    );
    assert_eq!(json["evidence"]["projectedQuoteBid"], "212.01");
    assert!(json["evidence"]["postReadyCallbacks"]
        .as_array()
        .expect("post-ready callbacks")
        .iter()
        .all(|callback| callback["kind"] == "fieldRecord"));
    assert!(json["evidence"]["projectedOrderAcknowledgements"]
        .as_array()
        .expect("ack ids")
        .iter()
        .any(|broker_order_id| broker_order_id == "IBKR-STREAM-FIELD-9004"));
}

#[test]
fn verifier_account_state_approves_managed_accounts_and_positions() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "account-state"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "paper-live-account-split");
    assert_eq!(json["evidence"]["accounts"][0]["accountID"], "DU1234567");
}

#[test]
fn verifier_account_callback_state_approves_broker_callback_projection() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "account-callback-state"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "managed-accounts-callback");
    assert!(json["evidence"]["callbackCount"].as_u64().unwrap() >= 10);
    assert_eq!(
        json["evidence"]["accountState"]["fills"][0]["commissionReportedAt"],
        "2027-01-15T18:30:02.500Z"
    );
    assert_eq!(
        json["evidence"]["flexExportRows"].as_array().unwrap().len(),
        2
    );
}

#[test]
fn verifier_broker_callback_routing_approves_shared_router_projection() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "broker-callback-routing"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "session-callback-routing");
    assert_eq!(json["evidence"]["session"]["connectionState"], "connected");
    assert!(json["evidence"]["eventReplayNames"]
        .as_array()
        .expect("event replay names")
        .iter()
        .any(|event| event == "order.status"));
}

#[test]
fn verifier_tws_domain_callback_decoder_approves_callback_record_projection() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "tws-domain-callback-decoder"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "e-wrapper-method-coverage");
    assert!(json["evidence"]["decodedMethods"]
        .as_array()
        .expect("decoded methods")
        .iter()
        .any(|method| method == "commissionReport"));
    assert!(json["evidence"]["eventReplayNames"]
        .as_array()
        .expect("event replay names")
        .iter()
        .any(|event| event == "option.quote"));
}

#[test]
fn verifier_tws_field_callback_decoder_approves_key_value_projection() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "tws-field-callback-decoder"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "field-method-coverage");
    assert!(json["evidence"]["decodedMethods"]
        .as_array()
        .expect("decoded methods")
        .iter()
        .any(|method| method == "tickPrice"));
    assert_eq!(
        json["evidence"]["malformedError"]["code"],
        "invalidFieldCallback"
    );
    assert!(json["evidence"]["eventReplayNames"]
        .as_array()
        .expect("event replay names")
        .iter()
        .any(|event| event == "quote.snapshot"));
}

#[test]
fn verifier_http_field_callback_projection_approves_serving_state_updates() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "http-field-callback-projection"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "field-record-input");
    assert_eq!(
        json["evidence"]["projectedSummary"]["netLiquidation"],
        "260000.42"
    );
    assert_eq!(json["evidence"]["projectedQuote"]["bid"], "211.01");
    assert!(
        json["evidence"]["projectedOrderRouting"]["placementAcknowledgements"]
            .as_array()
            .expect("placement acknowledgements")
            .iter()
            .any(|ack| ack["brokerOrderID"] == "IBKR-HTTP-FIELD-9003")
    );
    assert!(json["evidence"]["eventReplayNames"]
        .as_array()
        .expect("event replay names")
        .iter()
        .any(|event| event == "quote.snapshot"));
}

#[test]
fn verifier_order_lifecycle_approves_commission_and_flex_export_shape() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "order-lifecycle"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][3]["id"], "late-commission-update");
    assert_eq!(
        json["evidence"]["commissionUpdateEvent"]["payload"]["fill"]["commissionReportedAt"],
        "2027-01-15T18:30:02.500Z"
    );
    assert_eq!(
        json["evidence"]["flexExportRows"].as_array().unwrap().len(),
        2
    );
}

#[test]
fn verifier_market_data_streams_approves_quotes_bars_ticks_and_events() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "market-data-streams"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "contract-details");
    assert_eq!(json["checks"][5]["id"], "live-event-fanout");
    assert_eq!(json["checks"][6]["id"], "subscription-state");
    assert_eq!(json["evidence"]["historicalTicks"]["tickCount"], 3);
    assert_eq!(json["evidence"]["quoteSubscription"]["status"], "active");
    assert_eq!(json["evidence"]["quoteUnsubscription"]["status"], "stopped");
}

#[test]
fn verifier_market_data_callback_state_approves_broker_callback_projection() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "market-data-callback-state"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "contract-callbacks");
    assert_eq!(json["evidence"]["callbackCount"], 10);
    assert_eq!(
        json["evidence"]["marketState"]["optionQuote"]["greeks"]["delta"],
        "0.48"
    );
    assert_eq!(
        json["evidence"]["marketState"]["historicalTicks"]["tickCount"],
        3
    );
}

#[test]
fn verifier_historical_pacing_approves_fail_closed_pacing_rules() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "historical-pacing"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "request-limits");
    assert_eq!(json["evidence"]["pacing"]["bidAskWeight"], 2);
}

#[test]
fn verifier_option_market_data_approves_chain_contract_details_and_quote() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "option-market-data"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][1]["id"], "option-chain");
    assert_eq!(json["evidence"]["optionQuote"]["greeks"]["delta"], "0.48");
}

#[test]
fn verifier_order_safety_approves_core_execution_guards() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "order-safety"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "request-derived-idempotency");
    assert_eq!(json["checks"][2]["id"], "json-boolean-fail-closed");
}

#[test]
fn verifier_order_callback_state_approves_broker_callback_projection() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "order-callback-state"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "paper-live-acknowledgements");
    assert_eq!(json["evidence"]["callbackCount"], 10);
    assert_eq!(
        json["evidence"]["routingState"]["placementAcknowledgements"][0]["brokerOrderID"],
        order_routing::PAPER_BROKER_ORDER_ID
    );
    assert_eq!(
        json["evidence"]["routingState"]["optionExerciseAcknowledgements"][0]["action"],
        "exercise"
    );
    assert_eq!(
        json["evidence"]["routingState"]["cancelResponses"][0]["status"]["status"],
        "cancelled"
    );
}

#[test]
fn verifier_paper_order_routing_approves_async_acknowledgement() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "paper-order-routing"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][1]["id"], "paper-acknowledgement");
    assert_eq!(
        json["evidence"]["acknowledgement"]["brokerOrderID"],
        order_routing::PAPER_BROKER_ORDER_ID
    );
}

#[test]
fn verifier_live_order_routing_approves_confirmation_and_live_gate() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "live-order-routing"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "live-startup-gate");
    assert_eq!(
        json["evidence"]["acknowledgement"]["environment"],
        "ibkrLive"
    );
}

#[test]
fn verifier_live_option_combo_routing_approves_option_and_combo_gates() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "live-option-combo-routing"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][2]["id"], "option-hydration");
    assert_eq!(
        json["evidence"]["optionRoute"]["mappedContract"]["securityType"],
        "OPT"
    );
    assert_eq!(
        json["evidence"]["comboRoute"]["mappedContract"]["comboLegCount"],
        2
    );
    assert_eq!(
        json["evidence"]["comboRoute"]["singleLegComboRejection"],
        "invalidContract"
    );
}

#[test]
fn verifier_option_exercise_safety_approves_position_and_confirmation_gates() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "option-exercise-safety"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["checks"][0]["id"], "action-code-mapping");
    assert_eq!(json["checks"][1]["id"], "position-required");
    assert_eq!(json["evidence"]["acknowledgement"]["action"], "exercise");
}

#[test]
fn verifier_backend_readiness_approves_all_local_backend_verifiers() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_agentic-trading-adapter"))
        .args(["verify", "backend-readiness"])
        .output()
        .expect("run verifier");
    assert!(output.status.success());
    let json: Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["isApproved"], true);
    assert_eq!(json["evidence"]["localVerifierCount"], 34);
    assert_eq!(json["evidence"]["approvedVerifierCount"], 34);
    assert_eq!(json["checks"].as_array().expect("checks").len(), 34);
    assert!(json["evidence"]["completionBoundary"]
        .as_str()
        .expect("completion boundary")
        .contains("does not prove external IBKR Gateway/TWS"));
    assert!(json["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .any(|check| check["id"] == "paper-order-routing" && check["isApproved"] == true));
    assert!(json["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .any(|check| check["id"] == "live-option-combo-routing" && check["isApproved"] == true));
}
