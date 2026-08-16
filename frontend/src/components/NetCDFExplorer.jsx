import { useState, useEffect, useRef, useCallback } from "react"
import { netcdfApi, frameApi } from "../api"

const COLORMAPS = ["viridis","plasma","inferno","magma","turbo","rdylgn","spectral","blues","reds","coolwarm","gray","terrain"]
const FPS_OPTIONS = [1, 2, 4, 6, 8, 12, 24]

// ─────────────────────────────────────────────────────────────────────────────
// Main component — handles both NetCDF and raster multiband
// ─────────────────────────────────────────────────────────────────────────────
export default function NetCDFExplorer({ datasetId, netcdfMeta, rasterMeta, onBandLoaded }) {
  const isRaster = !!rasterMeta && !netcdfMeta
  const timeInfo   = netcdfMeta?.time_info
  const variables  = netcdfMeta?.variables || {}
  const dims       = netcdfMeta?.dimensions || {}
  const nBands     = rasterMeta?.bands || 1
  const bandDescs  = rasterMeta?.band_descriptions || []
  const bandStats  = rasterMeta?.band_stats || []
  const levDimName = Object.keys(dims).find(d =>
    ["level","lev","pressure","plev","depth","height","z"].includes(d.toLowerCase()))
  // Filter to real spatial data vars — skip grid-mapping containers (0-dim or have grid_mapping_name)
  const dataVars   = Object.entries(variables)
    .filter(([, v]) => v.dims && v.dims.length >= 2)
    .map(([k]) => k)
    .slice(0, 20)
  const nTimes     = timeInfo?.n_steps || 1
  const nLevels    = levDimName ? (dims[levDimName] || 1) : 1
  const timeLabels = timeInfo?.labels || []
  const nSteps     = isRaster ? nBands : nTimes

  // ── Shared state ───────────────────────────────────────────────────────
  const [tab,        setTab]        = useState("explore")
  const [selVar,     setSelVar]     = useState(dataVars[0] || "")
  const [colormap,   setColormap]   = useState("viridis")
  const [timeIdx,    setTimeIdx]    = useState(0)
  const [levelIdx,   setLevelIdx]   = useState(0)
  const [bandIdx,    setBandIdx]    = useState(1)    // 1-indexed for raster
  const [frameUrl,   setFrameUrl]   = useState("")
  const [frameStats, setFrameStats] = useState(null)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [loadingBand,  setLoadingBand]  = useState(false)
  const [error,      setError]      = useState(null)

  // Animation state
  const [playing,      setPlaying]     = useState(false)
  const [fps,          setFps]         = useState(4)
  const [animStep,     setAnimStep]    = useState(0)
  const [startStep,    setStartStep]   = useState(0)
  const [endStep,      setEndStep]     = useState(Math.max(0, nSteps - 1))
  const [loop,         setLoop]        = useState(true)
  const [exportMode,   setExportMode]  = useState(false)
  const [exportPct,    setExportPct]   = useState(0)
  const [exportFmt,    setExportFmt]   = useState('gif')
  const intervalRef  = useRef(null)
  const loadBandTimer = useRef(null)

  // ── Build direct image URL ─────────────────────────────────────────────
  function makeFrameUrl(t, l, b, v, cm) {
    const ts = Date.now() // cache-bust so browser always fetches fresh
    if (isRaster)
      return `/api/raster/${encodeURIComponent(datasetId)}/animation_frame?band=${b}&colormap=${cm}&width=500&_ts=${ts}`
    return `/api/netcdf/${encodeURIComponent(datasetId)}/animation_frame?variable=${encodeURIComponent(v)}&time_index=${t}&level_index=${l}&colormap=${cm}&width=500&_ts=${ts}`
  }

  // ── Fetch stats (separate from image) ─────────────────────────────────
  async function fetchStats(t, l, b, v, cm) {
    try {
      if (isRaster) {
        const res = await fetch(`/api/raster/${encodeURIComponent(datasetId)}/band_slice?band=${b}&colormap=${cm}`)
        if (res.ok) { const d = await res.json(); setFrameStats(d.stats) }
      } else {
        const res = await fetch(`/api/netcdf/${encodeURIComponent(datasetId)}/slice`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variable: v, time_index: t, level_index: l, colormap: cm })
        })
        if (res.ok) { const d = await res.json(); setFrameStats(d.stats) }
      }
    } catch {}
  }

  // ── Push current time band to backend so other tabs update ────────────
  async function pushBandToBackend(t, l, v) {
    if (isRaster) return // raster doesn't need this
    try {
      const res = await netcdfApi.loadTimeBand(datasetId, t, l)
      onBandLoaded?.(res)
    } catch {}
  }

  // ── Refresh frame image + stats ────────────────────────────────────────
  function refreshFrame(t, l, b, v, cm, pushToAnalysis = false) {
    setError(null)
    setFrameUrl(makeFrameUrl(t, l, b, v, cm))
    setLoadingFrame(true)
    fetchStats(t, l, b, v, cm).then(() => setLoadingFrame(false))
    if (pushToAnalysis && !isRaster) {
      clearTimeout(loadBandTimer.current)
      loadBandTimer.current = setTimeout(() => pushBandToBackend(t, l, v), 400)
    }
  }

  // Initial load
  useEffect(() => {
    setTimeIdx(0); setLevelIdx(0); setBandIdx(1); setAnimStep(0)
    setEndStep(Math.max(0, nSteps - 1))
    const v = dataVars[0] || ""
    setSelVar(v)
    refreshFrame(0, 0, 1, v, "viridis", false)
  }, [datasetId])

  // ── Animation ticker ───────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) { clearInterval(intervalRef.current); return }
    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setAnimStep(prev => {
        const next = prev + 1
        if (next > endStep) {
          if (loop) return startStep
          clearInterval(intervalRef.current)
          setPlaying(false)
          return prev
        }
        return next
      })
    }, 1000 / fps)
    return () => clearInterval(intervalRef.current)
  }, [playing, fps, startStep, endStep, loop])

  // When animStep changes during animation, update the displayed frame
  useEffect(() => {
    if (tab !== "animate") return
    const url = makeFrameUrl(animStep, levelIdx, animStep + 1, selVar, colormap)
    setFrameUrl(url)
    // Also push to analysis tabs so data table updates
    if (!isRaster) {
      clearTimeout(loadBandTimer.current)
      loadBandTimer.current = setTimeout(() => pushBandToBackend(animStep, levelIdx, selVar), 50)
    }
  }, [animStep])

  function togglePlay() {
    if (!playing && animStep >= endStep) setAnimStep(startStep)
    setPlaying(p => !p)
  }

  function stepTo(s) {
    setPlaying(false)
    setAnimStep(s)
    const url = makeFrameUrl(s, levelIdx, s + 1, selVar, colormap)
    setFrameUrl(url)
    if (!isRaster) pushBandToBackend(s, levelIdx, selVar)
  }

  // ── Export GIF / MP4 via backend ──────────────────────────────────────
  async function exportAnimation() {
    setExportMode(true); setExportPct(0); setError(null)
    try {
      // Call backend to build the animation server-side
      const payload = {
        dataset_id: datasetId,
        format: exportFmt,
        variable: selVar,
        colormap,
        start: startStep,
        end: endStep,
        fps,
        width: 600,
        level_index: levelIdx,
      }
      setExportPct(10)
      const resp = await fetch('/api/animation/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(err.detail || `Export failed: ${resp.status}`)
      }
      setExportPct(90)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ext = exportFmt === 'mp4' ? 'mp4' : 'gif'
      const note = resp.headers.get('X-Note')
      a.href = url
      a.download = `${datasetId.replace(/\./g,'_')}_animation.${ext}`
      document.body.appendChild(a); a.click()
      document.body.removeChild(a); URL.revokeObjectURL(url)
      setExportPct(100)
      if (note) setError(`Note: ${note}`)
    } catch (e) {
      setError(e.message)
    }
    setExportMode(false)
  }

  const fmt = v => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"
  const currentLabel = isRaster
    ? (bandDescs[bandIdx-1] || `Band ${bandIdx}`)
    : (timeLabels[timeIdx] || `Step ${timeIdx+1}`)

  const animLabel = isRaster
    ? (bandDescs[animStep] || `Band ${animStep+1}`)
    : (timeLabels[animStep] || `Step ${animStep+1}`)

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ background:"var(--bg3)", border:"1px solid var(--bdr)", borderRadius:"var(--rl)", padding:14, marginBottom:14 }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:13, fontFamily:"var(--font-display)", fontWeight:300, color:"var(--txt)" }}>
          {isRaster ? "Raster Band Explorer" : "NetCDF Explorer"}
        </span>
        {isRaster && <span className="badge purple">{nBands} bands</span>}
        {!isRaster && <span className="badge blue">{nTimes} time step{nTimes!==1?"s":""}{levDimName ? ` · ${nLevels} ${levDimName}` : ""}</span>}
        {timeInfo?.units && <span style={{ fontSize:10, color:"var(--txt3)" }}>{timeInfo.units}</span>}
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", background:"var(--bg)", borderRadius:"var(--r)", padding:2, gap:2 }}>
          {["explore","animate"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:"4px 12px", fontSize:11, borderRadius:"var(--r)", cursor:"pointer",
              background: tab===t ? (t==="animate" ? "var(--accent)" : "var(--bg3)") : "transparent",
              color: tab===t ? (t==="animate" ? "#0e0f11" : "var(--txt)") : "var(--txt3)",
              border:"none", fontFamily:"var(--font-body)", fontWeight: tab===t ? 600 : 400
            }}>
              {t==="animate" ? "▶ Animate" : "Explore"}
            </button>
          ))}
        </div>
      </div>

      {/* ── EXPLORE TAB ───────────────────────────────────────────────── */}
      {tab === "explore" && (<>
        {/* Controls */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
          {!isRaster && (
            <div>
              <label className="field-label">Variable</label>
              <select value={selVar} onChange={e => {
                const v=e.target.value; setSelVar(v)
                refreshFrame(timeIdx, levelIdx, bandIdx, v, colormap, true)
              }}>
                {dataVars.map(v => <option key={v} value={v}>{v}{variables[v]?.units ? ` (${variables[v].units})` : ""}</option>)}
              </select>
            </div>
          )}
          {isRaster && (
            <div>
              <label className="field-label">Band</label>
              <select value={bandIdx} onChange={e => {
                const b=+e.target.value; setBandIdx(b)
                refreshFrame(timeIdx, levelIdx, b, selVar, colormap, false)
              }}>
                {Array.from({ length: nBands }, (_,i) => (
                  <option key={i+1} value={i+1}>{bandDescs[i] || `Band ${i+1}`}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="field-label">Colormap</label>
            <select value={colormap} onChange={e => {
              const cm=e.target.value; setColormap(cm)
              refreshFrame(timeIdx, levelIdx, bandIdx, selVar, cm, false)
            }}>
              {COLORMAPS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Time slider */}
        {!isRaster && nTimes > 1 && (
          <div style={{ marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <label className="field-label" style={{ margin:0 }}>
                Time: <span style={{ color:"var(--accent)", fontFamily:"var(--font-mono)" }}>
                  {timeLabels[timeIdx] || `Step ${timeIdx+1}`}
                </span>
              </label>
              <span style={{ fontSize:10, color:"var(--txt3)", fontFamily:"var(--font-mono)" }}>{timeIdx+1} / {nTimes}</span>
            </div>
            <input type="range" min={0} max={nTimes-1} value={timeIdx}
              onChange={e => {
                const t=+e.target.value; setTimeIdx(t)
                refreshFrame(t, levelIdx, bandIdx, selVar, colormap, true)
              }}
              style={{ width:"100%" }} />
            {/* Tick labels */}
            {timeLabels.length > 1 && (
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
                {[0, ...Array.from({length:5},(_,i)=>Math.round((i+1)*(nTimes-1)/6)), nTimes-1]
                  .filter((v,i,a)=>a.indexOf(v)===i).map(i => (
                  <span key={i}
                    onClick={() => { setTimeIdx(i); refreshFrame(i, levelIdx, bandIdx, selVar, colormap, true) }}
                    style={{ fontSize:9, color:i===timeIdx?"var(--accent)":"var(--txt3)", cursor:"pointer",
                      fontFamily:"var(--font-mono)", maxWidth:72, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                    title={timeLabels[i]}>
                    {(timeLabels[i]||String(i)).slice(0,10)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Level slider */}
        {!isRaster && levDimName && nLevels > 1 && (
          <div style={{ marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <label className="field-label" style={{ margin:0 }}>
                {levDimName}: <span style={{ color:"var(--accent2)", fontFamily:"var(--font-mono)" }}>{levelIdx}</span>
              </label>
              <span style={{ fontSize:10, color:"var(--txt3)", fontFamily:"var(--font-mono)" }}>{levelIdx+1} / {nLevels}</span>
            </div>
            <input type="range" min={0} max={nLevels-1} value={levelIdx}
              onChange={e => {
                const l=+e.target.value; setLevelIdx(l)
                refreshFrame(timeIdx, l, bandIdx, selVar, colormap, true)
              }}
              style={{ width:"100%" }} />
          </div>
        )}

        {error && <div className="error-box" style={{ marginBottom:8 }}>{error}</div>}

        {/* Frame image */}
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:"var(--txt3)", marginBottom:4, fontFamily:"var(--font-mono)" }}>
            {isRaster ? `Band ${bandIdx}` : selVar} — {currentLabel}
          </div>
          {frameUrl
            ? <div style={{ position:"relative" }}>
                <img src={frameUrl} alt="frame"
                  onLoad={() => setLoadingFrame(false)}
                  onError={() => { setLoadingFrame(false); setError("Frame failed to load — check backend is running") }}
                  style={{ width:"100%", borderRadius:"var(--r)", border:"1px solid var(--bdr)", display:"block",
                    opacity: loadingFrame ? 0.4 : 1, transition:"opacity 0.2s" }} />
                {loadingFrame && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <div className="spinner" />
                </div>}
              </div>
            : <div style={{ height:120, display:"flex", alignItems:"center", justifyContent:"center",
                background:"var(--bg)", borderRadius:"var(--r)", border:"1px solid var(--bdr)" }}>
                <div className="spinner" />
              </div>
          }
          {frameStats && (
            <div style={{ display:"flex", gap:14, marginTop:5, fontSize:10, color:"var(--txt3)", fontFamily:"var(--font-mono)" }}>
              <span>min <span style={{ color:"var(--txt2)" }}>{fmt(frameStats.min)}</span></span>
              <span>max <span style={{ color:"var(--txt2)" }}>{fmt(frameStats.max)}</span></span>
              <span>mean <span style={{ color:"var(--txt2)" }}>{fmt(frameStats.mean)}</span></span>
              {frameStats.nodata_count > 0 && <span style={{ color:"var(--accent4)" }}>{frameStats.nodata_count.toLocaleString()} nodata</span>}
            </div>
          )}
        </div>

        {/* Stats row */}
        {!isRaster && selVar && variables[selVar]?.stats?.count > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:10 }}>
            {[["min (all time)", variables[selVar].stats.min], ["mean", variables[selVar].stats.mean], ["max", variables[selVar].stats.max]].map(([l,v]) => (
              <div key={l} className="metric" style={{ padding:"6px 8px" }}>
                <div className="metric-label">{l}</div>
                <div className="metric-val" style={{ fontSize:13 }}>{fmt(v)}</div>
              </div>
            ))}
          </div>
        )}
        {isRaster && bandStats[bandIdx-1] && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:10 }}>
            {[["min", bandStats[bandIdx-1].min], ["mean", bandStats[bandIdx-1].mean], ["max", bandStats[bandIdx-1].max]].map(([l,v]) => (
              <div key={l} className="metric" style={{ padding:"6px 8px" }}>
                <div className="metric-label">{l}</div>
                <div className="metric-val" style={{ fontSize:13 }}>{v!=null?v.toFixed(3):"—"}</div>
              </div>
            ))}
          </div>
        )}

        {/* Load into analysis — NetCDF only */}
        {!isRaster && (
          <div style={{ borderTop:"1px solid var(--bdr)", paddingTop:10, display:"flex", alignItems:"center", gap:10 }}>
            <button className="btn primary" onClick={async () => {
              setLoadingBand(true)
              try { const r = await netcdfApi.loadTimeBand(datasetId, timeIdx, levelIdx); onBandLoaded?.(r) }
              catch(e) { setError(e.message) }
              setLoadingBand(false)
            }} disabled={loadingBand} style={{ flex:1 }}>
              {loadingBand ? <><div className="spinner" />Loading…</> : `Load "${timeLabels[timeIdx]||`step ${timeIdx+1}`}" into analysis`}
            </button>
            <span style={{ fontSize:10, color:"var(--txt3)", maxWidth:130, lineHeight:1.4 }}>
              Pushes this time step to Statistics, Analyze &amp; Cartography
            </span>
          </div>
        )}
      </>)}

      {/* ── ANIMATE TAB ───────────────────────────────────────────────── */}
      {tab === "animate" && (<>
        {nSteps <= 1
          ? <div style={{ padding:"20px 0", fontSize:12, color:"var(--txt3)", textAlign:"center" }}>
              Only 1 {isRaster?"band":"time step"} — nothing to animate.
            </div>
          : <>
            {/* Current frame */}
            <div style={{ marginBottom:10, position:"relative" }}>
              {frameUrl
                ? <>
                    <img src={frameUrl} alt="frame"
                      onLoad={() => setLoadingFrame(false)}
                      onError={() => setLoadingFrame(false)}
                      style={{ width:"100%", borderRadius:"var(--r)", border:"1px solid var(--bdr)", display:"block",
                        opacity: loadingFrame ? 0.5 : 1, transition:"opacity 0.15s" }} />
                    <div style={{ position:"absolute", top:6, right:8, background:"rgba(14,15,17,0.85)",
                      borderRadius:4, padding:"2px 8px", fontSize:10, fontFamily:"var(--font-mono)", color:"var(--accent)" }}>
                      {animLabel}
                    </div>
                  </>
                : <div style={{ height:160, display:"flex", alignItems:"center", justifyContent:"center",
                    background:"var(--bg)", borderRadius:"var(--r)", border:"1px solid var(--bdr)" }}>
                    <div className="spinner" />
                  </div>
              }
            </div>

            {/* Scrubber */}
            <div style={{ marginBottom:8 }}>
              <input type="range" min={startStep} max={endStep} value={animStep}
                onChange={e => stepTo(+e.target.value)}
                style={{ width:"100%" }} />
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--txt3)", fontFamily:"var(--font-mono)" }}>
                <span>{timeLabels[startStep] || (isRaster ? `Band ${startStep+1}` : `Step ${startStep+1}`)}</span>
                <span style={{ color:"var(--accent)" }}>{animStep+1} / {nSteps}</span>
                <span>{timeLabels[endStep] || (isRaster ? `Band ${endStep+1}` : `Step ${endStep+1}`)}</span>
              </div>
            </div>

            {/* Playback controls */}
            <div style={{ display:"flex", gap:7, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
              <button className="btn sm" onClick={() => stepTo(startStep)} title="First">⏮</button>
              <button className="btn sm" onClick={() => stepTo(Math.max(startStep, animStep-1))} title="Back">◀</button>
              <button className={`btn sm${playing ? "" : " primary"}`} onClick={togglePlay} style={{ minWidth:70 }}>
                {playing ? "⏸ Pause" : "▶ Play"}
              </button>
              <button className="btn sm" onClick={() => stepTo(Math.min(endStep, animStep+1))} title="Forward">▶</button>
              <button className="btn sm" onClick={() => stepTo(endStep)} title="Last">⏭</button>
              <div style={{ flex:1 }} />
              <label style={{ fontSize:11, color:"var(--txt2)", display:"flex", alignItems:"center", gap:5 }}>
                <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> Loop
              </label>
              <select value={fps} onChange={e => setFps(+e.target.value)} style={{ width:72, fontSize:11 }}>
                {FPS_OPTIONS.map(f => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </div>

            {/* Variable + colormap (synced with explore tab) */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
              {!isRaster && (
                <div>
                  <label className="field-label">Variable</label>
                  <select value={selVar} onChange={e => { setSelVar(e.target.value); setPlaying(false) }} style={{ fontSize:11 }}>
                    {dataVars.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="field-label">Colormap</label>
                <select value={colormap} onChange={e => { setColormap(e.target.value); setPlaying(false) }} style={{ fontSize:11 }}>
                  {COLORMAPS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Range */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
              <div>
                <label className="field-label">Start</label>
                <select value={startStep} onChange={e => { setStartStep(+e.target.value); setPlaying(false) }} style={{ fontSize:11 }}>
                  {Array.from({ length: nSteps }, (_,i) => (
                    <option key={i} value={i}>{timeLabels[i] || (isRaster ? `Band ${i+1}` : `Step ${i+1}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">End</label>
                <select value={endStep} onChange={e => { setEndStep(+e.target.value); setPlaying(false) }} style={{ fontSize:11 }}>
                  {Array.from({ length: nSteps }, (_,i) => (
                    <option key={i} value={i}>{timeLabels[i] || (isRaster ? `Band ${i+1}` : `Step ${i+1}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Export */}
            <div style={{ borderTop:"1px solid var(--bdr)", paddingTop:10 }}>
              {exportMode
                ? <div style={{ fontSize:12, color:"var(--txt2)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <div className="spinner" />
                      <span>Building {exportFmt.toUpperCase()}… rendering on server</span>
                    </div>
                    <div style={{ height:4, background:"var(--bg4)", borderRadius:2 }}>
                      <div style={{ width:exportPct+"%", height:"100%", background:"var(--accent)", borderRadius:2, transition:"width 0.3s" }} />
                    </div>
                    <div style={{ fontSize:10, color:"var(--txt3)", marginTop:4 }}>
                      {endStep - startStep + 1} frames × {fps} fps — may take a few seconds
                    </div>
                  </div>
                : <div>
                    <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                      {['gif','mp4'].map(f => (
                        <button key={f} onClick={() => setExportFmt(f)}
                          style={{ flex:1, padding:"6px 0", borderRadius:"var(--r)", cursor:"pointer",
                            background: exportFmt===f ? "var(--accent-dim)" : "var(--bg)",
                            border: `1px solid ${exportFmt===f ? "rgba(110,231,183,0.4)" : "var(--bdr2)"}`,
                            color: exportFmt===f ? "var(--accent)" : "var(--txt2)",
                            fontSize:12, fontWeight: exportFmt===f ? 600 : 400, fontFamily:"var(--font-body)" }}>
                          .{f.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                      <button className="btn primary" onClick={exportAnimation} style={{ flex:1 }}>
                        ↓ Export as .{exportFmt} ({endStep - startStep + 1} frames)
                      </button>
                    </div>
                    <div style={{ fontSize:10, color:"var(--txt3)", marginTop:5, lineHeight:1.5 }}>
                      {exportFmt==='gif' ? 'Animated GIF — opens in any browser or image viewer'
                        : 'MP4 video — requires imageio[ffmpeg] on server, falls back to GIF'}
                    </div>
                  </div>
              }
              {error && <div className="error-box" style={{ marginTop:8 }}>{error}</div>}
            </div>
          </>
        }
      </>)}
    </div>
  )
}
