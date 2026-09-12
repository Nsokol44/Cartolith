import { useState, useEffect } from 'react'
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

  // ── Machine learning ──
  { id: 'decision_tree', label: 'Decision Tree', desc: 'Readable if/then rules; auto-detects classify vs predict', minVars: 2, allowCross: true, group: 'Machine learning' },
  { id: 'random_forest', label: 'Random Forest', desc: 'Many trees combined, with variable importance', minVars: 2, allowCross: true, group: 'Machine learning' },
  { id: 'neural_network', label: 'Neural Network', desc: 'Multi-layer perceptron for non-linear patterns', minVars: 2, allowCross: true, group: 'Machine learning' },

  // ── Spatial statistics (need coordinates) ──
  { id: 'morans_i', label: "Moran's I", desc: 'Global test: is this variable clustered in space?', minVars: 1, allowCross: false, group: 'Spatial statistics' },
  { id: 'gearys_c', label: "Geary's C", desc: 'Clustering test, more sensitive to local contrast', minVars: 1, allowCross: false, group: 'Spatial statistics' },
  { id: 'local_morans', label: "Local Moran's I (LISA)", desc: 'Where the clusters and spatial outliers actually are', minVars: 1, allowCross: false, group: 'Spatial statistics' },
  { id: 'gwr', label: 'Geographically Weighted Regression', desc: 'A separate regression at every location', minVars: 2, allowCross: false, group: 'Spatial statistics' },
  { id: 'spatial_lag', label: 'Spatial Lag Model', desc: 'Regression accounting for spillover between neighbours', minVars: 2, allowCross: false, group: 'Spatial statistics' },
]

const GROUPS = [null, 'Machine learning', 'Spatial statistics']

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

// ── advanced-method result views ────────────────────────────────────────────
function Interpretation({ text }) {
  if (!text) return null
  // Every advanced method returns a plain-language reading of its own output.
  // Surfacing it first is the point: the numbers mean nothing to a student who
  // does not already know how to read them.
  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid var(--accent2)' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.7px',
                    color: 'var(--txt3)', marginBottom: 6 }}>What this means</div>
      <div style={{ fontSize: 12.5, color: 'var(--txt)', lineHeight: 1.65 }}>{text}</div>
    </div>
  )
}

function Metrics({ items }) {
  return (
    <div className="grid-3" style={{ marginBottom: 12 }}>
      {items.filter(([, v]) => v != null).map(([label, v, sub]) => (
        <div key={label} className="metric">
          <div className="metric-label">{label}</div>
          <div className="metric-val">{typeof v === 'number' ? fmt(v) : v}</div>
          {sub && <div className="metric-sub">{sub}</div>}
        </div>
      ))}
    </div>
  )
}

