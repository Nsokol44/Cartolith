import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../store'
import { cartoApi } from '../api'

// ── Leaflet loaded via CDN script tag injected once ──────────────────────────
function useLeaflet(onReady) {
  const [ready, setReady] = useState(!!window.L)
  useEffect(() => {
    if (window.L) { setReady(true); return }
    // CSS
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
    document.head.appendChild(link)
    // Heatmap plugin CSS isn't needed but JS is
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
    script.onload = () => {
      // Load heatmap plugin
      const heatScript = document.createElement('script')
      heatScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js'
      heatScript.onload = () => setReady(true)
      heatScript.onerror = () => setReady(true) // heatmap optional
      document.head.appendChild(heatScript)
    }
    document.head.appendChild(script)
  }, [])
  useEffect(() => { if (ready) onReady?.() }, [ready])
  return ready
}

// ── Basemap definitions ───────────────────────────────────────────────────────
const BASEMAPS = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  {
    id: 'topo',
    label: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap contributors',
    maxZoom: 17,
  },
  {
    id: 'satellite',
    label: 'ESRI Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  {
    id: 'terrain',
    label: 'ESRI Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 13,
  },
  {
    id: 'dark',
    label: 'CartoDB Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© CartoDB',
    maxZoom: 19,
  },
  {
    id: 'light',
    label: 'CartoDB Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© CartoDB',
    maxZoom: 19,
  },
  {
    id: 'none',
    label: 'No basemap',
    url: null,
    attribution: '',
    maxZoom: 22,
  },
]

const COLORMAPS = [
  'viridis','plasma','inferno','magma','turbo',
  'rdylgn','spectral','blues','reds','ylorbr','greens','coolwarm',
]

const LAYER_TYPES = [
  { id: 'points',         label: 'Point scatter' },
  { id: 'choropleth',     label: 'Choropleth' },
  { id: 'heatmap',        label: 'Heatmap' },
  { id: 'raster_overlay', label: 'Raster overlay' },
  { id: 'vector',         label: 'Vector / Shapefile' },
]

// Rough centroid (average of all coordinate pairs) — good enough for a locator dot.
function featureCentroid(geometry) {
  if (!geometry) return null
  let sx = 0, sy = 0, n = 0
  const walk = (c) => {
    if (typeof c?.[0] === 'number' && typeof c?.[1] === 'number') { sx += c[0]; sy += c[1]; n++ }
    else if (Array.isArray(c)) c.forEach(walk)
  }
  walk(geometry.coordinates)
  return n ? [sx / n, sy / n] : null
}

const DEFAULT_POINT_COLORS = [
  '#6ee7b7','#818cf8','#f59e0b','#fb7185','#38bdf8','#a78bfa','#34d399','#f97316',
]

