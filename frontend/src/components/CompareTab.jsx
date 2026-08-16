import { useState, useEffect, useRef } from 'react'
import { useApp } from '../store'
import { api } from '../api'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

const PALETTE = ['#6ee7b7','#818cf8','#f59e0b','#fb7185','#38bdf8','#a78bfa']

function fmt(v) {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 3 })
  return String(v)
}

function OverlayChart({ series, label }) {
  const canvasRef = useRef()
  const chartRef = useRef()

  useEffect(() => {
    if (!series.length || !canvasRef.current) return
    if (chartRef.current) chartRef.current.destroy()
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        datasets: series.map((s, i) => ({
          label: s.label,
          data: s.values.map((v, x) => ({ x, y: v })),
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE[i % PALETTE.length] + '22',
          borderWidth: 2, pointRadius: 0, fill: false, tension: 0.3,
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9499a8', boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: { type: 'linear', ticks: { color: '#5c6172', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { title: { display: !!label, text: label, color: '#5c6172', font: { size: 10 } }, ticks: { color: '#5c6172', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    })
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [series])

  return <div style={{ height: 220 }}><canvas ref={canvasRef} /></div>
}

export default function CompareTab() {
  const { state } = useApp()
  const datasets = Object.values(state.datasets)
  const [col1, setCol1] = useState('')
  const [col2, setCol2] = useState('')
  const [compType, setCompType] = useState('stats')
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function loadStats() {
    if (datasets.length === 0) return
    setLoading(true); setError(null)
    const newStats = {}
    try {
      for (const ds of datasets) {
        const s = await api.describeDataset(ds.id)
        newStats[ds.id] = s
      }
      setStats(newStats)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { loadStats() }, [datasets.length])

  if (datasets.length === 0) return (
    <div className="empty-state"><div className="icon">⊞</div><div>Load two or more datasets to compare them.</div></div>
  )
  if (datasets.length === 1) return (
    <div className="empty-state"><div>Load a second dataset to enable comparison. Use <strong>+ Add another</strong> in the sidebar.</div></div>
  )

  // Find common numeric columns
  const commonCols = datasets.length > 0
    ? datasets[0].columns?.filter(c =>
        datasets[0].types?.[c] === 'numeric' &&
        datasets.slice(1).every(d => d.columns?.includes(c) && d.types?.[c] === 'numeric')
      ) || []
    : []

  const allNumCols = [...new Set(datasets.flatMap(d => d.columns?.filter(c => d.types?.[c] === 'numeric') || []))]

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>View:</span>
        {['stats', 'overlay', 'schema'].map(t => (
          <span key={t} className={`tag${compType === t ? ' active' : ''}`} onClick={() => setCompType(t)}>
            {t === 'stats' ? 'Summary stats' : t === 'overlay' ? 'Overlay chart' : 'Schema compare'}
          </span>
        ))}
        <button className="btn sm ghost" onClick={loadStats}>{loading ? '↻ Loading…' : '↻ Refresh'}</button>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="loading"><div className="spinner" /><span>Loading…</span></div>}

      {compType === 'schema' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--txt3)', fontWeight: 400, borderBottom: '1px solid var(--bdr2)', background: 'var(--bg3)', position: 'sticky', top: 0 }}>Column</th>
                {datasets.map((d, i) => (
                  <th key={d.id} style={{ padding: '7px 10px', textAlign: 'center', color: PALETTE[i], fontWeight: 500, borderBottom: '1px solid var(--bdr2)', background: 'var(--bg3)', position: 'sticky', top: 0 }}>{d.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allNumCols.slice(0, 50).map(col => (
                <tr key={col} style={{ borderBottom: '1px solid var(--bdr)' }}>
                  <td style={{ padding: '6px 10px', color: 'var(--txt)', fontWeight: 500 }}>{col}</td>
                  {datasets.map(d => {
                    const hasCol = d.columns?.includes(col)
                    const t = d.types?.[col]
                    return (
                      <td key={d.id} style={{ padding: '6px 10px', textAlign: 'center' }}>
                        {hasCol ? <span className={`badge ${t === 'numeric' ? 'green' : 'purple'}`}>{t}</span> : <span style={{ color: 'var(--txt4)', fontSize: 11 }}>—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compType === 'stats' && (
        <div>
          {commonCols.length === 0 ? (
            <div className="empty-state"><div>No common numeric columns found across all datasets.</div></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--txt3)', fontWeight: 400, borderBottom: '1px solid var(--bdr2)', background: 'var(--bg3)', position: 'sticky', top: 0, width: 120 }}>Column</th>
                    <th style={{ padding: '7px 6px', textAlign: 'right', color: 'var(--txt3)', fontWeight: 400, borderBottom: '1px solid var(--bdr2)', background: 'var(--bg3)', position: 'sticky', top: 0, fontSize: 10 }}>Stat</th>
                    {datasets.map((d, i) => (
                      <th key={d.id} style={{ padding: '7px 10px', textAlign: 'right', color: PALETTE[i], fontWeight: 500, borderBottom: '1px solid var(--bdr2)', background: 'var(--bg3)', position: 'sticky', top: 0 }}>{d.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {commonCols.slice(0, 20).flatMap(col =>
                    ['mean', 'median', 'std', 'min', 'max'].map((stat, si) => (
                      <tr key={`${col}-${stat}`} style={{ borderBottom: si === 4 ? '1px solid var(--bdr2)' : '1px solid var(--bdr)', background: si === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                        {si === 0 && <td rowSpan={5} style={{ padding: '6px 10px', color: 'var(--txt)', fontWeight: 500, verticalAlign: 'top', borderRight: '1px solid var(--bdr2)' }}>{col}</td>}
                        <td style={{ padding: '4px 6px', color: 'var(--txt3)', fontSize: 10, fontFamily: 'var(--font-mono)', textAlign: 'right', borderRight: '1px solid var(--bdr)' }}>{stat}</td>
                        {datasets.map((d, i) => {
                          const v = stats[d.id]?.[col]?.[stat]
                          const allVals = datasets.map(d2 => stats[d2.id]?.[col]?.[stat]).filter(x => x != null)
                          const isMax = allVals.length > 1 && v === Math.max(...allVals)
                          const isMin = allVals.length > 1 && v === Math.min(...allVals)
                          return (
                            <td key={d.id} style={{
                              padding: '4px 10px', textAlign: 'right',
                              fontFamily: 'var(--font-mono)', fontSize: 11,
                              color: isMax ? 'var(--accent)' : isMin ? 'var(--accent4)' : 'var(--txt2)',
                            }}>
                              {fmt(v)}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 8 }}>
                <span style={{ color: 'var(--accent)' }}>Green</span> = highest · <span style={{ color: 'var(--accent4)' }}>Red</span> = lowest across datasets
              </div>
            </div>
          )}
        </div>
      )}

      {compType === 'overlay' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="field-label">Column to compare</label>
              <select value={col1} onChange={e => setCol1(e.target.value)} style={{ width: 180 }}>
                <option value="">Select column…</option>
                {commonCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {col1 && (
            <div>
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="section-title" style={{ marginBottom: 12 }}>Distribution overlay — {col1}</div>
                <OverlayChart
                  label={col1}
                  series={datasets.map((d, i) => ({
                    label: d.name,
                    values: (() => {
                      const s = stats[d.id]?.[col1]
                      if (!s) return []
                      const { min, max, mean, std } = s
                      if (min == null) return []
                      const n = 50
                      return Array.from({ length: n }, (_, k) => {
                        const x = min + (max - min) * k / (n - 1)
                        const z = (x - mean) / (std || 1)
                        return Math.exp(-0.5 * z * z) / ((std || 1) * Math.sqrt(2 * Math.PI))
                      })
                    })()
                  })).filter(s => s.values.length > 0)}
                />
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 6 }}>Approximate normal distribution overlay based on mean/std</div>
              </div>

              <div className="card">
                <div className="section-title">Side-by-side statistics</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--txt3)', fontWeight: 400 }}>Statistic</th>
                      {datasets.map((d, i) => <th key={d.id} style={{ padding: '5px 8px', textAlign: 'right', color: PALETTE[i], fontWeight: 500 }}>{d.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {['mean', 'median', 'std', 'min', 'q1', 'q3', 'max', 'skew'].map(stat => (
                      <tr key={stat} style={{ borderBottom: '1px solid var(--bdr)' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--txt3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{stat}</td>
                        {datasets.map(d => (
                          <td key={d.id} style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--txt2)' }}>
                            {fmt(stats[d.id]?.[col1]?.[stat])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
