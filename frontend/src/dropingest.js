// Pure helpers for turning picked / dropped files into ingest actions.
// No React/DOM imports — the logic is unit-testable in plain node
// (frontend/tests/dropingest.test.mjs); the components stay thin shells
// around these functions.

export const SHP_PART_EXTS = new Set(
  ["shp", "shx", "dbf", "prj", "cpg", "qix", "sbn", "sbx", "shp.xml"])

export function fileStemAndExt(name) {
  const lower = String(name).toLowerCase()
  if (lower.endsWith(".shp.xml")) return { stem: lower.slice(0, -8), ext: "shp.xml" }
  const dot = lower.lastIndexOf(".")
  if (dot < 0) return { stem: lower, ext: "" }
  return { stem: lower.slice(0, dot), ext: lower.slice(dot + 1) }
}

/**
 * Plan how a set of picked browser Files should be ingested. A shapefile
 * is a SET of parts (.shp + .shx + .dbf + …) that only makes sense
 * together, but the upload endpoint takes one file per request — parts
 * sent one by one arrive as unrelated fragments (a bare .shp has no
 * attributes). So parts sharing a stem are bundled into one .zip (when
 * the group holds the .shp itself plus at least one sibling); the
 * backend's zip path reassembles them. Returns an ordered plan of
 *   {type: "single", index} | {type: "bundle", indices: [...], base}
 * Lone parts (a .dbf on its own, say) stay single — the backend explains
 * what they are.
 */
export function planBrowserFiles(names) {
  const groups = new Map()
  const plan = []
  names.forEach((name, i) => {
    const { stem, ext } = fileStemAndExt(name)
    if (SHP_PART_EXTS.has(ext)) {
      if (!groups.has(stem)) {
        const g = { type: "group", indices: [], base: stem }
        groups.set(stem, g)
        plan.push(g)
      }
      groups.get(stem).indices.push(i)
    } else {
      plan.push({ type: "single", index: i })
    }
  })
  const out = []
  for (const item of plan) {
    if (item.type !== "group") { out.push(item); continue }
    const hasShp = item.indices.some(
      i => String(names[i]).toLowerCase().endsWith(".shp"))
    if (hasShp && item.indices.length > 1) {
      out.push({ type: "bundle", indices: item.indices, base: item.base })
    } else {
      for (const index of item.indices) out.push({ type: "single", index })
    }
  }
  return out
}

/**
 * Map one /api/datasets/upload-paths result entry to a UI status entry.
 * Pure: the component performs the ADD_DATASET dispatch for state "done"
 * itself, using entry.dataset (the result minus its status/source
 * bookkeeping fields).
 */
export function entryFromResult(result, key) {
  const label = result.source || result.name || "dropped file"
  if (result.status === "ok") {
    const dataset = { ...result }
    delete dataset.status
    delete dataset.source
    return { key, label, state: "done", dataset,
             note: result.zip_note || result.geometry_note || "" }
  }
  if (result.status === "needs_choice") {
    return { key, label, state: "choice", kind: result.kind,
             options: result.options || [], detail: result.detail || "",
             paths: result.paths || [] }
  }
  return { key, label, state: "error",
           message: result.detail || "That file could not be loaded." }
}
