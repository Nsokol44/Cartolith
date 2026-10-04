# Cartolith — Enhancement Plan: from good demo to THE training tool for GIS & analysis

*Audit date: 2026-10-04 · Branch: `enhance/training-tool` · Auditor: Muse (with tests, not opinions)*
*Method: every claim below was checked against the code or by executing it. Where a suspicion turned out to be wrong, that is recorded too.*

---

## The brutal summary

Cartolith's concept is genuinely strong: a dataset-centric workflow where every operation derives a new, lineage-carrying dataset is a *better teaching model* than the layer-centric model of QGIS/ArcGIS for a first course, and the teaching layer (52-concept glossary, per-tool explainers, 8 state-checked lessons) is more pedagogy than most academic GIS software ever gets.

But a training tool is a **promise that the answers are right and that practice produces competence**. On 2026-10-03, Cartolith could keep neither half of that promise, for provable reasons:

1. **Zero automated tests existed anywhere in the repo, and CI ran zero tests.** Nothing — nothing — verified that any of the 34 geoprocessing tools or 5 spatial-statistical methods computed a correct answer. The first test suite ever run against this code (this branch) immediately found a hillshade that lights terrain from the wrong side of the sky and a "10 km" grid that is 5 km wide in Canada. A tool that teaches a student to read inverted relief as correct is worse than no tool.
2. **There is no assessment.** Lessons check that you *clicked*; nothing checks that what you produced is *right*. There are no learning objectives attached to lessons, no graded exercises, no instructor view, no export. Clicking-through is the failure mode of every tutorial ever built, and it was the only mode available.
3. **Skills were trapped in the GUI.** A student could learn "Cartolith" without learning anything that transfers to QGIS, ArcGIS Pro, or geopandas — the tools employers and later courses actually use. (This branch seeds the fix: code reveal.)

Everything else in this plan is detail under those three headings, plus the operational realities of running software in a real classroom.

---

## 1. Correctness trust — "might teach wrong answers" is the existential risk

