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
electronSnapshot=/tmp/example/electron-1586x992.png
electronSnapshotDimensions=1586x992
swiftGate=passed
swiftSnapshot=/tmp/example/swift-1586x992.png
swiftSnapshotDimensions=1586x992
frontendParity=passed
frontendParityTrace=/tmp/example/frontend-parity.json
frontendSnapshotContent=passed
frontendSnapshotContentTrace=/tmp/example/frontend-snapshot-content.json
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
        &validation_dir.join("frontend-parity.json"),
        r#"{
  "isApproved": true,
  "parityRegions": ["top app bar", "left rail", "center market workspace", "right decision panel", "bottom dock", "diagnostics"],
  "oldWorkspaceReferences": []
}
"#,
    );
    write_file(
        &validation_dir.join("frontend-snapshot-content.json"),
        r#"{
  "isApproved": true,
  "electron": {"width": 1586, "height": 992},
  "swift": {"width": 1586, "height": 992},
  "parityFailures": []
}
"#,
    );
    write_file(
        &validation_dir.join("electron-1586x992.png"),
        "not-a-real-png-but-nonempty",
    );
    write_file(
        &validation_dir.join("swift-1586x992.png"),
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
        "electronSnapshot=",
        "swiftGate=passed",
        "swiftPackage=",
        "swiftSnapshot=",
        "frontendParity=passed",
        "frontendParityTrace=",
        "frontendSnapshotContent=passed",
        "frontendSnapshotContentTrace=",
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
            validation_dir.join("electron-1586x992.png"),
        )
        .env(
            "FE01_SWIFT_SNAPSHOT",
            validation_dir.join("swift-1586x992.png"),
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
    assert!(review.contains("FE-01 Frontend Snapshot Review"));
    assert!(review.contains("Electron snapshot:"));
    assert!(review.contains("Swift snapshot:"));
    assert!(review.contains("Electron/Swift parity verifier"));
    assert!(review.contains("Snapshot content verifier"));
    assert!(review.contains("`true`, `{\"localVerifierCount\":34,\"approvedVerifierCount\":34}`"));
    assert!(review.contains("workbench.topAppBar") || review.contains("Top app bar"));
    assert!(review.contains("Electron and Swift use different primary regions or tab model"));
}

#[test]
fn fe01_review_script_rejects_incomplete_frontend_evidence_unless_draft_mode() {
    let validation_dir = unique_temp_dir("fe01-validation-incomplete");
    write_complete_fe01_evidence(&validation_dir);
    fs::remove_file(validation_dir.join("electron-1586x992.png"))
        .expect("remove electron snapshot");
    fs::remove_file(validation_dir.join("frontend-parity.json")).expect("remove parity trace");
    fs::remove_file(validation_dir.join("frontend-snapshot-content.json"))
        .expect("remove snapshot trace");

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
        .contains("FE-01 frontend evidence is incomplete"));

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
    assert!(draft.contains("Frontend parity trace: `MISSING`"));
    assert!(draft.contains("Frontend snapshot content trace: `MISSING`"));
}
