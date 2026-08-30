use std::{fs, path::PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn concept_png_is_the_expected_frontend_contract_asset() {
    let image = fs::read(repo_root().join("CONCEPT.png")).expect("read CONCEPT.png");

    assert!(
        image.len() >= 24,
        "CONCEPT.png is too small to contain IHDR"
    );
    assert_eq!(&image[0..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(&image[12..16], b"IHDR");

    let width = u32::from_be_bytes(image[16..20].try_into().expect("png width"));
    let height = u32::from_be_bytes(image[20..24].try_into().expect("png height"));

    assert_eq!((width, height), (1586, 992));
}

#[test]
fn frontend_migration_guide_preserves_fe01_contract() {
    let guide = fs::read_to_string(repo_root().join("frontend-migration-guide.md"))
        .expect("read frontend-migration-guide.md");

    for required in [
        "/Users/gabrielalfonzo/IdeaProjects/Trading/CONCEPT.png",
        "1586x992",
        "FE-01",
        "Electron",
        "Pixel-Grounded Region Map",
        "`x=266-1258`, `y=178-600`",
        "`x=1258-1586`, `y=84-950`",
        "The first viewport reads left-to-right as navigation, market inspection, decision",
        "The center chart plus bottom dock is wider than the left rail and right panel combined",
        "scripts/validate-local.sh",
        "scripts/prepare-fe01-snapshot-review.sh",
        "Top app bar",
        "Left rail",
        "Center chart",
        "Right panel",
        "Bottom dock",
        "Diagnostics",
        "Whole-window vertical scrolling required to see main regions",
        "Verifier names, evidence bundle names, audit receipt names, or raw JSON appear outside Diagnostics",
        "apps/electron",
    ] {
        assert!(
            guide.contains(required),
            "frontend guide missing FE-01 contract text: {required}"
        );
    }
}

#[test]
fn readme_distinguishes_frontend_contract_from_implemented_workstation() {
    let readme = fs::read_to_string(repo_root().join("README.md")).expect("read README.md");

    for required in [
        "Electron frontend",
        "Requests without `symbol` are rejected",
        "SQLite",
        "scripts/prepare-fe01-snapshot-review.sh",
        "scripts/validate-local.sh",
        "The old Agentic Trading workspace is not part of this validation path.",
    ] {
        assert!(
            readme.contains(required),
            "README missing handoff boundary text: {required}"
        );
    }
}
