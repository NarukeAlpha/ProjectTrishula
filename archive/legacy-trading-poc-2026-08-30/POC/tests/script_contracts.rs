use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "agentic-trading-{name}-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dir");
    }
    fs::write(path, contents).expect("write file");
}

fn write_complete_fe01_evidence(validation_dir: &Path) {
    let live_dir = validation_dir.join("ibkr-live-electron");
    write_file(
        &validation_dir.join("manifest.txt"),
        r#"validationOutputDir=/tmp/example
rustGate=passed
backendReadiness=/tmp/example/backend-readiness.json
backendReadinessApproved=true
localVerifierCount=34
approvedVerifierCount=34
electronGate=passed
electronTrace=/tmp/example/electron-frontend.json
electronSurfaceTrace=/tmp/example/electron-surface.json
ibkrLiveElectronGate=passed
ibkrLiveElectronManifest=/tmp/example/ibkr-live-electron/manifest.txt
ibkrLiveElectronSnapshot=/tmp/example/ibkr-live-electron/electron-live-1586x992.png
ibkrLiveElectronInteractionTrace=/tmp/example/ibkr-live-electron/electron-interactions.json
ibkrLiveElectronSnapshotTrace=/tmp/example/ibkr-live-electron/live-snapshot-content.json
validation=passed
"#,
    );
    write_file(
        &live_dir.join("manifest.txt"),
        r#"validationOutputDir=/tmp/example/ibkr-live-electron
backendMode=started
backendLivePayload=/tmp/example/ibkr-live-electron/backend-live-workbench.json
electronLiveSnapshot=/tmp/example/ibkr-live-electron/electron-live-1586x992.png
electronInteractionTrace=/tmp/example/ibkr-live-electron/electron-interactions.json
liveSnapshotTrace=/tmp/example/ibkr-live-electron/live-snapshot-content.json
validation=passed
"#,
    );
    write_file(
        &validation_dir.join("backend-readiness.json"),
        r#"{
  "isApproved": true,
  "evidence": {
    "localVerifierCount": 34,
    "approvedVerifierCount": 34,
    "completionBoundary": "local backend readiness does not prove external IBKR Gateway/TWS paper or live readiness"
  }
}
"#,
    );
    write_file(
        &validation_dir.join("electron-frontend.json"),
        r#"{ "isApproved": true }"#,
    );
    write_file(
        &validation_dir.join("electron-surface.json"),
        r#"{
  "isApproved": true,
  "surfaceRegions": ["top app bar", "left rail", "center market workspace", "right decision panel", "bottom dock", "diagnostics"],
  "oldWorkspaceReferences": [],
  "forbiddenMatches": []
}
"#,
    );
    write_file(
        &live_dir.join("live-snapshot-content.json"),
        r#"{
  "isApproved": true,
  "electron": {"width": 1586, "height": 992, "failures": []}
}
"#,
    );
    write_file(
        &live_dir.join("electron-interactions.json"),
        r#"{
  "isApproved": true,
  "visibleSymbol": "AAPL",
  "activeDock": "Options Chain",
  "activeRightTab": "Preview",
  "checks": [
    {"name": "symbol search refetches IBKR symbol", "passed": true}
  ]
}
"#,
    );
    write_file(
        &live_dir.join("electron-live-1586x992.png"),
        "not-a-real-png-but-nonempty",
    );
}

#[test]
fn validate_local_script_declares_local_frontend_manifest_contract() {
    let script = fs::read_to_string(repo_root().join("scripts/validate-local.sh"))
        .expect("read validate-local.sh");

    for required in [
        "MANIFEST_PATH=\"$OUTPUT_DIR/manifest.txt\"",
        "rustGate=passed",
        "backendReadiness=",
        "backendReadinessApproved=",
        "localVerifierCount=",
        "approvedVerifierCount=",
        "electronGate=passed",
        "electronTrace=",
        "electronSurfaceTrace=",
        "ibkrLiveElectronGate=skipped",
        "ibkrLiveSkipReason=",
        "ibkrLiveElectronGate=passed",
        "ibkrLiveElectronManifest=",
        "ibkrLiveElectronSnapshot=",
        "ibkrLiveElectronInteractionTrace=",
        "ibkrLiveElectronSnapshotTrace=",
        "validation=passed",
    ] {
        assert!(
            script.contains(required),
            "validate-local.sh missing manifest contract entry {required}"
        );
    }

    assert!(
        !script.contains("/Users/gabrielalfonzo/Documents/Agentic Trading"),
        "local validation must not depend on the old Agentic Trading workspace"
    );
}

