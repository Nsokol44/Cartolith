import { useEffect, useRef, useState } from "react"
import { useApp } from "../store"
import { uploadPaths, uploadWithProgress } from "../api"
import { planBrowserFiles, entryFromResult } from "../dropingest"

// Drag & drop data loading for the whole window.
//
// Why this exists: Tauri v2's native drag-drop handler is enabled by
// default and OWNS OS file drags over the webview — it delivers file
// PATHS as tauri:// drag-drop events, and HTML5 drop events never fire
// with usable files. Until this component, nothing listened on either
// channel and the upload path only accepted browser File objects, so
// dropping a file on the app was a silent nothing.
//
// Two channels, one pipeline:
//   * Tauri: getCurrentWebview().onDragDropEvent → paths →
//     POST /api/datasets/upload-paths (backend reads the files from
//     disk through the same parser pipeline as the picker upload).
//   * Browser / dev server: HTML5 drop → File objects → the picker's
//     own uploadWithProgress path (with shapefile-part bundling).
// Every outcome is surfaced in the status stack at bottom-right: a
// layer appearing is success; a failure shows the backend's actual
// reason (never a bare "failed"); a multi-layer/sheet file asks which
// one, in place.

let entrySeq = 0
const nextKey = () => `drop-${Date.now()}-${entrySeq++}`