// ── Main component ────────────────────────────────────────────────────────────
export default function CartographyTab() {
  const { state, dispatch } = useApp()
  const mapRef = useRef(null)        // DOM div
  const leafletMap = useRef(null)    // L.Map instance
  const basemapLayer = useRef(null)
  const layerRefs = useRef({})       // layerId -> L.Layer
  const clipRect = useRef(null)      // L.Rectangle for clip preview

  const [layers, setLayers] = useState([])          // [{id, config, data, visible, loading, error}]
  const [addingLayer, setAddingLayer] = useState(false)
  const [editingLayer, setEditingLayer] = useState(null)
  const [basemap, setBasemap] = useState('osm')
  const [mapReady, setMapReady] = useState(false)

  // New layer form state
  const [form, setForm] = useState({
    dataset_id: '',
    layer_type: 'points',
    lat_col: '',
    lon_col: '',
    value_col: '',
    colormap: 'viridis',
    point_color: '#6ee7b7',
    point_size: 6,
    point_opacity: 0.8,
    classification: 'quantile',
    n_classes: 5,
    max_features: 5000,
    use_clip: false,
    clip_bbox: null,
    label: '',
  })

  const [clipDrawing, setClipDrawing] = useState(false)
  const [clipStart, setClipStart] = useState(null)
  const [clipPreview, setClipPreview] = useState(null) // {min_lon,min_lat,max_lon,max_lat}

  const datasets = Object.values(state.datasets)
  const leafletReady = useLeaflet(() => setMapReady(true))

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || leafletMap.current) return
    const L = window.L
    const map = L.map(mapRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
    })
    leafletMap.current = map

    // Add initial basemap
    const bm = BASEMAPS.find(b => b.id === 'osm')
    if (bm.url) {
      basemapLayer.current = L.tileLayer(bm.url, {
        attribution: bm.attribution,
        maxZoom: bm.maxZoom,
      }).addTo(map)
    }

    return () => {
      map.remove()
      leafletMap.current = null
    }
  }, [mapReady])

  // ── Switch basemap ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletMap.current) return
    const L = window.L
    const map = leafletMap.current
    if (basemapLayer.current) {
      map.removeLayer(basemapLayer.current)
      basemapLayer.current = null
    }
    const bm = BASEMAPS.find(b => b.id === basemap)
    if (bm?.url) {
      basemapLayer.current = L.tileLayer(bm.url, {
        attribution: bm.attribution,
        maxZoom: bm.maxZoom,
      }).addTo(map)
      // Send basemap to back
      basemapLayer.current.setZIndex(1)
    }
  }, [basemap, mapReady])

  // ── Render a layer onto the map ───────────────────────────────────────────
  function renderLayer(layerId, layerData, config) {
    if (!leafletMap.current) return
    const L = window.L
    const map = leafletMap.current

    // Remove old
    if (layerRefs.current[layerId]) {
      map.removeLayer(layerRefs.current[layerId])
      delete layerRefs.current[layerId]
    }

    let leafletLayer = null

    if (layerData.type === 'raster_overlay') {
      // ImageOverlay
      const b = layerData.bounds // [min_lon, min_lat, max_lon, max_lat]
      const imgBounds = [[b[1], b[0]], [b[3], b[2]]] // Leaflet wants [[south,west],[north,east]]
      leafletLayer = L.imageOverlay(
        `data:image/png;base64,${layerData.image_b64}`,
        imgBounds,
        { opacity: config.opacity ?? 0.85, interactive: false }
      ).addTo(map)
      map.fitBounds(imgBounds, { padding: [20, 20] })

    } else if (layerData.type === 'heatmap' && window.L.heatLayer) {
      leafletLayer = L.heatLayer(layerData.points, {
        radius: config.point_size ?? 18,
        blur: 15,
        maxZoom: 17,
        max: 1.0,
        gradient: { 0.2: '#00f', 0.4: '#0ff', 0.6: '#0f0', 0.8: '#ff0', 1.0: '#f00' },
      }).addTo(map)
      // Zoom to points
      if (layerData.points?.length > 0) {
        const lats = layerData.points.map(p => p[0]).filter(v => v != null)
        const lons = layerData.points.map(p => p[1]).filter(v => v != null)
        if (lats.length > 0) {
          map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [20, 20] })
        }
      }

    } else if (layerData.type === 'geojson' && layerData.geojson) {
      const hasValueCol = config.value_col && layerData.legend?.length > 0
      const defaultColor = config.point_color || DEFAULT_POINT_COLORS[0]

      const popupFor = (props) => {
        const rows = Object.entries(props || {})
          .filter(([k]) => !k.startsWith('_'))
          .slice(0, 10)
          .map(([k, v]) => `<tr><td style="color:#9499a8;padding:1px 6px 1px 0;font-size:11px">${k}</td><td style="font-size:11px;color:#e8eaf0">${v ?? '—'}</td></tr>`)
          .join('')
        return `<div style="font-family:monospace;min-width:160px;background:#16181c;border-radius:6px"><table style="border-collapse:collapse">${rows}</table></div>`
      }

      const gj = L.geoJSON(layerData.geojson, {
        pointToLayer: (feature, latlng) => {
          const color = hasValueCol ? (feature.properties._color || defaultColor) : defaultColor
          return L.circleMarker(latlng, {
            radius: config.point_size ?? 6, fillColor: color, color: 'rgba(0,0,0,0.3)',
            weight: 0.5, opacity: 1, fillOpacity: config.point_opacity ?? 0.85,
          })
        },
        style: (feature) => {
          const color = hasValueCol ? (feature.properties._color || defaultColor) : defaultColor
          return { color, fillColor: color, weight: 1.5, opacity: 0.95, fillOpacity: config.point_opacity ?? 0.45 }
        },
        onEachFeature: (feature, layer) => { if (feature.properties) layer.bindPopup(popupFor(feature.properties), { maxWidth: 280 }) },
      })

      // Locator dots at each feature so shapes are findable even when tiny on screen.
      const feats = layerData.geojson.features || []
      const areaLike = feats.some(f => f.geometry && /Polygon|LineString/.test(f.geometry.type))
      const markers = []
      if (areaLike && feats.length <= 800) {
        for (const f of feats) {
          const c = featureCentroid(f.geometry)
          if (!c) continue
          const color = hasValueCol ? (f.properties?._color || defaultColor) : defaultColor
          const m = L.circleMarker([c[1], c[0]], { radius: 3.5, fillColor: color, color: '#0b0d10', weight: 0.6, fillOpacity: 0.95 })
          m.bindPopup(popupFor(f.properties), { maxWidth: 280 })
          markers.push(m)
        }
      }

      leafletLayer = L.featureGroup([gj, ...markers]).addTo(map)

      // Zoom so features are actually on screen. For a single/tiny feature, back off to a readable zoom.
      try {
        const bounds = leafletLayer.getBounds()
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
          if (feats.length <= 1 && map.getZoom() > 11) map.setZoom(11)
        }
      } catch {}
    }

    if (leafletLayer) {
      layerRefs.current[layerId] = leafletLayer
    }
  }

  // ── Toggle layer visibility ───────────────────────────────────────────────
  function toggleVisibility(layerId) {
    setLayers(ls => ls.map(l => {
      if (l.id !== layerId) return l
      const newVisible = !l.visible
      const ll = layerRefs.current[layerId]
      if (ll && leafletMap.current) {
        if (newVisible) leafletMap.current.addLayer(ll)
        else leafletMap.current.removeLayer(ll)
      }
      return { ...l, visible: newVisible }
    }))
  }

  // ── Remove layer ─────────────────────────────────────────────────────────
  function removeLayer(layerId) {
    const ll = layerRefs.current[layerId]
    if (ll && leafletMap.current) leafletMap.current.removeLayer(ll)
    delete layerRefs.current[layerId]
    setLayers(ls => ls.filter(l => l.id !== layerId))
  }

  // ── Zoom to layer ─────────────────────────────────────────────────────────
  function zoomToLayer(layerId) {
    const ll = layerRefs.current[layerId]
    if (!ll || !leafletMap.current) return
    try {
      if (ll.getBounds) {
        const b = ll.getBounds()
        if (b.isValid()) leafletMap.current.fitBounds(b, { padding: [30, 30], maxZoom: 13 })
      }
    } catch {}
  }

  // ── One-click auto-display (no dialog) ────────────────────────────────────
  // Figures out the right layer type for a dataset and drops it straight on the map.
  function datasetMapType(ds) {
    if (!ds) return null
    const cols = (ds.columns || []).map(c => c.toLowerCase())
    if (ds.raster_meta) return { type: 'raster_overlay' }
    if (cols.includes('_geom_wkt') || ds.geo_meta || ['geojson', 'shapefile', 'dbf'].includes(ds.format))
      return { type: 'vector' }
    const latC = (ds.columns || []).find(c => ['lat', 'latitude', '_latitude', '_centroid_lat'].includes(c.toLowerCase()))
    const lonC = (ds.columns || []).find(c => ['lon', 'lng', 'longitude', '_longitude', '_centroid_lon'].includes(c.toLowerCase()))
    if (latC && lonC) return { type: 'points', lat_col: latC, lon_col: lonC }
    return null
  }

  async function autoAddDataset(dsId) {
    const ds = state.datasets[dsId]
    if (!ds || !leafletMap.current) return
    // already on the map? just zoom to it
    const existing = layers.find(l => l.config?.dataset_id === dsId)
    if (existing) { zoomToLayer(existing.id); return }
    const kind = datasetMapType(ds)
    if (!kind) return
    const cmap = ds.raster_meta?.is_dem ? 'terrain' : 'viridis'
    const config = { ...form, dataset_id: dsId, layer_type: kind.type, colormap: cmap,
                     lat_col: kind.lat_col || '', lon_col: kind.lon_col || '', value_col: '', use_clip: false, clip_bbox: null }
    const label = `${ds.name} — ${kind.type === 'raster_overlay' ? 'raster' : kind.type}`
    const layerId = `layer_${Date.now()}`
    setLayers(ls => [...ls, { id: layerId, config, label, visible: true, loading: true, error: null, data: null }])
    setAddingLayer(false)
    try {
      let data
      if (kind.type === 'raster_overlay') data = await cartoApi.layer({ dataset_id: dsId, layer_type: 'raster_overlay', colormap: cmap })
      else if (kind.type === 'vector') data = await cartoApi.vector({ dataset_id: dsId, colormap: 'viridis', n_classes: 5, classification: 'quantile', max_features: 5000 })
      else data = await cartoApi.layer({ dataset_id: dsId, layer_type: 'points', lat_col: kind.lat_col, lon_col: kind.lon_col, colormap: 'viridis', n_classes: 5, classification: 'quantile', max_features: 5000 })
      setLayers(ls => ls.map(l => l.id === layerId ? { ...l, loading: false, data } : l))
      renderLayer(layerId, data, config)
    } catch (err) {
      setLayers(ls => ls.map(l => l.id === layerId ? { ...l, loading: false, error: err.message } : l))
    }
  }

  // Watch for "show this on the map" requests dispatched from other tabs.
  useEffect(() => {
    if (!state.mapRequest || !mapReady) return
    autoAddDataset(state.mapRequest.datasetId)
    dispatch({ type: 'CLEAR_MAP_REQUEST' })
  }, [state.mapRequest, mapReady]) // eslint-disable-line

  // ── Clip drawing mode ─────────────────────────────────────────────────────
  function startClipDraw() {
    if (!leafletMap.current) return
    const map = leafletMap.current
    setClipDrawing(true)
    map.getContainer().style.cursor = 'crosshair'
    let start = null
    let rect = null

    function onMouseDown(e) {
      start = e.latlng
    }
    function onMouseMove(e) {
      if (!start) return
      const bounds = [[start.lat, start.lng], [e.latlng.lat, e.latlng.lng]]
      if (rect) map.removeLayer(rect)
      rect = window.L.rectangle(bounds, {
        color: '#6ee7b7', weight: 2, fillOpacity: 0.1, dashArray: '5,5',
      }).addTo(map)
    }
    function onMouseUp(e) {
      if (!start) return
      const bbox = {
        min_lon: Math.min(start.lng, e.latlng.lng),
        min_lat: Math.min(start.lat, e.latlng.lat),
        max_lon: Math.max(start.lng, e.latlng.lng),
        max_lat: Math.max(start.lat, e.latlng.lat),
      }
      if (rect) { map.removeLayer(rect); rect = null }
      // Draw final clip rect
      if (clipRect.current) map.removeLayer(clipRect.current)
      clipRect.current = window.L.rectangle(
        [[bbox.min_lat, bbox.min_lon], [bbox.max_lat, bbox.max_lon]],
        { color: '#6ee7b7', weight: 2, fillOpacity: 0.05, dashArray: '6,4' }
      ).addTo(map)

      setClipPreview(bbox)
      setForm(f => ({ ...f, clip_bbox: bbox, use_clip: true }))
      setClipDrawing(false)
      map.getContainer().style.cursor = ''
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      start = null
    }
    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
  }

  function clearClip() {
    if (clipRect.current && leafletMap.current) {
      leafletMap.current.removeLayer(clipRect.current)
      clipRect.current = null
    }
    setClipPreview(null)
    setForm(f => ({ ...f, clip_bbox: null, use_clip: false }))
  }

  // ── Auto-detect columns + shapefile time steps when dataset changes ─────────
  useEffect(() => {
    if (!form.dataset_id) return
    const ds = state.datasets[form.dataset_id]
    if (!ds) return
    const cols = ds.columns || []
    const latC = cols.find(c => ['lat','latitude','_latitude','_centroid_lat'].includes(c.toLowerCase()))
    const lonC = cols.find(c => ['lon','lng','longitude','_longitude','_centroid_lon'].includes(c.toLowerCase()))
    setForm(f => ({ ...f, lat_col: latC || '', lon_col: lonC || '' }))

    // For shapefiles / tabular datasets, check for a time column
    const isShapefile = ['shapefile','dbf','geojson'].includes(ds.format)
    const isTabular = ['csv','tsv','json','xlsx','parquet'].includes(ds.format)
    if ((isShapefile || isTabular) && !ds.netcdf_meta) {
      cartoApi.shapefileTimeSteps(form.dataset_id).then(r => {
        if (r.n_steps > 0) {
          setForm(f => ({ ...f, shp_time_col: r.time_col, shp_time_steps: r.steps, shp_time_idx: 0 }))
        }
      }).catch(() => {})
    }
  }, [form.dataset_id])

  // ── Add layer ─────────────────────────────────────────────────────────────
  async function addLayer() {
    if (!form.dataset_id) return
    const layerId = `layer_${Date.now()}`
    const ds = state.datasets[form.dataset_id]
    const timeIdx = form.time_index || 0
    const timeLabel = ds?.netcdf_meta?.time_info?.labels?.[timeIdx] || null
    const label = form.label || `${ds?.name || form.dataset_id}${timeLabel ? ` [${timeLabel.slice(0,10)}]` : ''} — ${form.layer_type}`

    const newLayer = { id: layerId, config: { ...form }, label, visible: true, loading: true, error: null, data: null,
                       isNetCDF: !!ds?.netcdf_meta, timeInfo: ds?.netcdf_meta?.time_info || null, currentTimeIdx: timeIdx,
                       isShpTime: !!(form.shp_time_col && form.shp_time_steps?.length > 0),
                       shpTimeCol: form.shp_time_col || null,
                       shpTimeSteps: form.shp_time_steps || [],
                       shpTimeIdx: form.shp_time_idx || 0 }
    setLayers(ls => [...ls, newLayer])
    setAddingLayer(false)

    try {
      // If this is a NetCDF dataset, push the correct time band first
      if (ds?.netcdf_meta && timeIdx > 0) {
        await fetch(`/api/netcdf/${encodeURIComponent(form.dataset_id)}/load_time_band`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ time_index: timeIdx, level_index: 0 })
        })
      }

      // If shapefile with time column, use filtered endpoint
      if (form.shp_time_col && form.shp_time_steps?.length > 0) {
        const timeVal = form.shp_time_steps[form.shp_time_idx || 0]
        const data = await cartoApi.shapefileFilterTime(form.dataset_id, {
          time_col: form.shp_time_col, time_value: timeVal,
          value_col: form.value_col || null, colormap: form.colormap,
          n_classes: form.n_classes, max_features: form.max_features,
        })
        setLayers(ls => ls.map(l => l.id === layerId ? { ...l, loading: false, data } : l))
        renderLayer(layerId, data, form)
        return
      }

      let data
      if (form.layer_type === 'raster_overlay') {
        data = await cartoApi.layer({ dataset_id: form.dataset_id, layer_type: 'raster_overlay', colormap: form.colormap })
      } else if (form.layer_type === 'vector') {
        data = await cartoApi.vector({
          dataset_id: form.dataset_id, value_col: form.value_col || null,
          colormap: form.colormap, n_classes: form.n_classes, classification: form.classification,
          max_features: form.max_features, clip_bbox: form.use_clip ? form.clip_bbox : null,
        })
      } else {
        data = await cartoApi.layer({
          dataset_id: form.dataset_id, layer_type: form.layer_type,
          lat_col: form.lat_col || null, lon_col: form.lon_col || null,
          value_col: form.value_col || null, colormap: form.colormap,
          n_classes: form.n_classes, classification: form.classification,
          max_features: form.max_features, clip_bbox: form.use_clip ? form.clip_bbox : null,
        })
      }

      setLayers(ls => ls.map(l => l.id === layerId ? { ...l, loading: false, data } : l))
      renderLayer(layerId, data, form)
    } catch (err) {
      setLayers(ls => ls.map(l => l.id === layerId ? { ...l, loading: false, error: err.message } : l))
    }
  }

  // ── Auto-fit to first loaded dataset ─────────────────────────────────────
  async function fitToDataset(dsId) {
    if (!leafletMap.current) return
    try {
      const ext = await cartoApi.extent(dsId)
      if (ext.detected !== false) {
        leafletMap.current.fitBounds(
          [[ext.min_lat, ext.min_lon], [ext.max_lat, ext.max_lon]],
          { padding: [30, 30] }
        )
      }
    } catch {}
  }

  const activeDs = form.dataset_id ? state.datasets[form.dataset_id] : null
  const numCols = activeDs?.columns?.filter(c => activeDs.types?.[c] === 'numeric') || []
  const allCols = activeDs?.columns || []

  const fmt4 = n => n != null ? n.toFixed(4) : '—'

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div style={{
        width: 260, flexShrink: 0, borderRight: '1px solid var(--bdr)',
        background: 'var(--bg2)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Basemap selector */}
        <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid var(--bdr)', flexShrink: 0 }}>
          <div className="section-title">Basemap</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {BASEMAPS.map(b => (
              <button
                key={b.id}
                onClick={() => setBasemap(b.id)}
                style={{
                  padding: '5px 6px', fontSize: 11, borderRadius: 'var(--r)', cursor: 'pointer',
                  background: basemap === b.id ? 'var(--accent-dim)' : 'var(--bg3)',
                  border: `1px solid ${basemap === b.id ? 'rgba(110,231,183,0.4)' : 'var(--bdr)'}`,
                  color: basemap === b.id ? 'var(--accent)' : 'var(--txt2)',
                  textAlign: 'left', fontFamily: 'var(--font-body)',
                }}
              >{b.label}</button>
            ))}
          </div>
        </div>

        {/* Layers list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>Layers</div>
            <button className="btn sm primary" onClick={() => setAddingLayer(true)}>+ Add</button>
          </div>

          {layers.length === 0 && (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <div style={{ fontSize: 20, opacity: 0.25, marginBottom: 6 }}>⊕</div>
              <div style={{ fontSize: 11 }}>Add a layer to start mapping</div>
            </div>
          )}

          {[...layers].reverse().map(layer => (
            <div key={layer.id} style={{
              padding: '8px 10px', borderRadius: 'var(--r)', marginBottom: 5,
              background: 'var(--bg3)', border: '1px solid var(--bdr)',
            }}>
              {/* Layer header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div onClick={() => toggleVisibility(layer.id)}
                  style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, cursor: 'pointer',
                    background: layer.visible ? (layer.config.point_color || 'var(--accent)') : 'var(--bg4)',
                    border: '1px solid var(--bdr2)' }}
                  title={layer.visible ? 'Hide layer' : 'Show layer'} />
                <span style={{ fontSize: 11, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: layer.visible ? 'var(--txt)' : 'var(--txt3)' }}>{layer.label}</span>
                {layer.loading && <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
              </div>

              {/* Layer meta */}
              {!layer.loading && !layer.error && layer.data && (
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 4 }}>
                  {layer.data.feature_count != null && `${layer.data.feature_count.toLocaleString()} features`}
                  {layer.data.type === 'raster_overlay' && ' raster overlay'}
                  {layer.data.type === 'heatmap' && ` · ${layer.data.points?.length?.toLocaleString()} pts`}
                </div>
              )}

              {layer.error && (
                <div style={{ fontSize: 10, color: 'var(--accent4)', marginBottom: 4, lineHeight: 1.4 }}>
                  {layer.error.split('\n')[0].slice(0, 120)}
                </div>
              )}

              {/* Legend */}
              {layer.data?.legend?.length > 0 && (
                <div style={{ marginBottom: 5 }}>
                  {layer.data.legend.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
                      <div style={{ width: 10, height: 10, background: e.color, borderRadius: 2, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, color: 'var(--txt3)', fontFamily: 'var(--font-mono)' }}>{e.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Shapefile time scrubber ── */}
              {layer.isShpTime && layer.shpTimeSteps?.length > 1 && !layer.loading && (
                <div style={{ marginBottom: 6, padding: '6px 8px', background: 'var(--bg)', borderRadius: 'var(--r)', border: '1px solid rgba(129,140,248,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 10, color: 'var(--txt3)' }}>
                    <span style={{ color: 'var(--accent2)' }}>
                      {layer.shpTimeSteps[layer.shpTimeIdx || 0]}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{(layer.shpTimeIdx||0)+1}/{layer.shpTimeSteps.length}</span>
                  </div>
                  <input type="range" min={0} max={layer.shpTimeSteps.length - 1}
                    value={layer.shpTimeIdx || 0}
                    onChange={async e => {
                      const idx = +e.target.value
                      setLayers(ls => ls.map(l => l.id === layer.id ? { ...l, shpTimeIdx: idx } : l))
                      try {
                        const timeVal = layer.shpTimeSteps[idx]
                        const newData = await cartoApi.shapefileFilterTime(layer.config.dataset_id, {
                          time_col: layer.shpTimeCol, time_value: timeVal,
                          value_col: layer.config.value_col || null,
                          colormap: layer.config.colormap,
                          n_classes: layer.config.n_classes,
                          max_features: layer.config.max_features,
                        })
                        setLayers(ls => ls.map(l => l.id === layer.id ? { ...l, data: newData } : l))
                        renderLayer(layer.id, newData, layer.config)
                      } catch {}
                    }}
                    style={{ width: '100%', marginTop: 2 }} />
                </div>
              )}
              {layer.isNetCDF && layer.timeInfo?.n_steps > 1 && !layer.loading && (
                <div style={{ marginBottom: 6, padding: '6px 8px', background: 'var(--bg)', borderRadius: 'var(--r)', border: '1px solid rgba(56,189,248,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 10, color: 'var(--txt3)' }}>
                    <span style={{ color: 'var(--accent5)' }}>
                      {layer.timeInfo.labels?.[layer.currentTimeIdx] || `Step ${(layer.currentTimeIdx||0)+1}`}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{(layer.currentTimeIdx||0)+1}/{layer.timeInfo.n_steps}</span>
                  </div>
                  <input type="range" min={0} max={layer.timeInfo.n_steps - 1}
                    value={layer.currentTimeIdx || 0}
                    onChange={async e => {
                      const t = +e.target.value
                      // Update display immediately
                      setLayers(ls => ls.map(l => l.id === layer.id ? { ...l, currentTimeIdx: t } : l))
                      // Push to backend and re-fetch layer data
                      try {
                        await fetch(`/api/netcdf/${encodeURIComponent(layer.config.dataset_id)}/load_time_band`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ time_index: t, level_index: 0 })
                        })
                        // Re-fetch this layer's data at new time step
                        let newData
                        if (layer.config.layer_type === 'vector') {
                          newData = await cartoApi.vector({ dataset_id: layer.config.dataset_id, value_col: layer.config.value_col||null, colormap: layer.config.colormap, n_classes: layer.config.n_classes, classification: layer.config.classification, max_features: layer.config.max_features })
                        } else {
                          newData = await cartoApi.layer({ dataset_id: layer.config.dataset_id, layer_type: layer.config.layer_type, lat_col: layer.config.lat_col||null, lon_col: layer.config.lon_col||null, value_col: layer.config.value_col||null, colormap: layer.config.colormap, n_classes: layer.config.n_classes, classification: layer.config.classification, max_features: layer.config.max_features })
                        }
                        setLayers(ls => ls.map(l => l.id === layer.id ? { ...l, data: newData } : l))
                        renderLayer(layer.id, newData, layer.config)
                      } catch {}
                    }}
                    style={{ width: '100%', marginTop: 2 }} />
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn ghost sm" onClick={() => zoomToLayer(layer.id)} style={{ fontSize: 10, padding: '2px 7px' }}>⊙ Zoom</button>
                <button className="btn ghost sm" onClick={() => removeLayer(layer.id)} style={{ fontSize: 10, padding: '2px 7px', color: 'var(--accent4)' }}>✕ Remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Map container ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#1a1c20' }} />

        {/* Loading overlay */}
        {!mapReady && (
          <div style={{
            position: 'absolute', inset: 0, background: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 12, zIndex: 1000,
          }}>
            <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
            <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Loading Leaflet…</div>
          </div>
        )}

        {/* Clip drawing hint */}
        {clipDrawing && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(110,231,183,0.15)', border: '1px solid var(--accent)',
            borderRadius: 'var(--r)', padding: '7px 14px', zIndex: 1000,
            fontSize: 12, color: 'var(--accent)', pointerEvents: 'none',
          }}>
            Click and drag to draw clip region
          </div>
        )}

        {/* Clip preview badge */}
        {clipPreview && !clipDrawing && (
          <div style={{
            position: 'absolute', bottom: 32, left: 12,
            background: 'rgba(14,15,17,0.9)', border: '1px solid rgba(110,231,183,0.3)',
            borderRadius: 'var(--r)', padding: '5px 10px', zIndex: 999,
            fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)',
          }}>
            Clip: {fmt4(clipPreview.min_lon)},{fmt4(clipPreview.min_lat)} → {fmt4(clipPreview.max_lon)},{fmt4(clipPreview.max_lat)}
          </div>
        )}
      </div>

      {/* ── Add layer panel (slide-in overlay) ────────────────────────────── */}
      {addingLayer && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 300,
          background: 'var(--bg2)', borderLeft: '1px solid var(--bdr)',
          display: 'flex', flexDirection: 'column', zIndex: 2000,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            padding: '12px 14px', borderBottom: '1px solid var(--bdr)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 300 }}>Add Layer</span>
            <button className="btn ghost icon" onClick={() => setAddingLayer(false)}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Dataset */}
            <div>
              <label className="field-label">Dataset</label>
              <select value={form.dataset_id}
                onChange={e => { setForm(f => ({ ...f, dataset_id: e.target.value, time_index: 0 })); fitToDataset(e.target.value) }}>
                <option value="">Select dataset…</option>
                {datasets.map(ds => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
              </select>
            </div>

            {/* NetCDF time step selector */}
            {activeDs?.netcdf_meta?.time_info?.n_steps > 1 && (() => {
              const ti = activeDs.netcdf_meta.time_info
              const labels = ti.labels || []
              const n = ti.n_steps
              return (
                <div style={{ background: 'var(--bg3)', borderRadius: 'var(--r)', padding: 10, border: '1px solid rgba(56,189,248,0.25)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label className="field-label" style={{ margin: 0, color: 'var(--accent5)' }}>
                      Time step: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--txt)' }}>
                        {labels[form.time_index || 0] || `Step ${(form.time_index || 0) + 1}`}
                      </span>
                    </label>
                    <span style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'var(--font-mono)' }}>
                      {(form.time_index || 0) + 1} / {n}
                    </span>
                  </div>
                  <input type="range" min={0} max={n - 1}
                    value={form.time_index || 0}
                    onChange={e => setForm(f => ({ ...f, time_index: +e.target.value }))}
                    style={{ width: '100%' }} />
                  {ti.units && <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 2 }}>{ti.units}</div>}
                </div>
              )
            })()}

            {/* Shapefile / tabular time column selector */}
            {form.shp_time_steps?.length > 0 && !activeDs?.netcdf_meta && (
              <div style={{ background: 'var(--bg3)', borderRadius: 'var(--r)', padding: 10, border: '1px solid rgba(129,140,248,0.25)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="field-label" style={{ margin: 0, color: 'var(--accent2)' }}>
                    Time column: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--txt)' }}>{form.shp_time_col}</span>
                  </label>
                  <span style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'var(--font-mono)' }}>
                    {(form.shp_time_idx || 0) + 1} / {form.shp_time_steps.length}
                  </span>
                </div>
                <select value={form.shp_time_idx || 0}
                  onChange={e => setForm(f => ({ ...f, shp_time_idx: +e.target.value }))}
                  style={{ width: '100%', fontSize: 11 }}>
                  {form.shp_time_steps.map((s, i) => (
                    <option key={i} value={i}>{s}</option>
                  ))}
                </select>
                <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 4 }}>
                  Detected {form.shp_time_steps.length} unique time values — select which to display
                </div>
              </div>
            )}
            <div>
              <label className="field-label">Layer type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {LAYER_TYPES.map(lt => (
                  <button key={lt.id}
                    className={`tag${form.layer_type === lt.id ? ' active' : ''}`}
                    onClick={() => setForm(f => ({ ...f, layer_type: lt.id }))}
                    style={{ justifyContent: 'center', fontSize: 11 }}>
                    {lt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Coordinate columns — not needed for raster */}
            {!['raster_overlay'].includes(form.layer_type) && (
              <div className="grid-2">
                <div>
                  <label className="field-label">Latitude col</label>
                  <select value={form.lat_col} onChange={e => setForm(f => ({ ...f, lat_col: e.target.value }))}>
                    <option value="">Auto-detect</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Longitude col</label>
                  <select value={form.lon_col} onChange={e => setForm(f => ({ ...f, lon_col: e.target.value }))}>
                    <option value="">Auto-detect</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* Value column for choropleth / heatmap */}
            {['choropleth','heatmap','points','vector'].includes(form.layer_type) && (
              <div>
                <label className="field-label">
                  {form.layer_type === 'heatmap' ? 'Intensity column (optional)' :
                   form.layer_type === 'choropleth' || form.layer_type === 'vector' ? 'Color-by column' :
                   'Color-by column (optional)'}
                </label>
                <select value={form.value_col} onChange={e => setForm(f => ({ ...f, value_col: e.target.value }))}>
                  <option value="">None — use solid color</option>
                  {numCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {/* Symbology */}
            {form.layer_type !== 'raster_overlay' && (
              <div style={{ background: 'var(--bg3)', borderRadius: 'var(--r)', padding: 10, border: '1px solid var(--bdr)' }}>
                <div className="section-title" style={{ marginBottom: 8 }}>Symbology</div>

                {!form.value_col && form.layer_type !== 'heatmap' && (
                  <div style={{ marginBottom: 8 }}>
                    <label className="field-label">Point color</label>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {DEFAULT_POINT_COLORS.map(c => (
                        <div key={c} onClick={() => setForm(f => ({ ...f, point_color: c }))}
                          style={{
                            width: 18, height: 18, borderRadius: 3, background: c, cursor: 'pointer',
                            outline: form.point_color === c ? `2px solid white` : 'none',
                            outlineOffset: 1,
                          }} />
                      ))}
                    </div>
                  </div>
                )}

                {form.value_col && (
                  <div style={{ marginBottom: 8 }}>
                    <label className="field-label">Colormap</label>
                    <select value={form.colormap} onChange={e => setForm(f => ({ ...f, colormap: e.target.value }))}>
                      {COLORMAPS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}

                {form.value_col && ['choropleth','points','vector'].includes(form.layer_type) && (
                  <div className="grid-2" style={{ marginBottom: 8 }}>
                    <div>
                      <label className="field-label">Classification</label>
                      <select value={form.classification} onChange={e => setForm(f => ({ ...f, classification: e.target.value }))}>
                        <option value="quantile">Quantile</option>
                        <option value="equal">Equal interval</option>
                      </select>
                    </div>
                    <div>
                      <label className="field-label">Classes</label>
                      <select value={form.n_classes} onChange={e => setForm(f => ({ ...f, n_classes: +e.target.value }))}>
                        {[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {form.layer_type !== 'heatmap' && (
                  <div className="grid-2">
                    <div>
                      <label className="field-label">Size: {form.point_size}px</label>
                      <input type="range" min={2} max={20} value={form.point_size}
                        onChange={e => setForm(f => ({ ...f, point_size: +e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">Opacity: {Math.round(form.point_opacity * 100)}%</label>
                      <input type="range" min={0.1} max={1} step={0.05} value={form.point_opacity}
                        onChange={e => setForm(f => ({ ...f, point_opacity: +e.target.value }))} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Raster colormap */}
            {form.layer_type === 'raster_overlay' && (
              <div>
                <label className="field-label">Colormap (single-band)</label>
                <select value={form.colormap} onChange={e => setForm(f => ({ ...f, colormap: e.target.value }))}>
                  {COLORMAPS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {/* Max features */}
            {form.layer_type !== 'raster_overlay' && (
              <div>
                <label className="field-label">Max features</label>
                <select value={form.max_features} onChange={e => setForm(f => ({ ...f, max_features: +e.target.value }))}>
                  {[500,1000,2500,5000,10000,25000].map(n => <option key={n} value={n}>{n.toLocaleString()}</option>)}
                </select>
              </div>
            )}

            {/* Clip to area */}
            {form.layer_type !== 'raster_overlay' && (
              <div style={{ background: 'var(--bg3)', borderRadius: 'var(--r)', padding: 10, border: '1px solid var(--bdr)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div className="section-title" style={{ margin: 0 }}>Clip to area</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: 'var(--txt2)' }}>
                    <input type="checkbox" checked={form.use_clip}
                      onChange={e => setForm(f => ({ ...f, use_clip: e.target.checked }))} />
                    Enable
                  </label>
                </div>
                {form.use_clip && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button className="btn sm" onClick={startClipDraw} disabled={clipDrawing}
                      style={{ width: '100%', borderColor: 'rgba(110,231,183,0.3)', color: 'var(--accent)' }}>
                      {clipDrawing ? '…drawing…' : clipPreview ? '↺ Redraw clip region' : '⬚ Draw clip region on map'}
                    </button>
                    {clipPreview && (
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--txt3)', lineHeight: 1.6 }}>
                        W: {fmt4(clipPreview.min_lon)} E: {fmt4(clipPreview.max_lon)}<br />
                        S: {fmt4(clipPreview.min_lat)} N: {fmt4(clipPreview.max_lat)}
                      </div>
                    )}
                    {clipPreview && (
                      <button className="btn ghost sm danger" onClick={clearClip} style={{ width: '100%', fontSize: 10 }}>
                        Clear clip
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Layer label */}
            <div>
              <label className="field-label">Layer name (optional)</label>
              <input type="text" value={form.label}
                placeholder={`${state.datasets[form.dataset_id]?.name || 'Layer'} — ${form.layer_type}`}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>

          </div>

          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--bdr)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn primary" style={{ flex: 1 }}
              disabled={!form.dataset_id}
              onClick={addLayer}>
              Add to map
            </button>
            <button className="btn" onClick={() => setAddingLayer(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
