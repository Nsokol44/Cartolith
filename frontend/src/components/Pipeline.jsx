import { useState, useMemo } from 'react'
import { useApp } from '../store'
import { pipelineApi } from '../api'

const KIND_COLOR = { table: 'var(--accent5)', vector: 'var(--accent)', raster: 'var(--accent3)' }
function kindOf(ds) { return ds.raster_meta ? 'raster' : (ds.geo_meta || (ds.columns || []).includes('_geom_wkt')) ? 'vector' : 'table' }

export default function Pipeline({ open, onClose }) {
  const { state, dispatch } = useApp()
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [sel, setSel] = useState(null)

  const datasets = state.datasets
  const layout = useMemo(() => {
    const nodes = Object.values(datasets)
    const byId = {}; nodes.forEach(n => (byId[n.id] = n))
    const depthMemo = {}
    const depth = (id, seen = new Set()) => {
      const n = byId[id]
      if (!n || !n.derived || !(n.derived.sources || []).length || seen.has(id)) return 0
      if (depthMemo[id] != null) return depthMemo[id]
      seen.add(id)
      const d = 1 + Math.max(0, ...n.derived.sources.filter(s => byId[s]).map(s => depth(s, new Set(seen))))
      depthMemo[id] = d; return d
    }
    const levels = {}
    nodes.forEach(n => { const d = depth(n.id); (levels[d] = levels[d] || []).push(n) })
    const colW = 210, rowH = 70, padX = 24, padY = 24, nodeW = 168, nodeH = 46
    const pos = {}
    const maxLevel = Math.max(0, ...Object.keys(levels).map(Number))
    Object.entries(levels).forEach(([d, ns]) => ns.forEach((n, i) => {
      pos[n.id] = { x: padX + Number(d) * colW, y: padY + i * rowH, w: nodeW, h: nodeH }
    }))
    const height = padY * 2 + Math.max(1, ...Object.values(levels).map(l => l.length)) * rowH
    const width = padX * 2 + (maxLevel + 1) * colW
    const edges = []
    nodes.forEach(n => (n.derived?.sources || []).forEach(s => { if (byId[s]) edges.push([s, n.id]) }))
    return { nodes, byId, pos, edges, width: Math.max(width, 640), height: Math.max(height, 260) }
  }, [datasets])

  if (!open) return null

  async function rerun(ds) {
    if (!ds.derived) return
    setBusy(ds.id); setMsg(null)
    try {
      const out = await pipelineApi.rerun(ds.derived, `${ds.id} (re-run)`)
      dispatch({ type: 'ADD_DATASET', dataset: out })
      setMsg(`Re-ran → ${out.id}`)
    } catch (e) { setMsg(e.message?.split('\n')[0] || 'Re-run failed') }
    finally { setBusy(null) }
  }

  const nodeCount = layout.nodes.length
  const derivedCount = layout.nodes.filter(n => n.derived).length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ width: 'min(920px, 96vw)', height: 'min(680px, 92vh)', background: 'var(--bg2)', border: '1px solid var(--bdr2)', borderRadius: 'var(--rl)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 300, color: 'var(--txt)' }}>Pipeline &amp; lineage</div>
            <div style={{ fontSize: 11.5, color: 'var(--txt3)', marginTop: 2 }}>How every dataset was made — {derivedCount} of {nodeCount} are derived. Click a step to re-run its recipe.</div>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {msg && <div style={{ padding: '7px 18px', fontSize: 12, color: 'var(--accent)', background: 'var(--accent-dim)', borderBottom: '1px solid var(--bdr)' }}>{msg}</div>}

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {nodeCount === 0 ? (
              <div className="empty-state" style={{ marginTop: 40 }}>No datasets yet. Load data and run a tool — the recipe graph builds itself.</div>
            ) : (
              <svg width={layout.width} height={layout.height} style={{ display: 'block' }}>
                <defs>
                  <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="var(--bdr3)" />
                  </marker>
                </defs>
                {layout.edges.map(([a, b], i) => {
                  const pa = layout.pos[a], pb = layout.pos[b]
                  if (!pa || !pb) return null
                  const x1 = pa.x + pa.w, y1 = pa.y + pa.h / 2, x2 = pb.x, y2 = pb.y + pb.h / 2
                  const mx = (x1 + x2) / 2
                  return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--bdr3)" strokeWidth="1.5" markerEnd="url(#arrow)" opacity="0.8" />
                })}
                {layout.nodes.map(n => {
                  const p = layout.pos[n.id]; if (!p) return null
                  const kind = kindOf(n); const color = KIND_COLOR[kind]
                  const isSel = sel === n.id
                  return (
                    <g key={n.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }} onClick={() => setSel(n.id)}>
                      <rect width={p.w} height={p.h} rx="8" fill={isSel ? 'var(--bg3)' : 'var(--bg)'} stroke={isSel ? color : 'var(--bdr2)'} strokeWidth={isSel ? 2 : 1} />
                      <rect width="4" height={p.h} rx="2" fill={color} />
                      <text x="12" y="19" fontSize="11.5" fontFamily="var(--font-body)" fill="var(--txt)" style={{ fontWeight: 500 }}>{n.id.length > 22 ? n.id.slice(0, 21) + '…' : n.id}</text>
                      <text x="12" y="34" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--txt3)">{n.derived ? `⤳ ${n.derived.op}` : kind}{n.sample ? ' · sample' : ''}</text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>

          {sel && layout.byId[sel] && (
            <div style={{ width: 250, flexShrink: 0, borderLeft: '1px solid var(--bdr)', padding: 15, overflow: 'auto', background: 'var(--bg3)' }}>
              {(() => {
                const n = layout.byId[sel]
                return (
                  <>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--txt)', wordBreak: 'break-word' }}>{n.id}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, marginBottom: 10 }}>
                      <span className="badge" style={{ background: 'transparent', border: `1px solid ${KIND_COLOR[kindOf(n)]}`, color: KIND_COLOR[kindOf(n)] }}>{kindOf(n)}</span>
                      {n.shape && <span className="badge gray">{n.shape[0]?.toLocaleString()} rows</span>}
                    </div>
                    {n.derived ? (
                      <>
                        <div className="field-label">Recipe</div>
                        <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.5, marginBottom: 8 }}>{n.derived.detail || n.derived.op}</div>
                        <div className="field-label">Made from</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
                          {(n.derived.sources || []).map(s => (
                            <button key={s} className="tag" style={{ justifyContent: 'flex-start' }} onClick={() => setSel(s)} title="Jump to input">{s}</button>
                          ))}
                          {!(n.derived.sources || []).length && <span style={{ fontSize: 11, color: 'var(--txt3)' }}>—</span>}
                        </div>
                        <button className="btn sm primary" style={{ width: '100%' }} disabled={busy === n.id} onClick={() => rerun(n)}>
                          {busy === n.id ? 'Re-running…' : '↻ Re-run this recipe'}
                        </button>
                        <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 6, lineHeight: 1.4 }}>Reproduces this step from its inputs — handy after the source data changes.</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.5 }}>A source dataset (loaded, not derived). Everything downstream traces back here.</div>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