### Findings (all reproduced by tests on this branch)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| F-1 | **Critical** | **Hillshade lit from the south-east while claiming a north-west sun (azimuth 315°).** The compass azimuth was plugged into a mathematical-angle formula unconverted (`backend/main.py`, terrain block, orig. ~L2864–2872). On a synthetic cone, the NW flank scored −0.315 (dark) and the SE flank 0.949 (bright); matplotlib and the GDAL convention both light the NW flank (0.99 / 0.95). This is textbook *relief inversion* — the single most misleading error a terrain lesson can teach. | `test_geoprocess.py::test_hillshade_lights_the_northwest_flank` (failed before fix, passes after) |
| F-2 | **Critical** | **Aspect reported in the wrong convention, undocumented.** Same block: aspect came out as a mathematical angle (0° = east, CCW) where ArcGIS Pro / GDAL report a compass bearing (0° = north, CW). A plane facing west read 180 instead of 270; flat ground read 0 ("east") instead of −1. Any student cross-checking against ArcGIS — the transfer behaviour we *want* — would conclude one of the tools is broken. | `test_slope_and_aspect_of_east_rising_plane`, `test_aspect_of_flat_is_minus_one` |
| F-3 | **High** | **Regular grid cells are not the requested size away from the equator.** `deg = cell_km / 111.0` was used for *both* axes (orig. ~L2543). At 60°N a "10 km" cell measured **5.01 km** wide in x. Any density, sampling, or MAUP lesson built on this grid teaches wrong numbers at exactly the latitudes of most US/European teaching data. | `test_regular_grid_cells_are_actually_cell_km_wide_at_60n` |
| F-4 | **Medium** | **GWR had no model-comparison diagnostics.** `backend/advanced_methods.py` `gwr()` (orig. L421) returns local coefficients and R² but no effective parameter count, no AICc, no standard errors, no bandwidth selection (bandwidth = median distance to the ~20th neighbour, a rule of thumb), and no local-collinearity check. Without AICc a student *cannot answer the only question GWR exists to ask* — "is the varying model actually better than the global one?" — and with an unexamined bandwidth they can manufacture any map they like. The kernel also operates on raw lon/lat degrees, so the "circle" of neighbours is an ellipse in metres everywhere except the equator; nothing warns about this. | Code read; diagnostics added on this branch (`effective_parameters`, `aicc`, `ols_aicc`), bandwidth selection still open (P0-5) |
| F-5 | **Medium** | **Spatial-lag standard errors are the naive OLS formula** on the 2SLS design (`spatial_lag_model`, orig. L506): `se` comes from `pinv(AᵀA)` with `A = [Ŵy, X]` instead of the correct 2SLS variance using the instrument projection. ρ and β point estimates verified accurate (ρ̂ = 0.53 for ρ = 0.5; β̂ = 1.48 for β = 1.5 on a known DGP), so inference, not location, is what is soft. | `test_spatial_lag_recovers_known_rho_and_beta` (point estimates); SE issue documented, not yet fixed |
| F-6 | **Low / definitional** | **LISA local-I values differ from PySAL's esda by exactly n/(n−1).** Cartolith's `local_morans` (orig. L368) uses the population denominator in m₂; esda standardises with the sample denominator. Ratio verified constant at 36/35 on the test grid. Quadrants are unaffected. This is a literature-split convention, not a bug — but it was *undocumented*, so a student comparing against PySAL output (again: the transfer behaviour we want) sees a mismatch with no explanation. Its permutation test also differs from esda's conditional permutation (all-values permutation into the lag vs. yᵢ held fixed), yielding fewer significant locations (25 ns vs. esda's 20 on the fixture); point estimates are the verified part, exact p-parity is xfail-tracked. | `test_local_morans_values_match_esda`, `test_local_morans_significance_matches_esda_exactly` (xfail) |
| F-7 | **Low** | **EVI's constants assume 0–1 reflectance; nothing says so.** `main.py` spectral block applies `2.5·(NIR−R)/(NIR+6R−7.5B+1)` to whatever bands the user picks, including raw DN rasters (0–10000), where the `+1` makes the index meaningless. NDVI/NDWI survive scaling (ratios), EVI does not. No guard, no warning, no note in the explainer. | Code read; fix = scale detection + warning (P0-6) |
| F-8 | Info | **Suspicions that did NOT survive testing** (recorded so nobody re-litigates them): the per-feature equidistant buffer is *correct* (1 km at the equator → 0.01797° width, area within 0.3% of πr² geodesic); zonal statistics *does* handle nodata correctly (rasterio.mask converts source nodata to NaN; a −9999 patch does not pollute the mean — verified mean 100.0 over exactly the 96 valid cells); global Moran's I and Geary's C point estimates match esda to 1e-16; GWR recovers constant (β̂ = 2.02 for β = 2) and sign-flipping relationships; k-means, trees, forests, MLP and all permutation tests use fixed seed 42 and are reproducible run-to-run. | Test suite, this branch |

### The structural point