function ImportanceBars({ importances }) {
  const entries = Object.entries(importances || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0))
  const max = Math.max(...entries.map(e => e[1] || 0), 0.0001)
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 9 }}>Variable importance</div>
      {entries.map(([name, v]) => (
        <div key={name} style={{ marginBottom: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
            <span style={{ color: 'var(--txt2)' }}>{name}</span>
            <span style={{ color: 'var(--txt3)', fontFamily: 'var(--font-mono)' }}>{((v || 0) * 100).toFixed(1)}%</span>
          </div>
          <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${((v || 0) / max) * 100}%`, height: '100%', background: 'var(--accent2)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

const LISA_COLORS = { HH: '#ef4444', LL: '#3b82f6', HL: '#f59e0b', LH: '#22d3ee', ns: '#475569' }
const LISA_LABELS = {
  HH: 'High-High (hot spot)', LL: 'Low-Low (cold spot)',
  HL: 'High-Low (outlier)', LH: 'Low-High (outlier)', ns: 'Not significant',
}

function AdvancedResult({ result }) {
  const t = result.type

  if (t === 'morans_i' || t === 'gearys_c') {
    const stat = t === 'morans_i' ? result.I : result.C
    const expected = t === 'morans_i' ? result.expected_I : result.expected_C
    return (
      <div className="fade-in">
        <Interpretation text={result.interpretation} />
        <Metrics items={[
          [t === 'morans_i' ? "Moran's I" : "Geary's C", stat],
          ['Expected (no pattern)', expected],
          ['p-value', result.p_value, result.p_value < 0.05 ? 'significant' : 'not significant'],
          ['n', result.n],
          ['Permutations', result.permutations],
        ]} />
      </div>
    )
  }

  if (t === 'local_morans') {
    const total = Object.values(result.counts || {}).reduce((a, b) => a + b, 0) || 1
    return (
      <div className="fade-in">
        <Interpretation text={result.interpretation} />
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 10 }}>Cluster types</div>
          {Object.entries(LISA_LABELS).map(([k, label]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: LISA_COLORS[k], flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: 'var(--txt2)', flex: 1 }}>{label}</span>
              <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--txt)' }}>
                {result.counts?.[k] ?? 0}
              </span>
              <span style={{ fontSize: 10, color: 'var(--txt3)', width: 44, textAlign: 'right' }}>
                {(((result.counts?.[k] ?? 0) / total) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
        {result.truncated && (
          <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Showing the first {result.locations?.length} locations; the dataset is larger.
          </div>
        )}
      </div>
    )
  }

  if (t === 'gwr') {
    return (
      <div className="fade-in">
        <Interpretation text={result.interpretation} />
        <Metrics items={[
          ['Global R²', result.global_r_squared],
          ['Mean local R²', result.local_r2_mean],
          ['Bandwidth', result.bandwidth],
          ['n', result.n],
        ]} />
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 9 }}>
            How each coefficient varies across space
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ color: 'var(--txt3)' }}>
                  {['Variable', 'Min', 'Mean', 'Max', 'Std', 'Reverses?'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Variable' ? 'left' : 'right',
                                         padding: '5px 8px', borderBottom: '1px solid var(--bdr2)', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.coefficient_summary || {}).map(([name, v]) => (
                  <tr key={name} style={{ borderBottom: '1px solid var(--bdr)' }}>
                    <td style={{ padding: '5px 8px', color: 'var(--txt)' }}>{name}</td>
                    {['min', 'mean', 'max', 'std'].map(k => (
                      <td key={k} style={{ padding: '5px 8px', textAlign: 'right',
                                           fontFamily: 'var(--font-mono)', color: 'var(--txt2)' }}>{fmt(v[k])}</td>
                    ))}
                    <td style={{ padding: '5px 8px', textAlign: 'right',
                                 color: v.changes_sign ? 'var(--accent3)' : 'var(--txt3)' }}>
                      {v.changes_sign ? 'yes' : 'no'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  if (t === 'spatial_lag') {
    return (
      <div className="fade-in">
        <Interpretation text={result.interpretation} />
        <Metrics items={[
          ['ρ (spatial lag)', result.rho, 'neighbour spillover'],
          ['ρ t-stat', result.rho_t_stat],
          ['Pseudo R²', result.pseudo_r_squared],
          ['Plain OLS R²', result.ols_r_squared, 'for comparison'],
          ['n', result.n],
        ]} />
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 9 }}>
            Coefficients — spatial model vs plain OLS
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ color: 'var(--txt3)' }}>
                {['Variable', 'Spatial', 'Std err', 't', 'OLS'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Variable' ? 'left' : 'right',
                                       padding: '5px 8px', borderBottom: '1px solid var(--bdr2)', fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.coefficients || {}).map(([name, c]) => (
                <tr key={name} style={{ borderBottom: '1px solid var(--bdr)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--txt)' }}>{name}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--txt)' }}>{fmt(c.coef)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--txt3)' }}>{fmt(c.std_err)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--txt2)' }}>{fmt(c.t_stat)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--txt3)' }}>{fmt(result.ols_coefficients?.[name])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 8, lineHeight: 1.5 }}>
            Where the two columns diverge, plain OLS was crediting the predictor with an effect that
            was really spillover from neighbouring places.
          </div>
        </div>
      </div>
    )
  }

  if (t === 'decision_tree' || t === 'random_forest' || t === 'neural_network') {
    const clf = result.task === 'classification'
    return (
      <div className="fade-in">
        <Interpretation text={result.interpretation} />
        <Metrics items={clf
          ? [['Accuracy', result.accuracy != null ? `${(result.accuracy * 100).toFixed(1)}%` : null],
             ['Baseline', result.baseline_accuracy != null ? `${(result.baseline_accuracy * 100).toFixed(1)}%` : null, 'always guess commonest'],
             ['Target', result.target], ['Train / test', `${result.n_train} / ${result.n_test}`]]
          : [['R² (test)', result.r_squared], ['MAE', result.mae], ['RMSE', result.rmse],
             ['Target', result.target], ['Train / test', `${result.n_train} / ${result.n_test}`]]} />

        {result.importances && <ImportanceBars importances={result.importances} />}

        {result.confusion_matrix && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 8 }}>Confusion matrix</div>
            <table style={{ borderCollapse: 'collapse', fontSize: 11.5 }}>
              <tbody>
                {result.confusion_matrix.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px', color: 'var(--txt3)', fontSize: 10 }}>
                      actual {result.classes?.[i] ?? i}
                    </td>
                    {row.map((v, j) => (
                      <td key={j} style={{ padding: '4px 10px', textAlign: 'center', fontFamily: 'var(--font-mono)',
                                           color: i === j ? 'var(--accent2)' : 'var(--txt2)',
                                           background: i === j ? 'rgba(129,140,248,0.08)' : 'transparent' }}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 6 }}>
              Rows are the true class, columns the predicted one. The diagonal is correct predictions.
            </div>
          </div>
        )}

        {result.rules && (
          <div className="card">
            <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 8 }}>
              Learned rules <span style={{ color: 'var(--txt3)', fontSize: 10.5 }}>(top levels)</span>
            </div>
            <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.5,
                          color: 'var(--txt2)', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{result.rules}</pre>
          </div>
        )}

        {result.converged === false && (
          <div className="result-box" style={{ marginTop: 10 }}>
            Training hit its iteration limit without converging — the numbers above are provisional.
          </div>
        )}
      </div>
    )
  }

  return null
}

function ResultView({ result, analysisType }) {
  if (!result) return null
  if (result.error) return <div className="error-box">{result.error}</div>

  const ADVANCED = ['morans_i','gearys_c','local_morans','gwr','spatial_lag',
                    'decision_tree','random_forest','neural_network']
  if (ADVANCED.includes(result.type)) return <AdvancedResult result={result} />

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
  // Per-analysis eligibility from the backend, so the UI can explain what will
  // and will not run BEFORE the user clicks, instead of after it fails.
  const [caps, setCaps] = useState(null)

  const ds = state.activeDataset ? state.datasets[state.activeDataset] : null
  const datasets = Object.values(state.datasets)
  const analysis = ANALYSES.find(a => a.id === analysisType)
  const numCols = ds?.columns?.filter(c => ds.types?.[c] === 'numeric') || []

  const sidebarVars = state.selectedVars
  const effectiveVars = varMode === 'sidebar' ? sidebarVars : manualVars

  // Ask the backend what is runnable on the current selection. Re-runs
  // whenever the variables or dataset change.
  useEffect(() => {
    const variables = effectiveVars.map(v =>
      v.datasetId !== state.activeDataset ? `${v.datasetId}::${v.column}` : v.column
    )
    const datasetIds = [...new Set(effectiveVars.map(v => v.datasetId))]
    if (datasetIds.length === 0 && state.activeDataset) datasetIds.push(state.activeDataset)
    if (!datasetIds.length) { setCaps(null); return }

    let cancelled = false
    api.analysisCapabilities({ dataset_ids: datasetIds, variables })
      .then(r => { if (!cancelled) setCaps(r) })
      .catch(() => { if (!cancelled) setCaps(null) })   // older backend: fall back to no gating
    return () => { cancelled = true }
  }, [JSON.stringify(effectiveVars), state.activeDataset])

  const capFor = (id) => caps?.analyses?.[id] || null

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
        {caps && (
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 8, lineHeight: 1.5 }}>
            {caps.has_coordinates
              ? '✓ Coordinates found — spatial methods available'
              : 'No coordinates in this dataset — spatial methods unavailable'}
          </div>
        )}
        {GROUPS.map(group => {
          const items = ANALYSES.filter(a => (a.group || null) === group)
          if (!items.length) return null
          return (
            <div key={group || 'core'} style={{ marginBottom: 10 }}>
              {group && (
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.7px',
                              color: 'var(--txt3)', margin: '12px 0 5px' }}>{group}</div>
              )}
              {items.map(a => {
          const cap = capFor(a.id)
          const blocked = cap && cap.ok === false
          return (
          <div
            key={a.id}
            onClick={() => { setAnalysisType(a.id); setResult(null); setError(null) }}
            style={{
              padding: '7px 9px', borderRadius: 'var(--r)', cursor: 'pointer', marginBottom: 3,
              background: analysisType === a.id ? 'var(--accent2-dim)' : 'transparent',
              border: `1px solid ${analysisType === a.id ? 'rgba(129,140,248,0.3)' : 'transparent'}`,
              opacity: blocked && analysisType !== a.id ? 0.55 : 1,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500,
                          color: analysisType === a.id ? 'var(--accent2)'
                               : blocked ? 'var(--txt3)' : 'var(--txt)' }}>
              {a.label}
            </div>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2, lineHeight: 1.4 }}>{a.desc}</div>
            {blocked && (
              <div style={{ fontSize: 9.5, color: 'var(--accent3)', marginTop: 4, lineHeight: 1.45 }}>
                {cap.reason}
              </div>
            )}
          </div>
          )})}
            </div>
          )
        })}
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

            <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', textAlign: 'right' }}>
              <button
                className="btn primary"
                onClick={runAnalysis}
                disabled={loading || (analysisType !== 'join' && capFor(analysisType)?.ok === false)}
                title={analysisType !== 'join' ? capFor(analysisType)?.reason || '' : ''}
              >
                {loading ? <><div className="spinner" />Running…</> : `Run ${analysis?.label || ''}`}
              </button>
              {analysisType !== 'join' && capFor(analysisType)?.ok === false && (
                <div style={{ fontSize: 10.5, color: 'var(--accent3)', marginTop: 5, maxWidth: 260 }}>
                  {capFor(analysisType).reason} {capFor(analysisType).fix}
                </div>
              )}
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
