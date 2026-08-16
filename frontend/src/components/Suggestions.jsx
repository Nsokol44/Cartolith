import { useApp } from '../store'
import { InfoDot } from './Learn'

// Look at a dataset and describe what it is, so we can suggest sensible next steps.
export function profileDataset(ds) {
  const cols = ds.columns || []
  const types = ds.types || {}
  const real = cols.filter(c => !String(c).startsWith('_'))
  const numeric = real.filter(c => types[c] === 'numeric')
  const categorical = real.filter(c => types[c] === 'categorical')
  const isRaster = !!ds.raster_meta
  const hasGeom = cols.includes('_geom_wkt') || !!ds.geo_meta
  const latC = cols.find(c => ['lat', 'latitude', '_latitude', '_centroid_lat'].includes(String(c).toLowerCase()))
  const lonC = cols.find(c => ['lon', 'lng', 'longitude', '_longitude', '_centroid_lon'].includes(String(c).toLowerCase()))
  const mappable = isRaster || hasGeom || (!!latC && !!lonC)
  const geomType = ds.geo_meta?.geometry_type || (isRaster ? 'Raster' : (latC && lonC && !hasGeom ? 'Point' : null))
  const rows = ds.shape?.[0] || 0
  const missing = Object.entries(ds.missing || {}).filter(([k, v]) => v > 0 && !String(k).startsWith('_'))
  return { numeric, categorical, isRaster, hasGeom, mappable, geomType, rows, missing, latC, lonC, real }
}

// Build a plain-English one-liner describing the dataset.
export function describeDataset(ds) {
  const p = profileDataset(ds)
  const what = p.isRaster ? 'a raster grid'
    : p.geomType ? `${p.rows.toLocaleString()} ${p.geomType.toLowerCase()} feature${p.rows === 1 ? '' : 's'}`
    : `a table of ${p.rows.toLocaleString()} row${p.rows === 1 ? '' : 's'}`
  const bits = []
  if (p.numeric.length) bits.push(`${p.numeric.length} number column${p.numeric.length === 1 ? '' : 's'}`)
  if (p.categorical.length) bits.push(`${p.categorical.length} text column${p.categorical.length === 1 ? '' : 's'}`)
  return `This is ${what}${bits.length ? ' with ' + bits.join(' and ') : ''}${p.mappable ? '. It can go on the map.' : '.'}`
}

const GROUPS = {
  visualize: { label: 'Visualize', accent: 'var(--accent)', dim: 'var(--accent-dim)' },
  analyze: { label: 'Analyze', accent: 'var(--accent2)', dim: 'var(--accent2-dim)' },
  transform: { label: 'Transform', accent: 'var(--accent3)', dim: 'rgba(245,158,11,0.12)' },
}

export default function Suggestions({ ds, go }) {
  const { dispatch, state } = useApp()
  if (!ds) return null
  const p = profileDataset(ds)
  const id = ds.id
  const setVars = (cols) => dispatch({ type: 'SET_VARS', datasetId: id, columns: cols })
  const S = [] // { group, label, why, run }

  // ── Visualize ──────────────────────────────────────────────────────────────
  if (p.mappable) S.push({ group: 'visualize', label: 'Show on map', concept: p.hasGeom ? 'geometry' : 'raster',
    why: 'See where your data actually is.', run: () => { dispatch({ type: 'REQUEST_MAP', datasetId: id }); go('Cartography') } })
  if (p.numeric.length >= 1) S.push({ group: 'visualize', label: `Chart “${p.numeric[0]}”`,
    why: 'A histogram shows how values spread out.', run: () => { setVars([p.numeric[0]]); go('Visualize') } })
  if (p.numeric.length >= 2) S.push({ group: 'visualize', label: `${p.numeric[0]} vs ${p.numeric[1]}`,
    why: 'A scatter plot reveals relationships.', run: () => { setVars([p.numeric[0], p.numeric[1]]); go('Visualize') } })
  if (p.categorical.length >= 1 && p.numeric.length >= 1) S.push({ group: 'visualize', label: `${p.numeric[0]} by ${p.categorical[0]}`,
    why: 'Compare a number across categories.', run: () => { setVars([p.categorical[0], p.numeric[0]]); go('Visualize') } })

  // ── Analyze ─────────────────────────────────────────────────────────────────
  if (p.numeric.length >= 1) S.push({ group: 'analyze', label: 'Summary statistics',
    why: 'Mean, spread, min/max at a glance.', run: () => go('Statistics') })
  if (p.numeric.length >= 2) S.push({ group: 'analyze', label: 'Find correlations', concept: 'attribute',
    why: 'Which numbers move together?', run: () => { setVars(p.numeric.slice(0, 6)); go('Analyze') } })
  if (p.numeric.length >= 2) S.push({ group: 'analyze', label: 'Cluster the rows',
    why: 'Group similar rows automatically.', run: () => { setVars(p.numeric.slice(0, 6)); go('Analyze') } })
  if (p.numeric.length >= 2) S.push({ group: 'analyze', label: 'Fit a regression',
    why: `Predict ${p.numeric[0]} from the others.`, run: () => { setVars(p.numeric.slice(0, 4)); go('Analyze') } })

  // ── Transform ────────────────────────────────────────────────────────────────
  if (p.mappable && (p.geomType === 'Point' || p.latC)) S.push({ group: 'transform', label: 'Buffer around points', concept: 'buffer',
    why: 'Find what falls within a distance.', run: () => go('Geoprocess') })
  if (p.hasGeom) S.push({ group: 'transform', label: 'Spatial join', concept: 'spatial_join',
    why: 'Tag features by where they sit.', run: () => go('Geoprocess') })
  if (p.isRaster) S.push({ group: 'transform', label: 'Terrain or index', concept: 'raster',
    why: 'Hillshade, slope, NDVI and more.', run: () => go('Geoprocess') })
  S.push({ group: 'transform', label: 'Query with SQL', concept: 'sql',
    why: 'Filter, group, and join precisely.', run: () => go('SQL Lab') })
  if (p.missing.length) S.push({ group: 'transform', label: `Handle missing (${p.missing.length} col${p.missing.length === 1 ? '' : 's'})`,
    why: 'Some columns have gaps to clean.', run: () => go('Explore') })

  const groupsInOrder = ['visualize', 'analyze', 'transform']
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rl)', padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 400, color: 'var(--txt)' }}>What&rsquo;s next</span>
        <span style={{ fontSize: 11.5, color: 'var(--txt3)' }}>{describeDataset(ds)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 10 }}>
        {groupsInOrder.map(gk => {
          const g = GROUPS[gk]; const items = S.filter(s => s.group === gk)
          if (!items.length) return null
          return (
            <div key={gk}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.6px', color: g.accent, marginBottom: 6, fontWeight: 600 }}>{g.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((s, i) => (
                  <button key={i} onClick={s.run} title={s.why} style={{
                    textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--r)', cursor: 'pointer',
                    background: 'var(--bg3)', border: '1px solid var(--bdr)', transition: 'all 0.12s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = g.accent; e.currentTarget.style.background = g.dim }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bdr)'; e.currentTarget.style.background = 'var(--bg3)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt)', flex: 1 }}>{s.label}</span>
                      {s.concept && <InfoDot concept={s.concept} size={13} />}
                    </span>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--txt3)', marginTop: 2, lineHeight: 1.4 }}>{s.why}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