F-1 to F-3 are not exotic edge cases; they are the *first three things a validation suite would check*, and they shipped in a released v1.4.x. The lesson is not "the author was careless" — the code is, in most places, unusually thoughtful (the buffer implementation is better than many tutorials'; the eligibility guard in `advanced_methods.py` is genuinely good teaching design). The lesson is that **thoughtfulness without tests does not scale past one author and one afternoon**. Every future feature must land with its test or it does not land.

## 2. Pedagogy — content exists; the feedback loop does not

What exists (verified): 8 guided lessons (`frontend/src/lessons.js`) whose steps check real app state (`has.anyDataset`, `has.event('geoprocess:ran')`, …), a 52-entry glossary (`frontend/src/gis-concepts.js`), per-tool `?` explainers, lesson progress persisted to `localStorage` (`lessons.js` L581).

What is missing, in order of damage:

- **No outcome assessment.** A lesson step passes when the event fires — a student can buffer by the wrong distance, in the wrong units, on the wrong dataset, and the lesson advances. There is no "check my work" against the derived dataset's properties (this branch seeds exactly that: `backend/exercises.py` + `/api/exercises`).
- **No learning objectives.** Lessons have titles and prose but no objective statements, no mapping to any curriculum (QGIS Training Manual chapters, ArcGIS Learn paths, GIS&T Body of Knowledge), and no way for an instructor to say "this lesson certifies X". The two seed exercises carry `objectives` fields; lessons need the same treatment.
- **No misconception handling.** GIS beginners fail in *predictable* ways (degrees buffers, area in Mercator, NDVI on DN data, reading a choropleth classification as data). Cartolith's error messages are good at "what went wrong" and silent on "what you probably believed". The exercise grader's feedback strings are the pattern to generalise.
- **No instructor surface.** No roster, no completion export, no LMS (Canvas/Moodle) integration, no way to assign an exercise and collect results. Progress lives in one browser's localStorage and dies with it. For a solo-author teaching tool this is the difference between "used in my class" and "adoptable by anyone else's".
- **No deliberate practice with wrongness.** Every sample dataset is clean. Real competence is recognising a broken join, a missing CRS, a degrees/metres mixup. There is no "messy data" pack (see §5).

## 3. The transfer problem — concepts or just Cartolith?

Before this branch, transfer rested on the Notebook tab (students *can* write Python) and the SQL Lab (SQL genuinely transfers). But the core GUI workflow taught Cartolith's own verbs with no bridge: nothing showed that Buffer *is* `geopandas.buffer`, that the SQL Lab's answer is the geoprocess tab's answer, or what the QGIS menu path for the same operation is called. A student fluent in Cartolith and helpless in QGIS has been taught a product, not GIS.

This branch seeds the bridge (`backend/code_reveal.py`, wired into geoprocess and raster results as a `code_reveal` field, with full tool coverage enforced by test): every operation returns the equivalent geopandas/rasterio code *with the student's actual parameters*. Remaining transfer work (P2): surface the snippet in the UI next to every result, add "export workflow as notebook" (the lineage graph already holds the recipes — this is assembly, not invention), add a QGIS/ArcGIS "same operation, other tool" line to each `?` explainer, and state per-lesson which external curriculum chapter the lesson parallels.

## 4. Reproducibility — lineage is real; verification is not yet

Genuinely good: every derived dataset stores `{op, sources, params}`; the Pipeline can re-run a recipe; `.cartolith.json` round-trips vector/tabular data with WKT geometry (`project_load`, `main.py` orig. L3037).

Gaps an instructor will hit in week one:

- **The project file records no environment.** `project_save` writes `version: 1` (the file format) but not the app version, package versions, or platform. "It worked on my machine" is unanswerable from the file. (The app-version string itself was inconsistent — 5.0.0 in the app vs. v1.4.x tags — until this branch aligned it; see Repo cleanup.)
- **Lineage rides on the client.** The backend's own `/api/lineage` notes "provenance … is supplied by the client dataset objects", and `project_save` takes `derived` from frontend-supplied metadata (`getattr(df, "_derived", None)` on a DataFrame is always `None`). A submitted project can therefore carry edited or missing lineage and the backend cannot tell. For coursework integrity, lineage must be server-stamped at derivation time.
- **Stochastic methods are reproducible but not inspectable.** Seeds are fixed at 42 (good), but the seed is not recorded in outputs or the project file, so "reproducible" currently means "happens to be deterministic in this build". This branch adds `seed=` parameters to the permutation methods and passes `params.seed` through the API; recording the seed in each result dict is the remaining step.
- **Re-run is not verify.** Pipeline re-run recomputes a recipe; nothing compares the new output to the submitted one (row counts, geometry hashes, attribute stats). The exercise grader's check types are exactly the comparison primitives needed — a "verify submission" mode is a P1 assembly job, not new science.

## 5. Data realism — the sample data is too well-behaved to teach with

The one-click samples (24 world cities, 6 world regions) are clean, tiny, correctly projected, and complete. They demonstrate mechanics and teach nothing about judgement. A training tool needs a **deliberately messy teaching pack**: a shapefile with no `.prj` (CRS detective work), a CSV with lat/lon swapped for 3 rows, a join key with trailing spaces and one unmatched row, a raster whose nodata is −9999 in one file and 0 in another, a dataset straddling the antimeridian or a UTM zone boundary, populations that demand rate-vs-count reasoning. Each mess should ship with the lesson that springs the trap *after* the student falls into it — that sequencing is the pedagogy. None of this exists yet; the fixture style in `backend/exercises.py` (small, real-geography, built in code) is the pattern to extend, with real (small) extracts preferred over synthetic where licensing allows.

## 6. Accessibility & classroom operations

- **Unsigned installers are the #1 classroom risk.** The README's own instructions (SmartScreen "Run anyway", the macOS `.command` quarantine dance) are well-written, but in a class of 30 varied laptops, some fraction *will* fail on day one: managed/EDR laptops that block unsigned installers outright, Apple Silicon under Rosetta, Windows S-mode. There is no signed build, no web-hosted fallback instance, and no pre-flight "can I run this?" check page. Budget-wise this is a $99/yr Apple Developer account plus an Azure/Authenticode cert away from mostly disappearing; until then, the `Cartolith-web-*` fallback and a hosted demo instance are the mitigations, and the syllabus should schedule install help *before* the first lab.
- **Offline is partial.** The app itself is local (good), but every basemap in `CartographyTab.jsx` (OSM, OpenTopoMap, Esri, CartoDB tiles, orig. L38–79) needs the internet; "No basemap" is the only offline option, and contextily basemaps in the notebook likewise. A classroom on flaky Wi-Fi, or a field exercise, needs a bundled offline basemap (even a coarse Natural Earth vector backdrop) — currently absent.
- **Accessibility is near-zero.** A grep of the entire frontend finds **9** `aria-`/`role=`/`alt=` attributes. No keyboard-navigation audit, no screen-reader pass, and choropleth defaults lean on red–green ramps in places (the NDVI result uses `rdylgn`); there is no colourblind-safe palette option. For a university teaching tool this is both an ethical and (for US public institutions) a compliance exposure.
- **Student data.** Today the app is local-only and progress sits in localStorage — FERPA exposure is minimal *by accident of architecture*. The moment instructor dashboards or cloud sync are added (P1/P3), grades-adjacent data leaves the device and FERPA, institutional SSO, and data-retention questions arrive with it. Decide that architecture deliberately, not by accretion. (The exercise grader on this branch is deliberately stateless: it grades and forgets.)

## 7. Scope honesty — what Cartolith should NOT become

- **Not a QGIS/ArcGIS replacement.** It will lose that fight and doesn't need it: its niche is the first two semesters — concepts, judgement, and a bridge to the pro tools. Every roadmap item that reads "parity with ArcGIS" (WHATS_NEW's framing) should be re-read as "enough fidelity that skills transfer".
- **Not a routing/navigation product.** Straight-line network tools, honestly labelled, are pedagogically *better* than a bundled routing engine whose assumptions students can't inspect. (If drive-time ever comes, it comes as an explicitly-labelled external-service lesson about APIs, not as silent magic.)
- **Not an LMS.** Grade passback and rosters belong to Canvas/Moodle via export/LTI, not to a home-grown gradebook. Cartolith should emit evidence (scores, verified project files), not store student records.
- **Not a data portal or a cloud platform.** Hosted multi-user sync would solve the instructor-view problem at the cost of the FERPA/ops burden in §6 and the loss of "double-click and it works offline in a lab". Resist until a specific course deployment demands it.
- **Not an AI-tutor product (yet).** An in-app chatbot answering GIS questions it cannot verify, on top of a codebase whose own correctness story is one week old, is how you teach confident wrongness at scale. Code reveal + misconception-aware feedback is the honest version of the same impulse.