export default function DropIngest() {
  const { dispatch } = useApp()
  const [dragging, setDragging] = useState(false)
  const [entries, setEntries] = useState([])
  const dragDepth = useRef(0)

  function patchEntry(key, patch) {
    setEntries(es => es.map(e => e.key === key ? { ...e, ...patch } : e))
  }
  function dismissLater(key, ms) {
    setTimeout(() => setEntries(es => es.filter(e => e.key !== key)), ms)
  }
  function dismiss(key) {
    setEntries(es => es.filter(e => e.key !== key))
  }

  function settleResults(results, workingKey) {
    const fresh = results.map(r => entryFromResult(r, nextKey()))
    fresh.forEach(e => {
      if (e.state === "done") {
        dispatch({ type: "ADD_DATASET", dataset: e.dataset })
        dismissLater(e.key, 7000)
      }
    })
    setEntries(es => [...es.filter(e => e.key !== workingKey), ...fresh])
  }

  async function ingestPaths(paths, workingKey) {
    try {
      const results = await uploadPaths(paths)
      settleResults(results, workingKey)
    } catch (err) {
      patchEntry(workingKey, { state: "error", label: "Dropped files",
        message: err.message?.split("\n")[0] || "The drop could not be loaded." })
    }
  }

  async function pickPathChoice(entry, option) {
    patchEntry(entry.key, { state: "working" })
    try {
      const results = await uploadPaths(entry.paths, { [entry.kind]: option })
      settleResults(results, entry.key)
    } catch (err) {
      patchEntry(entry.key, { state: "error",
        message: err.message?.split("\n")[0] || "That choice could not be loaded." })
    }
  }

  async function ingestOneFile(file, params) {
    const key = nextKey()
    setEntries(es => [...es, { key, label: file.name, state: "working" }])
    try {
      const result = await uploadWithProgress(file, file.name, null, params)
      if (result.needs_choice) {
        patchEntry(key, { state: "choice", kind: result.kind,
          options: result.options || [], detail: result.detail || "", file })
      } else {
        dispatch({ type: "ADD_DATASET", dataset: result })
        patchEntry(key, { state: "done",
          note: result.zip_note || result.geometry_note || "" })
        dismissLater(key, 7000)
      }
    } catch (err) {
      patchEntry(key, { state: "error",
        message: err.message?.split("\n\n")[0] || "Upload failed." })
    }
  }

  async function pickFileChoice(entry, option) {
    dismiss(entry.key)
    await ingestOneFile(entry.file, { [entry.kind]: option })
  }

  async function ingestBrowserFiles(fileList) {
    const picked = Array.from(fileList)
    if (!picked.length) return
    const plan = planBrowserFiles(picked.map(f => f.name))
    for (const step of plan) {
      if (step.type === "bundle") {
        const parts = step.indices.map(i => picked[i])
        try {
          const { zipStore } = await import("../zipstore")
          const blob = await zipStore(parts.map(f => ({ name: f.name, blob: f })))
          await ingestOneFile(new File([blob], `${step.base}.zip`,
                                       { type: "application/zip" }))
        } catch {
          for (const f of parts) await ingestOneFile(f)
        }
      } else {
        await ingestOneFile(picked[step.index])
      }
    }
  }

  // Tauri native drag-drop: paths, not File objects.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return
    let unlisten, cancelled = false
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload
        if (p.type === "enter" || p.type === "over") setDragging(true)
        else if (p.type === "leave") setDragging(false)
        else if (p.type === "drop") {
          setDragging(false)
          if (p.paths?.length) {
            const key = nextKey()
            setEntries(es => [...es, { key, state: "working",
              label: `Loading ${p.paths.length} dropped file${p.paths.length === 1 ? "" : "s"}…` }])
            ingestPaths(p.paths, key)
          }
        }
      }))
      .then(u => { if (cancelled) u(); else unlisten = u })
      .catch(() => {})
    return () => { cancelled = true; if (unlisten) unlisten() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // HTML5 fallback (browser / dev server). Under Tauri the native
  // handler owns OS file drags, so these simply never fire there.
  useEffect(() => {
    const onDragEnter = (e) => { e.preventDefault(); dragDepth.current += 1; setDragging(true) }
    const onDragOver = (e) => { e.preventDefault() }
    const onDragLeave = () => {
      dragDepth.current -= 1
      if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) }
    }
    const onDrop = (e) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (e.dataTransfer?.files?.length) ingestBrowserFiles(e.dataTransfer.files)
    }
    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {dragging && (
        <div style={{ position: "fixed", inset: 0, zIndex: 85, pointerEvents: "none",
          background: "rgba(8,12,10,0.55)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ border: "2px dashed var(--accent)", borderRadius: "var(--rl)",
            padding: "32px 42px", background: "var(--bg2)", textAlign: "center",
            maxWidth: "92vw" }}>
            <div style={{ fontSize: 20, color: "var(--accent)", fontWeight: 600 }}>
              Drop to load data
            </div>
            <div style={{ fontSize: 12, color: "var(--txt2)", marginTop: 6, lineHeight: 1.5 }}>
              Shapefiles (drop the parts together) · ZIP · GeoJSON · CSV · Stata .dta<br/>
              GeoTIFF · NetCDF · GRIB · KML · GeoPackage — anything the + Load button takes
            </div>
          </div>
        </div>
      )}
      {entries.length > 0 && (
        <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 84,
          width: 360, maxWidth: "calc(100vw - 28px)", display: "flex",
          flexDirection: "column", gap: 6, maxHeight: "55vh", overflowY: "auto" }}>
          {entries.map(e => (
            <div key={e.key} style={{ padding: "8px 11px", borderRadius: "var(--r)",
              background: e.state === "error" ? "rgba(251,113,133,0.10)" : "var(--bg2)",
              border: `1px solid ${e.state === "error" ? "rgba(251,113,133,0.35)"
                : e.state === "done" ? "rgba(110,231,183,0.35)" : "var(--bdr2)"}`,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: e.state === "error" ? "var(--accent4)" : "var(--txt)" }}
                  title={e.label}>{e.label}</span>
                <span style={{ fontSize: 10, fontFamily: "var(--font-mono)",
                  color: "var(--txt3)", flexShrink: 0 }}>
                  {e.state === "working" ? "loading…"
                    : e.state === "done" ? "✓ loaded"
                    : e.state === "choice" ? "pick one"
                    : "✗ failed"}
                </span>
                {e.state !== "working" && (
                  <button className="btn ghost icon sm"
                    onClick={() => dismiss(e.key)}
                    style={{ flexShrink: 0, width: 18, height: 18, fontSize: 13, padding: 0 }}>×</button>
                )}
              </div>
              {e.state === "working" && (
                <div style={{ height: 3, background: "var(--bg4)", borderRadius: 2,
                  overflow: "hidden", marginTop: 6 }}>
                  <div style={{ height: "100%", width: "100%", borderRadius: 2,
                    background: "var(--accent3)", animation: "pulse 1.2s ease-in-out infinite" }}/>
                </div>
              )}
              {e.state === "done" && e.note && (
                <div style={{ fontSize: 10, color: "var(--txt3)", marginTop: 4, lineHeight: 1.45 }}>
                  {e.note}
                </div>
              )}
              {e.state === "error" && (
                <div style={{ fontSize: 10.5, color: "var(--txt2)", marginTop: 4,
                  lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto" }}>
                  {e.message}
                </div>
              )}
              {e.state === "choice" && (
                <div style={{ marginTop: 5 }}>
                  <div style={{ fontSize: 10.5, color: "var(--txt2)", lineHeight: 1.45 }}>
                    {e.detail || `This file has several ${e.kind}s — which one?`}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {e.options.map(opt => (
                      <button key={String(opt)} className="btn sm"
                        onClick={() => e.paths?.length
                          ? pickPathChoice(e, opt) : pickFileChoice(e, opt)}>
                        {String(opt)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
