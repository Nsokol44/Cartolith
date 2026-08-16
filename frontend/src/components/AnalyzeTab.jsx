import { useState } from 'react'
import { useApp } from '../store'
import { api } from '../api'
import ExportPanel from './ExportPanel'

const ANALYSES = [
  { id: 'describe', label: 'Descriptive Stats', desc: 'Full summary statistics for selected variables', minVars: 1, allowCross: true },
  { id: 'correlation', label: 'Correlation Matrix', desc: 'Pearson/Spearman correlations with p-values', minVars: 2, allowCross: true },
  { id: 'regression', label: 'Linear Regression', desc: 'OLS regression with diagnostics (statsmodels)', minVars: 2, allowCross: true },
  { id: 'ttest', label: 'T-Test', desc: 'One-sample or two-sample t-test (scipy)', minVars: 1, allowCross: true },
  { id: 'anova', label: 'ANOVA', desc: 'One-way analysis of variance (scipy)', minVars: 2, allowCross: true },
  { id: 'chi2', label: 'Chi-Square', desc: 'Test of independence between categorical variables', minVars: 2, allowCross: false },
  { id: 'normality', label: 'Normality Tests', desc: 'Shapiro-Wilk and D\'Agostino K² tests', minVars: 1, allowCross: true },
  { id: 'pca', label: 'PCA', desc: 'Principal component analysis (scikit-learn)', minVars: 2, allowCross: true },
  { id: 'cluster', label: 'K-Means Clustering', desc: 'Cluster data points (scikit-learn)', minVars: 2, allowCross: true },
  { id: 'timeseries', label: 'Time Series Decomp.', desc: 'Trend/seasonal/residual decomposition (statsmodels)', minVars: 1, allowCross: false },
  { id: 'join', label: 'Join Datasets', desc: 'Merge two datasets on a shared key', minVars: 0, allowCross: false, special: 'join' },
]

function fmt(v) {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return String(v)
}

function pSig(p) {
  if (p == null) return ''
  if (p < 0.001) return '***'
  if (p < 0.01) return '**'
  if (p < 0.05) return '*'
  return ''
}

