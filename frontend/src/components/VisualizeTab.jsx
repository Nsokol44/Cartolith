import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../store'
import { api } from '../api'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

const CHART_TYPES = [
  { id: 'scatter', label: 'Scatter' },
  { id: 'bar', label: 'Bar' },
  { id: 'line', label: 'Line' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'boxplot', label: 'Box Plot' },
  { id: 'heatmap', label: 'Heatmap' },
]

const PALETTE = ['#6ee7b7','#818cf8','#f59e0b','#fb7185','#38bdf8','#a78bfa','#34d399','#f97316','#e879f9','#60a5fa']

function useChart(canvasRef, config) {
  const chartRef = useRef()
  useEffect(() => {
    if (!canvasRef.current || !config) return
    if (chartRef.current) chartRef.current.destroy()
    chartRef.current = new Chart(canvasRef.current, config)
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [config])
}

function ScatterChart({ data, xCol, yCol, colorCol }) {
  const canvasRef = useRef()
  const [config, setConfig] = useState(null)

  useEffect(() => {
    if (!data?.length) return
    const colorVals = colorCol ? [...new Set(data.map(r => r[colorCol]))] : ['All']
    const datasets = colorVals.map((cv, i) => {
      const pts = colorCol ? data.filter(r => r[colorCol] === cv) : data
      return {
        label: String(cv),
        data: pts.map(r => ({ x: r[xCol], y: r[yCol] })),
        backgroundColor: PALETTE[i % PALETTE.length] + 'aa',
        borderColor: PALETTE[i % PALETTE.length],
        borderWidth: 1, pointRadius: 4, pointHoverRadius: 6,
      }
    })
    setConfig({
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: colorCol ? true : false, labels: { color: '#9499a8', boxWidth: 10, font: { size: 11 } } } },
        scales: {
          x: { title: { display: true, text: xCol, color: '#5c6172', font: { size: 11 } }, ticks: { color: '#5c6172', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { title: { display: true, text: yCol, color: '#5c6172', font: { size: 11 } }, ticks: { color: '#5c6172', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    })
  }, [data, xCol, yCol, colorCol])

  useChart(canvasRef, config)
  return <div style={{ height: 380 }}><canvas ref={canvasRef} /></div>
}

function BarLineChart({ data, xCol, yCol, type, agg }) {
  const canvasRef = useRef()
  const [config, setConfig] = useState(null)

  useEffect(() => {
    if (!data?.length) return
    const labels = data.map(r => String(r[xCol] ?? '')).slice(0, 60)
    const values = data.map(r => parseFloat(r[yCol]) || 0).slice(0, 60)
    setConfig({
      type: type === 'line' ? 'line' : 'bar',
      data: {
        labels,
        datasets: [{
          label: `${agg}(${yCol})`,
          data: values,
          backgroundColor: type === 'line' ? 'rgba(110,231,183,0.1)' : 'rgba(110,231,183,0.5)',
          borderColor: '#6ee7b7',
          borderWidth: type === 'line' ? 2 : 1,
          borderRadius: type === 'bar' ? 3 : 0,
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 3 : 0,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#5c6172', font: { size: 10 }, maxTicksLimit: 20, maxRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: '#5c6172', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    })
  }, [data, xCol, yCol, type, agg])

  useChart(canvasRef, config)
  return <div style={{ height: 320 }}><canvas ref={canvasRef} /></div>
}

function HistogramChart({ data }) {
  const canvasRef = useRef()
  const [config, setConfig] = useState(null)

  useEffect(() => {
    if (!data?.labels) return
    setConfig({
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{ label: 'Count', data: data.values, backgroundColor: 'rgba(110,231,183,0.55)', borderColor: '#6ee7b7', borderWidth: 1, borderRadius: 1 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#5c6172', font: { size: 10 }, maxTicksLimit: 12 }, grid: { display: false } },
          y: { ticks: { color: '#5c6172', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    })
  }, [data])

  useChart(canvasRef, config)
  return <div style={{ height: 300 }}><canvas ref={canvasRef} /></div>
}

function HeatmapChart({ data }) {
  if (!data?.columns?.length) return null
  const cols = data.columns
  const matrix = data.matrix

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 6px', color: 'var(--txt3)' }}></th>
            {cols.map(c => <th key={c} style={{ padding: '4px 6px', color: 'var(--txt2)', fontWeight: 400, whiteSpace: 'nowrap', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {cols.map(row => (
            <tr key={row}>
              <td style={{ padding: '4px 6px', color: 'var(--txt2)', whiteSpace: 'nowrap', fontWeight: 500 }}>{row}</td>
              {cols.map(col => {
                const v = matrix?.[row]?.[col] ?? 0
                const abs = Math.abs(v)
                const bg = v > 0 ? `rgba(110,231,183,${(abs * 0.7).toFixed(2)})` : v < 0 ? `rgba(251,113,133,${(abs * 0.7).toFixed(2)})` : 'transparent'
                return (
                  <td key={col} title={`${row} × ${col}: ${v?.toFixed(3)}`} style={{
                    padding: '5px 8px', textAlign: 'center', background: bg,
                    color: abs > 0.5 ? 'var(--txt)' : 'var(--txt2)',
                    border: '1px solid var(--bdr)',
                  }}>
                    {v?.toFixed(2)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10, color: 'var(--txt3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: 'rgba(110,231,183,0.7)', borderRadius: 2 }} />Positive correlation</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: 'rgba(251,113,133,0.7)', borderRadius: 2 }} />Negative correlation</span>
      </div>
    </div>
  )
}

function BoxPlotViz({ data }) {
  if (!data?.data || !Object.keys(data.data).length) return null
  const entries = Object.entries(data.data)
  const allVals = entries.flatMap(([, d]) => [d.min, d.max]).filter(v => v != null)
  const globalMin = Math.min(...allVals)
  const globalMax = Math.max(...allVals)
  const range = globalMax - globalMin || 1

  const toX = v => ((v - globalMin) / range * 100).toFixed(2) + '%'

  return (
    <div style={{ padding: '8px 0' }}>
      {entries.map(([col, d]) => (
        <div key={col} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--txt2)', marginBottom: 6 }}>{col}</div>
          <div style={{ position: 'relative', height: 32, background: 'var(--bg3)', borderRadius: 4 }}>
            {/* Whiskers */}
            <div style={{ position: 'absolute', top: '50%', left: toX(d.min), right: `calc(100% - ${toX(d.max)})`, height: 2, background: 'var(--bdr2)', transform: 'translateY(-50%)' }} />
            {/* IQR box */}
            <div style={{
              position: 'absolute', top: '15%', bottom: '15%',
              left: toX(d.q1), width: `calc(${toX(d.q3)} - ${toX(d.q1)})`,
              background: 'rgba(110,231,183,0.25)', border: '1px solid var(--accent)',
              borderRadius: 3,
            }} />
            {/* Median */}
            <div style={{ position: 'absolute', top: '10%', bottom: '10%', left: toX(d.median), width: 2, background: 'var(--accent)' }} />
            {/* Mean */}
            {d.mean != null && <div style={{ position: 'absolute', top: '10%', bottom: '10%', left: toX(d.mean), width: 2, background: 'var(--accent3)', opacity: 0.8 }} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--txt3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
            <span>{d.min?.toFixed(2)}</span><span>Q1:{d.q1?.toFixed(2)}</span><span>Med:{d.median?.toFixed(2)}</span><span>Q3:{d.q3?.toFixed(2)}</span><span>{d.max?.toFixed(2)}</span>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--txt3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 2, background: 'var(--accent)' }} />Median</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 2, background: 'var(--accent3)' }} />Mean</span>
      </div>
    </div>
  )
}

export default function VisualizeTab() {
  const { state } = useApp()
  const [chartType, setChartType] = useState('scatter')
  const [xCol, setXCol] = useState('')
  const [yCol, setYCol] = useState('')
  const [colorCol, setColorCol] = useState('')
  const [agg, setAgg] = useState('mean')
  const [bins, setBins] = useState(30)
  const [boxCols, setBoxCols] = useState([])
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const ds = state.activeDataset ? state.datasets[state.activeDataset] : null
  const numCols = ds?.columns?.filter(c => ds.types?.[c] === 'numeric') || []
  const allCols = ds?.columns || []

  useEffect(() => {
    if (numCols.length >= 2 && !xCol) { setXCol(numCols[0]); setYCol(numCols[1]) }
    else if (numCols.length >= 1 && !xCol) { setXCol(numCols[0]) }
  }, [state.activeDataset])

  // Sync selected vars from sidebar
  useEffect(() => {
    const vars = state.selectedVars.filter(v => v.datasetId === state.activeDataset)
    const nv = vars.filter(v => ds?.types?.[v.column] === 'numeric')
    if (nv.length >= 1 && !xCol) setXCol(nv[0].column)
    if (nv.length >= 2 && !yCol) setYCol(nv[1].column)
  }, [state.selectedVars])

  async function drawChart() {
    if (!state.activeDataset) return
    setLoading(true); setError(null)
    try {
      let payload = { dataset_id: state.activeDataset, chart_type: chartType }
      if (chartType === 'scatter') payload = { ...payload, x: xCol, y: yCol, color: colorCol || null }
      else if (chartType === 'bar' || chartType === 'line') payload = { ...payload, x: xCol, y: yCol, agg }
      else if (chartType === 'histogram') payload = { ...payload, x: xCol, bins }
      else if (chartType === 'boxplot') payload = { ...payload, y: boxCols.join(',') }
      else if (chartType === 'heatmap') payload = { ...payload }
      const d = await api.chartData(payload)
      setChartData(d)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  if (!ds) return <div className="empty-state"><div>Load a dataset to start visualizing.</div></div>

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Controls panel */}
      <div style={{ width: 210, flexShrink: 0, borderRight: '1px solid var(--bdr)', padding: 14, overflowY: 'auto', background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="section-title">Chart type</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {CHART_TYPES.map(ct => (
              <button key={ct.id} className={`tag${chartType === ct.id ? ' active' : ''}`}
                onClick={() => { setChartType(ct.id); setChartData(null) }}
                style={{ justifyContent: 'center', borderRadius: 'var(--r)', padding: '5px 0' }}>
                {ct.label}
              </button>
            ))}
          </div>
        </div>

        {(chartType === 'scatter' || chartType === 'bar' || chartType === 'line' || chartType === 'histogram') && (
          <div>
            <label className="field-label">X axis</label>
            <select value={xCol} onChange={e => setXCol(e.target.value)}>
              <option value="">Select…</option>
              {(chartType === 'scatter' || chartType === 'histogram' ? numCols : allCols).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {(chartType === 'scatter' || chartType === 'bar' || chartType === 'line') && (
          <div>
            <label className="field-label">Y axis</label>
            <select value={yCol} onChange={e => setYCol(e.target.value)}>
              <option value="">Select…</option>
              {numCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {chartType === 'scatter' && (
          <div>
            <label className="field-label">Color by (optional)</label>
            <select value={colorCol} onChange={e => setColorCol(e.target.value)}>
              <option value="">None</option>
              {allCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {(chartType === 'bar' || chartType === 'line') && (
          <div>
            <label className="field-label">Aggregation</label>
            <select value={agg} onChange={e => setAgg(e.target.value)}>
              {['mean', 'sum', 'count', 'median', 'min', 'max'].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}

        {chartType === 'histogram' && (
          <div>
            <label className="field-label">Bins: {bins}</label>
            <input type="range" min={5} max={100} step={5} value={bins} onChange={e => setBins(+e.target.value)} style={{ width: '100%' }} />
          </div>
        )}

        {chartType === 'boxplot' && (
          <div>
            <label className="field-label">Columns (pick 1–6)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
              {numCols.map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--txt2)' }}>
                  <input type="checkbox" checked={boxCols.includes(c)}
                    onChange={e => setBoxCols(bs => e.target.checked ? [...bs.slice(-5), c] : bs.filter(b => b !== c))} />
                  {c}
                </label>
              ))}
            </div>
          </div>
        )}

        <button className="btn primary" onClick={drawChart} disabled={loading}>
          {loading ? <><div className="spinner" />Drawing…</> : 'Draw chart'}
        </button>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}

        {!chartData && !loading && (
          <div className="empty-state">
            <div className="icon">◉</div>
            <div>Configure the chart options and click <strong>Draw chart</strong></div>
          </div>
        )}

        {loading && <div className="loading"><div className="spinner" /><span>Fetching data from Python…</span></div>}

        {chartData && !loading && (
          <div className="fade-in">
            <div style={{ fontSize: 13, color: 'var(--txt2)', marginBottom: 14, fontFamily: 'var(--font-display)', fontWeight: 300 }}>
              {chartType === 'scatter' && xCol && yCol && <span>{xCol} <span style={{ color: 'var(--txt3)' }}>vs</span> {yCol}</span>}
              {chartType === 'bar' && <span>{agg}({yCol}) <span style={{ color: 'var(--txt3)' }}>by</span> {xCol}</span>}
              {chartType === 'line' && <span>{yCol} <span style={{ color: 'var(--txt3)' }}>over</span> {xCol}</span>}
              {chartType === 'histogram' && <span>Distribution of {xCol}</span>}
              {chartType === 'boxplot' && <span>Box plots</span>}
              {chartType === 'heatmap' && <span>Correlation heatmap</span>}
            </div>

            {chartType === 'scatter' && chartData.data && <ScatterChart data={chartData.data} xCol={xCol} yCol={yCol} colorCol={colorCol} />}
            {(chartType === 'bar' || chartType === 'line') && chartData.data && <BarLineChart data={chartData.data} xCol={xCol} yCol={yCol} type={chartType} agg={agg} />}
            {chartType === 'histogram' && <HistogramChart data={chartData} />}
            {chartType === 'heatmap' && <HeatmapChart data={chartData} />}
            {chartType === 'boxplot' && <BoxPlotViz data={chartData} />}
          </div>
        )}
      </div>
    </div>
  )
}
