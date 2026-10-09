// Unit tests for the pure drag/drop + picker planning logic in
// src/dropingest.js. Run:  node --test tests/dropingest.test.mjs
// (No DOM, no React — the module under test is deliberately pure.
// The Tauri native drag event itself cannot be simulated headlessly;
// what IS pinned here is everything that happens to its payload once
// it arrives, plus the picker's file-grouping plan.)
import { test } from "node:test"
import assert from "node:assert/strict"
import { planBrowserFiles, entryFromResult, fileStemAndExt } from "../src/dropingest.js"

test("stem/ext parsing handles .shp.xml as one extension", () => {
  assert.deepEqual(fileStemAndExt("Places.SHP.XML"), { stem: "places", ext: "shp.xml" })
  assert.deepEqual(fileStemAndExt("places.shp"), { stem: "places", ext: "shp" })
  assert.deepEqual(fileStemAndExt("noext"), { stem: "noext", ext: "" })
})

test("shapefile parts picked together plan as one bundle", () => {
  const plan = planBrowserFiles(["places.shp", "places.shx", "places.dbf", "places.prj"])
  assert.deepEqual(plan, [{ type: "bundle", indices: [0, 1, 2, 3], base: "places" }])
})

test("mixed pick: csv stays single, parts bundle, order preserved", () => {
  const plan = planBrowserFiles(["a.csv", "z.shp", "z.dbf", "b.geojson"])
  assert.deepEqual(plan, [
    { type: "single", index: 0 },
    { type: "bundle", indices: [1, 2], base: "z" },
    { type: "single", index: 3 },
  ])
})

test("lone parts do not bundle (no .shp, or a .shp by itself)", () => {
  assert.deepEqual(planBrowserFiles(["only.dbf"]),
    [{ type: "single", index: 0 }])
  assert.deepEqual(planBrowserFiles(["only.shp"]),
    [{ type: "single", index: 0 }])
})

test("two different shapefiles bundle separately", () => {
  const plan = planBrowserFiles(["a.shp", "a.dbf", "b.shp", "b.dbf", "b.shx"])
  assert.deepEqual(plan, [
    { type: "bundle", indices: [0, 1], base: "a" },
    { type: "bundle", indices: [2, 3, 4], base: "b" },
  ])
})

test("entryFromResult: ok strips bookkeeping, keeps dataset + note", () => {
  const e = entryFromResult(
    { status: "ok", source: "acs.dta", id: "acs.dta", name: "acs.dta",
      geometry_note: "No coordinate columns…" }, "k1")
  assert.equal(e.state, "done")
  assert.equal(e.label, "acs.dta")
  assert.equal(e.note, "No coordinate columns…")
  assert.equal(e.dataset.id, "acs.dta")
  assert.equal("status" in e.dataset, false)
  assert.equal("source" in e.dataset, false)
})

test("entryFromResult: needs_choice carries kind/options/paths", () => {
  const e = entryFromResult(
    { status: "needs_choice", source: "book.xlsx", kind: "sheet",
      options: ["One", "Two"], detail: "several sheets",
      paths: ["/tmp/book.xlsx"] }, "k2")
  assert.equal(e.state, "choice")
  assert.equal(e.kind, "sheet")
  assert.deepEqual(e.options, ["One", "Two"])
  assert.deepEqual(e.paths, ["/tmp/book.xlsx"])
})

test("entryFromResult: error keeps the backend's actual reason", () => {
  const e = entryFromResult(
    { status: "error", source: "junk.gpkg", detail: "Couldn't load this as gpkg: …" }, "k3")
  assert.equal(e.state, "error")
  assert.match(e.message, /Couldn't load/)
  const bare = entryFromResult({ status: "error", source: "x" }, "k4")
  assert.ok(bare.message.length > 0)  // never an empty failure
})