#[test]
fn fe01_review_script_generates_strict_review_from_complete_frontend_evidence() {
    let validation_dir = unique_temp_dir("fe01-validation-complete");
    let output_path = validation_dir.join("review.md");
    write_complete_fe01_evidence(&validation_dir);

    let output = Command::new(repo_root().join("scripts/prepare-fe01-snapshot-review.sh"))
        .env("VALIDATION_OUTPUT_DIR", &validation_dir)
        .env("FE01_REVIEW_OUTPUT", &output_path)
        .env(
            "FE01_ELECTRON_SNAPSHOT",
            validation_dir.join("ibkr-live-electron/electron-live-1586x992.png"),
        )
        .output()
        .expect("run review script");

    assert!(
        output.status.success(),
        "review script failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let review = fs::read_to_string(&output_path).expect("read review");
    assert!(review.contains("FE-01 Electron IBKR Workstation Review"));
    assert!(review.contains("Electron snapshot:"));
    assert!(review.contains("Electron surface verifier"));
    assert!(review.contains("Electron interaction verifier"));
    assert!(review.contains("Snapshot content verifier"));
    assert!(review.contains("`true`, `{\"localVerifierCount\":34,\"approvedVerifierCount\":34}`"));
    assert!(review.contains("workbench.topAppBar") || review.contains("Top app bar"));
    assert!(review.contains("Runtime reads `frontend/shared/workbench-data.json`"));
    assert!(review.contains("Swift frontend or parity artifact is required"));
}

#[test]
fn fe01_review_script_rejects_incomplete_frontend_evidence_unless_draft_mode() {
    let validation_dir = unique_temp_dir("fe01-validation-incomplete");
    write_complete_fe01_evidence(&validation_dir);
    fs::remove_file(validation_dir.join("ibkr-live-electron/electron-live-1586x992.png"))
        .expect("remove electron snapshot");
    fs::remove_file(validation_dir.join("electron-surface.json")).expect("remove surface trace");
    fs::remove_file(validation_dir.join("ibkr-live-electron/live-snapshot-content.json"))
        .expect("remove snapshot trace");
    fs::remove_file(validation_dir.join("ibkr-live-electron/electron-interactions.json"))
        .expect("remove interaction trace");

    let strict_output = Command::new(repo_root().join("scripts/prepare-fe01-snapshot-review.sh"))
        .env("VALIDATION_OUTPUT_DIR", &validation_dir)
        .env(
            "FE01_REVIEW_OUTPUT",
            validation_dir.join("strict-review.md"),
        )
        .output()
        .expect("run strict review script");

    assert!(!strict_output.status.success());
    assert!(String::from_utf8_lossy(&strict_output.stderr)
        .contains("FE-01 Electron evidence is incomplete"));

    let draft_output = Command::new(repo_root().join("scripts/prepare-fe01-snapshot-review.sh"))
        .arg("--allow-missing")
        .env("VALIDATION_OUTPUT_DIR", &validation_dir)
        .env("FE01_REVIEW_OUTPUT", validation_dir.join("draft-review.md"))
        .output()
        .expect("run draft review script");

    assert!(
        draft_output.status.success(),
        "draft review script failed: stdout={} stderr={}",
        String::from_utf8_lossy(&draft_output.stdout),
        String::from_utf8_lossy(&draft_output.stderr)
    );

    let draft = fs::read_to_string(validation_dir.join("draft-review.md")).expect("read draft");
    assert!(draft.contains("Electron snapshot: `MISSING`"));
    assert!(draft.contains("Electron surface trace: `MISSING`"));
    assert!(draft.contains("Frontend snapshot content trace: `MISSING`"));
    assert!(draft.contains("Electron interaction trace: `MISSING`"));
}