---

## Roadmap

Sizes: S = days, M = 1–3 weeks, L = a month+. "Proof" = the verification that closes the item.

### P0 — Trust & correctness (before any new classroom deployment)

| # | Item | Size | Proof |
|---|---|---|---|
| P0-1 | Land this branch's test suite + CI job; make "no test, no merge" the rule | S | ✅ Done here: 41 passed, 1 xfailed; `.github/workflows/tests.yml` |
| P0-2 | Fix hillshade azimuth + aspect convention (F-1, F-2) | S | ✅ Done here, regression tests in suite |
| P0-3 | Fix regular-grid longitude scaling (F-3) | S | ✅ Done here, regression test in suite |
| P0-4 | Align LISA inference with esda conditional permutation, or keep the scheme and document the difference in the `?` explainer (F-6) | M | xfail test flips to pass, or explainer text ships + test asserts its presence |
| P0-5 | GWR: bandwidth selection (CV or AICc search over candidate bandwidths) + degree-coordinate warning / projected-distance kernel (F-4) | M | Test: selected bandwidth on a known-varying DGP beats the rule-of-thumb on AICc; warning fires for lon/lat coords |
| P0-6 | EVI/NDVI input-scale guard: detect DN-range rasters and warn that EVI needs reflectance (F-7) | S | Test: DN-scale fixture returns a warning field; reflectance fixture does not |
| P0-7 | Correct 2SLS standard errors for the spatial lag model (F-5) | M | Test against `spreg` (PySAL) SEs on a fixture within tolerance |
| P0-8 | Extend validation to the remaining tools (overlay family vs. geopandas reference outputs; H3 tools; network tools vs. hand-computed haversine cases) | M | Suite grows; every GEOPROCESS/RASTER/NETWORK tool has ≥1 correctness test (coverage checklist in CI output) |
| P0-9 | Record seed + app/package versions in every stochastic result and in `.cartolith.json` | S | Round-trip test: save → load → result dicts reproduce bit-for-bit |

