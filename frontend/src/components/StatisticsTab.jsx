import { useState, useEffect } from 'react'
import { useApp } from '../store'
import { api } from '../api'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)
import { useRef } from 'react'

function HistChart({ datasetId, column }) {
  const canvasRef = useRef()
  const chartRef = useRef()

  useEffect(() => {
    if (!datasetId || !column) return
    api.getHistogram(datasetId, column, 30).then(data => {
      if (chartRef.current) chartRef.current.destroy()
      if (!canvasRef.current) return
      const isHist = data.type === 'histogram'
      chartRef.current = new Chart(canvasRef.current, {
        type: isHist ? 'bar' : 'bar',
        data: {
          labels: data.labels,
          datasets: [{
            label: column,
            data: data.values,
            backgroundColor: isHist ? 'rgba(110,231,183,0.5)' : 'rgba(129,140,248,0.5)',
            borderColor: isHist ? '#6ee7b7' : '#818cf8',
            borderWidth: 1,
            borderRadius: isHist ? 1 : 3,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#5c6172' }, grid: { display: false }, border: { color: '#2a2d35' } },
            y: { ticks: { font: { size: 10 }, color: '#5c6172' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { color: '#2a2d35' } }
          }
        }
      })
    }).catch(() => {})
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [datasetId, column])

  return <div style={{ height: 160 }}><canvas ref={canvasRef} /></div>
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="metric" style={{ borderLeft: accent ? `3px solid ${accent}` : undefined }}>
      <div className="metric-label">{label}</div>
      <div className="metric-val" style={{ fontSize: 16 }}>{value ?? '—'}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

export default function StatisticsTab() {
  const { state } = useApp()
  const [describe, setDescribe] = useState(null)
  const [selectedCol, setSelectedCol] = useState('')
  const [loading, setLoading] = useState(false)

  const ds = state.activeDataset ? state.datasets[state.activeDataset] : null

  useEffect(() => {
    if (!state.activeDataset) return
    setLoading(true)
    api.describeDataset(state.activeDataset)
      .then(d => { setDescribe(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [state.activeDataset])

  useEffect(() => {
    if (describe && !selectedCol) {
      const first = Object.keys(describe).find(c => describe[c].mean !== undefined)
      if (first) setSelectedCol(first)
    }
  }, [describe])

  if (!ds) return <div className="empty-state"><div>Load a dataset first.</div></div>
  if (loading) return <div className="loading"><div className="spinner" /><span>Computing statistics…</span></div>

  const numCols = ds.columns?.filter(c => ds.types?.[c] === 'numeric') || []
  const catCols = ds.columns?.filter(c => ds.types?.[c] === 'categorical') || []
  const col = describe?.[selectedCol]
  const isNum = col?.mean !== undefined

  const fmt = v => v == null ? '—' : typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : v

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Column list */}
      <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid var(--bdr)', overflowY: 'auto', background: 'var(--bg2)', padding: 10 }}>
        <div className="section-title">Numeric</div>
        {numCols.map(c => (
          <div key={c} onClick={() => setSelectedCol(c)} style={{
            padding: '5px 8px', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 12,
            background: selectedCol === c ? 'var(--accent-dim)' : 'transparent',
            color: selectedCol === c ? 'var(--accent)' : 'var(--txt2)',
            marginBottom: 2,
          }}>{c}</div>
        ))}
        {catCols.length > 0 && <>
          <div className="section-title" style={{ marginTop: 12 }}>Categorical</div>
          {catCols.map(c => (
            <div key={c} onClick={() => setSelectedCol(c)} style={{
              padding: '5px 8px', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 12,
              background: selectedCol === c ? 'var(--accent2-dim)' : 'transparent',
              color: selectedCol === c ? 'var(--accent2)' : 'var(--txt2)',
              marginBottom: 2,
            }}>{c}</div>
          ))}
        </>}
      </div>

      {/* Main stats panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {!selectedCol ? (
          <div className="empty-state"><div>Select a variable from the list.</div></div>
        ) : (
          <div className="fade-in">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 300, color: 'var(--txt)' }}>{selectedCol}</h2>
              <span className={`badge ${isNum ? 'green' : 'purple'}`}>{isNum ? 'numeric' : 'categorical'}</span>
              {col?.missing > 0 && <span className="badge red">{col.missing} missing</span>}
            </div>

            {isNum && (
              <>
                <div className="grid-4" style={{ marginBottom: 14 }}>
                  <StatCard label="Mean" value={fmt(col.mean)} accent="var(--accent)" />
                  <StatCard label="Median" value={fmt(col.median)} />
                  <StatCard label="Std Dev" value={fmt(col.std)} />
                  <StatCard label="Count" value={col.count?.toLocaleString()} />
                </div>
                <div className="grid-4" style={{ marginBottom: 14 }}>
                  <StatCard label="Min" value={fmt(col.min)} />
                  <StatCard label="Q1 (25%)" value={fmt(col.q1)} />
                  <StatCard label="Q3 (75%)" value={fmt(col.q3)} />
                  <StatCard label="Max" value={fmt(col.max)} />
                </div>

                <div className="card" style={{ marginBottom: 12 }}>
                  <div className="section-title">Distribution</div>
                  <HistChart datasetId={state.activeDataset} column={selectedCol} />
                </div>

                <div className="card">
                  <div className="section-title">Advanced statistics</div>
                  <div className="stat-row"><span className="stat-name">Variance</span><span className="stat-val">{fmt(col.variance)}</span></div>
                  <div className="stat-row"><span className="stat-name">IQR</span><span className="stat-val">{col.q1 != null && col.q3 != null ? fmt(col.q3 - col.q1) : '—'}</span></div>
                  <div className="stat-row">
                    <span className="stat-name">Skewness</span>
                    <span className="stat-val">
                      {fmt(col.skew)}
                      {col.skew != null && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--txt3)' }}>
                        {Math.abs(col.skew) < 0.5 ? 'symmetric' : col.skew > 0 ? 'right-skewed' : 'left-skewed'}
                      </span>}
                    </span>
                  </div>
                  <div className="stat-row"><span className="stat-name">Kurtosis</span><span className="stat-val">{fmt(col.kurtosis)}</span></div>
                  {col.normality_pvalue != null && (
                    <div className="stat-row">
                      <span className="stat-name">Normality (D'Agostino)</span>
                      <span className="stat-val">
                        p={fmt(col.normality_pvalue)}
                        <span style={{ marginLeft: 6, fontSize: 10, color: col.normality_pvalue > 0.05 ? 'var(--accent)' : 'var(--accent4)' }}>
                          {col.normality_pvalue > 0.05 ? 'likely normal' : 'not normal'}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

            {!isNum && col && (
              <>
                <div className="grid-3" style={{ marginBottom: 14 }}>
                  <StatCard label="Unique values" value={col.unique?.toLocaleString()} />
                  <StatCard label="Count" value={col.count?.toLocaleString()} />
                  <StatCard label="Mode" value={col.mode} />
                </div>
                <div className="card">
                  <div className="section-title">Top values</div>
                  {Object.entries(col.top_values || {}).map(([k, n], i) => {
                    const total = col.count || 1
                    const pct = (n / total * 100).toFixed(1)
                    return (
                      <div key={k} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{k}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--txt2)', marginLeft: 8 }}>{n.toLocaleString()} · {pct}%</span>
                        </div>
                        <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2 }}>
                          <div style={{ width: pct + '%', height: '100%', borderRadius: 2, background: `hsl(${240 + i * 30}, 60%, 65%)` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