function ResultView({ result, analysisType }) {
  if (!result) return null
  if (result.error) return <div className="error-box">{result.error}</div>

  if (analysisType === 'describe') {
    return (
      <div className="fade-in">
        {Object.entries(result.results || {}).map(([varName, stats]) => (
          <div key={varName} className="card" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', marginBottom: 10, fontFamily: 'var(--font-display)' }}>{varName}</div>
            {stats.mean !== undefined ? (
              <div className="grid-3">
                {[['Mean', stats.mean], ['Median', stats.median], ['Std Dev', stats.std], ['Min', stats.min], ['Max', stats.max], ['Skew', stats.skew]].map(([l, v]) => (
                  <div key={l} className="metric"><div className="metric-label">{l}</div><div className="metric-val" style={{ fontSize: 15 }}>{fmt(v)}</div></div>
                ))}
              </div>
            ) : (
              <div>
                <div className="stat-row"><span className="stat-name">Unique</span><span className="stat-val">{stats.unique}</span></div>
                <div className="stat-row"><span className="stat-name">Mode</span><span className="stat-val">{stats.mode}</span></div>
                {Object.entries(stats.top_values || {}).slice(0, 5).map(([k, n]) => (
                  <div key={k} className="stat-row"><span className="stat-name" style={{ color: 'var(--txt)' }}>{k}</span><span className="stat-val">{n}</span></div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (analysisType === 'correlation') {
    const cols = Object.keys(result.matrix || {})
    return (
      <div className="fade-in">
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--txt2)' }}>
          Method: <strong style={{ color: 'var(--txt)' }}>{result.method}</strong> · n = <strong style={{ color: 'var(--txt)' }}>{result.n}</strong>
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ padding: '5px 8px', color: 'var(--txt3)', fontWeight: 400 }}></th>
                {cols.map(c => <th key={c} style={{ padding: '5px 8px', color: 'var(--txt2)', fontWeight: 500, whiteSpace: 'nowrap' }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {cols.map(row => (
                <tr key={row}>
                  <td style={{ padding: '5px 8px', color: 'var(--txt2)', fontWeight: 500, whiteSpace: 'nowrap' }}>{row}</td>
                  {cols.map(col => {
                    const v = result.matrix?.[row]?.[col] ?? 0
                    const p = result.pvalues?.[row]?.[col]
                    const abs = Math.abs(v)
                    const bg = row === col ? 'var(--bg3)' : v > 0 ? `rgba(110,231,183,${(abs * 0.6).toFixed(2)})` : `rgba(251,113,133,${(abs * 0.6).toFixed(2)})`
                    return (
                      <td key={col} style={{ padding: '6px 10px', textAlign: 'center', background: bg, border: '1px solid var(--bdr)', color: row === col ? 'var(--txt3)' : 'var(--txt)' }}>
                        {v?.toFixed(3)}{p != null && row !== col && <sup style={{ fontSize: 8, color: 'var(--accent3)', marginLeft: 1 }}>{pSig(p)}</sup>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 6 }}>* p&lt;0.05 &nbsp; ** p&lt;0.01 &nbsp; *** p&lt;0.001</div>
        </div>
      </div>
    )
  }

  if (analysisType === 'regression') {
    return (
      <div className="fade-in">
        <div className="grid-4" style={{ marginBottom: 12 }}>
          <div className="metric"><div className="metric-label">R²</div><div className="metric-val">{fmt(result.r_squared)}</div></div>
          <div className="metric"><div className="metric-label">Adj. R²</div><div className="metric-val">{fmt(result.adj_r_squared)}</div></div>
          <div className="metric"><div className="metric-label">F-stat</div><div className="metric-val">{fmt(result.f_statistic)}</div></div>
          <div className="metric"><div className="metric-label">n</div><div className="metric-val">{result.n}</div></div>
        </div>
        {result.durbin_watson != null && (
          <div className="grid-3" style={{ marginBottom: 12 }}>
            <div className="metric"><div className="metric-label">AIC</div><div className="metric-val" style={{ fontSize: 14 }}>{fmt(result.aic)}</div></div>
            <div className="metric"><div className="metric-label">BIC</div><div className="metric-val" style={{ fontSize: 14 }}>{fmt(result.bic)}</div></div>
            <div className="metric"><div className="metric-label">Durbin-Watson</div><div className="metric-val" style={{ fontSize: 14 }}>{fmt(result.durbin_watson)}</div></div>
          </div>
        )}
        <div className="card">
          <div className="section-title">Coefficients</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr>{['Variable', 'Coef', 'Std Err', 't', 'P>|t|', '[0.025', '0.975]'].map(h => (
                <th key={h} style={{ padding: '5px 8px', textAlign: h === 'Variable' ? 'left' : 'right', color: 'var(--txt3)', fontWeight: 400, borderBottom: '1px solid var(--bdr2)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {Object.entries(result.coefficients || {}).map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--bdr)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--txt)' }}>{k}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--accent)' }}>{fmt(v.coef)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--txt2)' }}>{fmt(v.std_err)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--txt2)' }}>{fmt(v.t_stat)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: v.p_value < 0.05 ? 'var(--accent3)' : 'var(--txt2)' }}>
                    {fmt(v.p_value)}{pSig(v.p_value)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--txt3)' }}>{fmt(v.ci_lower)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--txt3)' }}>{fmt(v.ci_upper)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.breusch_pagan_pvalue != null && (
          <div className="result-box">
            <strong>Diagnostics:</strong> Breusch-Pagan test for heteroskedasticity: p = {fmt(result.breusch_pagan_pvalue)}
            {result.breusch_pagan_pvalue < 0.05 ? ' — evidence of heteroskedasticity.' : ' — no significant heteroskedasticity.'}
          </div>
        )}
        {result.note && <div className="result-box">{result.note}</div>}
      </div>
    )
  }

  if (analysisType === 'ttest' || analysisType === 'anova') {
    const sig = result.significant
    return (
      <div className="fade-in">
        <div className="grid-3" style={{ marginBottom: 12 }}>
          <div className="metric"><div className="metric-label">{result.f_statistic != null ? 'F-statistic' : 't-statistic'}</div><div className="metric-val">{fmt(result.f_statistic ?? result.statistic)}</div></div>
          <div className="metric"><div className="metric-label">p-value</div><div className="metric-val" style={{ color: sig ? 'var(--accent)' : 'var(--txt)' }}>{fmt(result.pvalue)}</div></div>
          <div className="metric"><div className="metric-label">Result</div><div className="metric-val" style={{ fontSize: 13 }}>{sig ? 'Significant' : 'Not significant'}</div><div className="metric-sub">α = 0.05</div></div>
        </div>
        {result.groups && (
          <div className="card">
            <div className="section-title">Group statistics</div>
            {result.groups.map(g => (
              <div key={g.variable} className="stat-row">
                <span className="stat-name">{g.variable}</span>
                <span className="stat-val">n={g.n} · mean={fmt(g.mean)} · sd={fmt(g.std)}</span>
              </div>
            ))}
            {result.group1 && (
              <>
                <div className="stat-row"><span className="stat-name">Group 1</span><span className="stat-val">n={result.group1.n} · mean={fmt(result.group1.mean)} · sd={fmt(result.group1.std)}</span></div>
                {result.group2 && <div className="stat-row"><span className="stat-name">Group 2</span><span className="stat-val">n={result.group2.n} · mean={fmt(result.group2.mean)} · sd={fmt(result.group2.std)}</span></div>}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  if (analysisType === 'normality') {
    return (
      <div className="fade-in">
        {Object.entries(result.results || {}).map(([v, r]) => (
          <div key={v} className="card" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, fontFamily: 'var(--font-display)', color: 'var(--txt)' }}>{v}</div>
            <div className="stat-row">
              <span className="stat-name">Shapiro-Wilk</span>
              <span className="stat-val">
                W={fmt(r.shapiro_wilk?.statistic)} · p={fmt(r.shapiro_wilk?.pvalue)}
                <span style={{ marginLeft: 8, color: r.shapiro_wilk?.normal ? 'var(--accent)' : 'var(--accent4)', fontSize: 10 }}>
                  {r.shapiro_wilk?.normal ? 'normal' : 'not normal'}
                </span>
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-name">D'Agostino K²</span>
              <span className="stat-val">
                K²={fmt(r.dagostino_k2?.statistic)} · p={fmt(r.dagostino_k2?.pvalue)}
                <span style={{ marginLeft: 8, color: r.dagostino_k2?.normal ? 'var(--accent)' : 'var(--accent4)', fontSize: 10 }}>
                  {r.dagostino_k2?.normal ? 'normal' : 'not normal'}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (analysisType === 'pca') {
    const evr = result.explained_variance_ratio || []
    return (
      <div className="fade-in">
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="section-title">Explained variance by component</div>
          {evr.map((v, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt2)', marginBottom: 2 }}>
                <span>PC{i + 1}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{(v * 100).toFixed(1)}% (cumulative: {((result.cumulative_variance?.[i] || 0) * 100).toFixed(1)}%)</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3 }}>
                <div style={{ width: (v * 100).toFixed(1) + '%', height: '100%', borderRadius: 3, background: `hsl(${160 + i * 40}, 60%, 55%)` }} />
              </div>
            </div>
          ))}
        </div>
        {result.loadings && (
          <div className="card">
            <div className="section-title">Variable loadings</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr>
                  <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--txt3)', fontWeight: 400 }}>Variable</th>
                  {evr.map((_, i) => <th key={i} style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--txt3)', fontWeight: 400 }}>PC{i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.loadings).map(([v, loads]) => (
                  <tr key={v} style={{ borderBottom: '1px solid var(--bdr)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--txt)' }}>{v}</td>
                    {loads.map((l, i) => (
                      <td key={i} style={{ padding: '4px 8px', textAlign: 'right', color: Math.abs(l) > 0.5 ? 'var(--accent)' : 'var(--txt2)' }}>{l?.toFixed(3)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  if (analysisType === 'cluster') {
    return (
      <div className="fade-in">
        <div className="grid-3" style={{ marginBottom: 12 }}>
          <div className="metric"><div className="metric-label">K</div><div className="metric-val">{result.k}</div></div>
          <div className="metric"><div className="metric-label">Inertia</div><div className="metric-val" style={{ fontSize: 14 }}>{fmt(result.inertia)}</div></div>
          <div className="metric"><div className="metric-label">Points</div><div className="metric-val">{result.labels?.length?.toLocaleString()}</div></div>
        </div>
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="section-title">Cluster sizes</div>
          {Object.entries(result.counts || {}).map(([k, n]) => (
            <div key={k} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt2)', marginBottom: 2 }}>
                <span>Cluster {parseInt(k) + 1}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{n} pts ({result.labels ? (n / result.labels.length * 100).toFixed(1) : 0}%)</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3 }}>
                <div style={{ width: result.labels ? (n / result.labels.length * 100).toFixed(1) + '%' : '0%', height: '100%', borderRadius: 3, background: `hsl(${160 + parseInt(k) * 50}, 55%, 55%)` }} />
              </div>
            </div>
          ))}
        </div>
        {result.centers && (
          <div className="card">
            <div className="section-title">Cluster centers</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr>
                  <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--txt3)', fontWeight: 400 }}>Cluster</th>
                  {Object.keys(result.centers[0] || {}).map(k => <th key={k} style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--txt3)', fontWeight: 400 }}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.centers.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--bdr)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--txt)' }}>Cluster {i + 1}</td>
                    {Object.values(c).map((v, j) => <td key={j} style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--txt2)' }}>{fmt(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  if (analysisType === 'join') {
    return (
      <div className="fade-in">
        <div className="result-box" style={{ marginBottom: 12 }}>
          <strong>Join successful!</strong><br />
          Created dataset: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{result.new_dataset_id}</code><br />
          Shape: {result.shape?.[0]?.toLocaleString()} rows × {result.shape?.[1]} columns
        </div>
        <ExportPanel
          datasetId={result.new_dataset_id}
          datasetName={result.new_dataset_id}
          shape={result.shape}
        />
      </div>
    )
  }

  // Generic fallback
  return <pre style={{ fontSize: 11, color: 'var(--txt2)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', lineHeight: 1.6, background: 'var(--bg3)', padding: 12, borderRadius: 'var(--r)' }}>{JSON.stringify(result, null, 2)}</pre>
}

export default function AnalyzeTab() {
  const { state, dispatch } = useApp()
  const [analysisType, setAnalysisType] = useState('describe')
  const [varMode, setVarMode] = useState('sidebar') // 'sidebar' | 'manual'
  const [manualVars, setManualVars] = useState([])
  const [params, setParams] = useState({})
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [depVar, setDepVar] = useState('')

  const ds = state.activeDataset ? state.datasets[state.activeDataset] : null
  const datasets = Object.values(state.datasets)
  const analysis = ANALYSES.find(a => a.id === analysisType)
  const numCols = ds?.columns?.filter(c => ds.types?.[c] === 'numeric') || []

  const sidebarVars = state.selectedVars
  const effectiveVars = varMode === 'sidebar' ? sidebarVars : manualVars

  async function runAnalysis() {
    if (!state.activeDataset && analysisType !== 'join') return
    setLoading(true); setError(null); setResult(null)

    try {
      const variables = effectiveVars.map(v =>
        v.datasetId !== state.activeDataset ? `${v.datasetId}::${v.column}` : v.column
      )
      const datasetIds = [...new Set(effectiveVars.map(v => v.datasetId))]
      if (datasetIds.length === 0 && state.activeDataset) datasetIds.push(state.activeDataset)

      const p = { ...params }
      if (analysisType === 'regression' && depVar) p.dependent = depVar

      const res = await api.analyze({
        dataset_ids: datasetIds,
        analysis_type: analysisType,
        variables,
        params: p,
      })

      if (analysisType === 'join' && res.new_dataset_id) {
        dispatch({ type: 'ADD_DATASET', dataset: { id: res.new_dataset_id, name: res.new_dataset_id, columns: res.columns, types: res.types, shape: res.shape, preview: res.preview } })
      }

      setResult(res)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  if (!ds && analysisType !== 'join') return <div className="empty-state"><div>Load a dataset to run analyses.</div></div>

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Analysis selector */}
      <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--bdr)', padding: 12, overflowY: 'auto', background: 'var(--bg2)' }}>
        <div className="section-title">Analysis type</div>
        {ANALYSES.map(a => (
          <div
            key={a.id}
            onClick={() => { setAnalysisType(a.id); setResult(null); setError(null) }}
            style={{
              padding: '7px 9px', borderRadius: 'var(--r)', cursor: 'pointer', marginBottom: 3,
              background: analysisType === a.id ? 'var(--accent2-dim)' : 'transparent',
              border: `1px solid ${analysisType === a.id ? 'rgba(129,140,248,0.3)' : 'transparent'}`,
            }}
          >
            <div style={{ fontSize: 12, color: analysisType === a.id ? 'var(--accent2)' : 'var(--txt)', fontWeight: 500 }}>{a.label}</div>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2, lineHeight: 1.4 }}>{a.desc}</div>
          </div>
        ))}
      </div>

      {/* Config + results */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Config bar */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bdr)', background: 'var(--bg2)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Variable source */}
            {analysisType !== 'join' && (
              <div>
                <label className="field-label">Variables</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className={`tag${varMode === 'sidebar' ? ' active' : ''}`} onClick={() => setVarMode('sidebar')}>From sidebar ({sidebarVars.length})</span>
                  <span className={`tag${varMode === 'manual' ? ' active purple' : ''}`} onClick={() => setVarMode('manual')}>Manual select</span>
                </div>
                {varMode === 'manual' && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto', background: 'var(--bg3)', padding: 6, borderRadius: 'var(--r)', border: '1px solid var(--bdr)' }}>
                    {datasets.flatMap(d => (d.columns || []).filter(c => d.types?.[c] === 'numeric').map(c => ({
                      datasetId: d.id, column: c, key: `${d.id}::${c}`
                    }))).map(v => (
                      <label key={v.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', color: 'var(--txt2)' }}>
                        <input type="checkbox"
                          checked={manualVars.some(m => m.key === v.key)}
                          onChange={e => setManualVars(mv => e.target.checked ? [...mv, v] : mv.filter(m => m.key !== v.key))} />
                        <span style={{ color: 'var(--txt3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{v.datasetId.split('.')[0].slice(0, 10)}</span>
                        <span>{v.column}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Analysis-specific params */}
            {analysisType === 'correlation' && (
              <div>
                <label className="field-label">Method</label>
                <select value={params.method || 'pearson'} onChange={e => setParams(p => ({ ...p, method: e.target.value }))} style={{ width: 120 }}>
                  <option value="pearson">Pearson</option>
                  <option value="spearman">Spearman</option>
                  <option value="kendall">Kendall</option>
                </select>
              </div>
            )}

            {analysisType === 'regression' && (
              <div>
                <label className="field-label">Dependent variable</label>
                <select value={depVar} onChange={e => setDepVar(e.target.value)} style={{ width: 140 }}>
                  <option value="">Last selected</option>
                  {numCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {analysisType === 'cluster' && (
              <div>
                <label className="field-label">K (clusters)</label>
                <input type="number" min={2} max={12} value={params.k || 3} onChange={e => setParams(p => ({ ...p, k: parseInt(e.target.value) }))} style={{ width: 70 }} />
              </div>
            )}

            {analysisType === 'pca' && (
              <div>
                <label className="field-label">Components</label>
                <input type="number" min={2} max={10} value={params.n_components || 3} onChange={e => setParams(p => ({ ...p, n_components: parseInt(e.target.value) }))} style={{ width: 70 }} />
              </div>
            )}

            {analysisType === 'join' && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <label className="field-label">Left dataset</label>
                  <select value={params.left_ds || ''} onChange={e => setParams(p => ({ ...p, left_ds: e.target.value }))} style={{ width: 160 }}>
                    {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Right dataset</label>
                  <select value={params.right_ds || ''} onChange={e => setParams(p => ({ ...p, right_ds: e.target.value }))} style={{ width: 160 }}>
                    {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Join key</label>
                  <input type="text" placeholder="shared column name" value={params.left_key || ''} onChange={e => setParams(p => ({ ...p, left_key: e.target.value }))} style={{ width: 160 }} />
                </div>
                <div>
                  <label className="field-label">Join type</label>
                  <select value={params.how || 'inner'} onChange={e => setParams(p => ({ ...p, how: e.target.value }))} style={{ width: 100 }}>
                    {['inner', 'left', 'right', 'outer'].map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
              <button className="btn primary" onClick={runAnalysis} disabled={loading}>
                {loading ? <><div className="spinner" />Running…</> : `Run ${analysis?.label || ''}`}
              </button>
            </div>
          </div>

          {effectiveVars.length > 0 && analysisType !== 'join' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--txt3)' }}>Variables:</span>
              {effectiveVars.map(v => (
                <span key={v.key} className="badge gray">{v.datasetId !== state.activeDataset ? `${v.datasetId.split('.')[0].slice(0,8)}::` : ''}{v.column}</span>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
          {loading && <div className="loading"><div className="spinner" /><span>Running Python analysis…</span></div>}
          {!result && !loading && !error && (
            <div className="empty-state">
              <div className="icon">⊕</div>
              <div>Select variables and click <strong>Run</strong> to see results</div>
              <div style={{ marginTop: 8, fontSize: 11 }}>
                Variables can be selected from the left sidebar or manually above.<br />
                Cross-dataset analysis is supported — select variables from multiple datasets.
              </div>
            </div>
          )}
          {result && !loading && <ResultView result={result} analysisType={analysisType} />}
        </div>
      </div>
    </div>
  )
}