### P1 — Feedback & assessment (the "training" in training tool)

| # | Item | Size | Proof |
|---|---|---|---|
| P1-1 | Exercise system on the seed built here: exercise file format, ≥6 exercises across geoprocess/statistics/SQL, in-app runner panel | M | ✅ Seed done here (`exercises.py`, 2 exercises, endpoints, grader tests); UI panel + 4 more exercises remain |
| P1-2 | Grader hardening: shape/eccentricity check (catches degree-buffers that pass area), CRS-actually-used check, one-to-many join duplicate detector | S | New failing-fixture tests for each trap |
| P1-3 | Learning objectives on every lesson + exercise, mapped to GIS&T BoK / QGIS Training Manual / ArcGIS Learn equivalents | S | Objectives render in UI; mapping reviewed against the external curricula |
| P1-4 | "Verify submission" mode: instructor opens a student's `.cartolith.json`, server re-runs lineage and diffs outputs | M | Test: tampered project file is flagged; faithful one verifies |
| P1-5 | Server-stamped lineage (move `derived` provenance from client meta to backend at derivation time) | M | Test: client cannot forge a recipe (API test with edited meta) |
| P1-6 | Score export (CSV/JSON) an instructor can paste into Canvas/Moodle | S | Export of a graded session round-trips into a spreadsheet with correct columns |
| P1-7 | Messy-data teaching pack (§5): ≥5 trapped datasets, each with a spring-the-trap lesson | M | Each trap dataset has a test asserting the trap actually fires (e.g., naive join loses exactly the planted row) |

### P2 — Transfer

| # | Item | Size | Proof |
|---|---|---|---|
| P2-1 | Surface `code_reveal` in the UI beside every result + "send to Notebook" button | S | ✅ Backend done here (field + coverage tests); UI wiring remains — manual check on a running app |
| P2-2 | Export workflow as a runnable notebook from the lineage graph | M | Exported notebook from a 3-step workflow executes headless and reproduces the final dataset (test) |
| P2-3 | "Same operation in QGIS / ArcGIS Pro" line in every `?` explainer (menu path + tool name) | S | Content pass; spot-check 10 tools against current QGIS/ArcGIS docs |
| P2-4 | SQL ↔ geoprocess ↔ code triangle: for join/buffer/select lessons, show all three forms side by side | M | Lesson content + student-facing check that all three produce equal outputs (test) |

### P3 — Polish & scale

| # | Item | Size | Proof |
|---|---|---|---|
| P3-1 | Code signing + notarization (Apple Developer + Windows cert); remove the `.command` dance | M | Clean-machine install test on both platforms with no warnings |
| P3-2 | Offline basemap bundle (Natural Earth backdrop) + offline indicator | M | App fully usable in airplane mode (manual test protocol) |
| P3-3 | Accessibility pass: keyboard navigation, aria coverage, colourblind-safe default palettes, contrast audit | M | Automated a11y lint in CI + manual screen-reader pass on the 5 main tabs |
| P3-4 | MapLibre/vector tiles + real symbology/label engine (only if teaching needs demand it — see §7) | L | Visual test protocol on reference maps |
| P3-5 | Re-enable the Linux build in the Tauri matrix | S | CI green on ubuntu target; install tested in a clean VM |

---

## Repo cleanup (this branch, October 2026)

Surgical changes only — no source-layout restructuring:

| Change | Why |
|---|---|
| **Added `LICENSE` (MIT) at repo root.** Decision made by Nick on 2026-10-04 ("Yes, MIT is fine"). Copyright: Nicholas Sokol. | The repo previously had **no license at all** — legally, students and other instructors had no right to copy or modify it, and JOSS submission requires an OSI-approved license. This was the single highest-value one-file fix in the repo. |
| **README restructured.** One obvious student path (release → run) first; one developer path (`./start.sh`); a "Which build do I use?" table resolving the Tauri-vs-`desktop/` confusion; stale claims removed (both the old README and `desktop/README.md` referenced a `.github/workflows/build-desktop.yml` that **does not exist** — only `build-tauri.yml` is present); the version/instructor material condensed and the DataLens history moved to the bottom. | The old README interleaved student install, instructor release mechanics, and troubleshooting in one flow, and sent readers to a nonexistent workflow file. First-run confusion is a classroom-ops cost (§6). |
| **`desktop/README.md` banner: LEGACY / FALLBACK**, and `desktop-tauri/README.md` marked as the primary build. | Two packaging systems with parallel READMEs and no stated precedence is how a student (or a future contributor) ships the wrong app. |
| **Version consistency: app strings aligned to the git-tag scheme.** Canonical line = tags (v1.1…v1.4.11). Changed: `backend/main.py` FastAPI `version=` and `/api/health` (5.0.0 → 1.4.11), docstring header, `frontend/package.json` + `package-lock.json` (5.0.0 → 1.4.11), `src-tauri/tauri.conf.json` (1.0.0 → 1.4.11), `start.sh` banner ("Cartolith v5" → "Cartolith 1.4.11"). No tags created. | Three different version numbers (5.0.0 / 1.0.0 / v1.4.11) made bug reports and release support unplaceable — "which version are you running?" had no true answer. |
| **`start.sh`: prerequisite checks + idempotency.** Now verifies Python is 3.10–3.12 and Node ≥ 18 with plain-English failure messages (previously it checked only that *some* python3/node existed, so a Python 3.13 user got a pip compiler error — the README itself warned about exactly this failure). Pip installs now run only when `requirements.txt`'s hash changes (stamp in `.venv/.cartolith-req-hash`); `npm install` only when `package.json` is newer than the install stamp. One documented dev command remains `./start.sh`. | Every repeat launch previously re-ran a full pip install; every wrong-version launch failed cryptically. Both are weekly classroom friction. |
| **`stop.sh`: lsof-absence guard** (explains the fallback to process-name matching instead of silently doing half its job on machines without lsof). | Silent partial behaviour is the theme of half the findings in this plan; the scripts should not model it. |
| **`.gitignore` completeness:** added `.pytest_cache/`, `*.cartolith.json` (user/student project files — never commit a student's work), `outputs/`, root `.venv/`. Existing coverage (node_modules, dist, Tauri target/binaries, logs) was already good. | Prevents the two most likely accidental commits: test caches and student project files. |
| **Added `.github/workflows/tests.yml`** (pytest job, Python 3.11). | The only existing workflow *packages* the app and ran zero tests — see §1. Packaging a wrong answer faster is not CI. |

**Verified headless on this branch:** backend imports and reports version 1.4.11; full pytest suite green (below); both workflow files parse as YAML; `bash -n` clean on all three shell scripts; README contains no reference to `build-desktop.yml`.
**Needs a real machine (not verified here):** `./start.sh` end-to-end on macOS/Windows (venv + ports + browser open), the Tauri build itself, installer first-run behaviour, and the frontend build (`npm run build` was not run — no frontend source changed on this branch beyond `package.json` version metadata).

---

## What this branch implements (Part B deliverables)

- `backend/tests/` — the repo's first test suite: **41 passed, 1 xfailed** (clean venv: numpy 2.5, pandas 3.0, geopandas 1.2, esda 2.10, rasterio 1.5; run with `python -m pytest backend/tests/ -q`). Files: `test_advanced_methods.py` (esda parity, GWR/spatial-lag DGP recovery, seeds), `test_geoprocess.py` (buffer/grid/join/centroid + slope/aspect/hillshade/NDVI/zonal), `test_code_reveal.py`, `test_exercises.py`.
- **Fixes:** hillshade azimuth conversion + compass aspect with −1 for flat (F-1/F-2); regular-grid cos(latitude) scaling (F-3); GWR `effective_parameters`/`aicc`/`ols_aicc` diagnostics (F-4, partial — selection still P0-5); `seed=` parameters on `morans_i`/`gearys_c`/`local_morans` with API pass-through.
- **A caught-in-the-act bonus finding:** the first draft of the exercise grader measured area in EPSG:3857 and marked *correct* 500 km buffers as 65% too large. The test suite caught the grader committing the exact misconception the tool exists to teach against. It now measures geodesic area (pyproj `Geod`). If you read one paragraph of this plan, read §1's structural point — this is it, happening live.
- **Assessment seed:** `backend/exercises.py` (exercise format, 5 check types with misconception-aware feedback, 2 worked exercises — 500 km buffer; Moran's I interpretation) + `GET /api/exercises`, `POST /api/exercises/{id}/check`.
- **Code-reveal seed:** `backend/code_reveal.py` covering all 34 tools, wired into geoprocess results and same-grid raster results as a `code_reveal` field; coverage enforced by test.
- **Cleanup:** LICENSE, README, banners, version alignment, script fixes, `.gitignore`, tests CI — see the table above.

*Nothing on this branch has been pushed. The original clone is untouched.*
