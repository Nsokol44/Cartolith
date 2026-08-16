// All requests go through Vite's proxy (/api → http://localhost:8000)
// Never hardcode the backend port here — that's what caused the "Not Found" error.
const BASE = ''   // empty = same origin, proxy handles routing to port 8000

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(BASE + path, options)
  } catch (networkErr) {
    throw new Error(
      `Cannot reach the Python backend.\n\n` +
      `Make sure it is running:\n` +
      `  cd backend\n` +
      `  uvicorn main:app --reload --http h11\n\n` +
      `(Original error: ${networkErr.message})`
    )
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const d = await res.json()
      msg = d.detail || JSON.stringify(d)
    } catch {}
    // Give a clear message for the two most common startup mistakes
    if (res.status === 404) {
      throw new Error(
        `Endpoint not found (404): ${path}\n\n` +
        `This usually means the Python backend is not running.\n` +
        `Start it with:\n  cd backend && uvicorn main:app --reload --http h11`
      )
    }
    if (res.status === 503) {
      throw new Error(
        `Backend unavailable (503).\n\nStart it with:\n  cd backend && uvicorn main:app --reload --http h11`
      )
    }
    throw new Error(msg)
  }
  return res.json()
}

/**
 * Upload a file using XHR so we can track progress.
 * onProgress(pct: 0-100) called during upload.
 */
export function uploadWithProgress(file, name, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file)
    if (name) fd.append('name', name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/datasets/upload')   // relative — goes through proxy

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Invalid JSON response from server'))
        }
      } else {
        let msg = `HTTP ${xhr.status}`
        try { msg = JSON.parse(xhr.responseText).detail || msg } catch {}

        if (xhr.status === 0 || xhr.status === 404 || xhr.status === 503) {
          reject(new Error(
            `Cannot reach the Python backend (status ${xhr.status}).\n\n` +
            `Make sure it is running:\n  cd backend && uvicorn main:app --reload --http h11`
          ))
        } else {
          reject(new Error(msg))
        }
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error(
        `Network error uploading "${file.name}".\n\n` +
        `Make sure the Python backend is running on port 8000:\n` +
        `  cd backend && uvicorn main:app --reload --http h11`
      ))
    })

    xhr.addEventListener('timeout', () => {
      reject(new Error(`Upload timed out for "${file.name}". Try a smaller file or check the backend logs.`))
    })

    xhr.timeout = 0   // no timeout — large files can take time
    xhr.send(fd)
  })
}

export const api = {
  health: () => request('/api/health'),

  listDatasets: () => request('/api/datasets'),

  deleteDataset: (id) =>
    request(`/api/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getPreview: (id, rows = 200, offset = 0) =>
    request(`/api/datasets/${encodeURIComponent(id)}/preview?rows=${rows}&offset=${offset}`),

  describeDataset: (id) =>
    request(`/api/datasets/${encodeURIComponent(id)}/describe`),

  getHistogram: (id, column, bins = 30) =>
    request(`/api/datasets/${encodeURIComponent(id)}/histogram?column=${encodeURIComponent(column)}&bins=${bins}`),

  analyze: (payload) =>
    request('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  chartData: (payload) =>
    request('/api/chart-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  rasterInfo: (id) =>
    request(`/api/raster/${encodeURIComponent(id)}/info`),
}

// ── Cartography ────────────────────────────────────────────────────────────
export const cartoApi = {
  extent: (id) =>
    request(`/api/carto/extent/${encodeURIComponent(id)}`),

  layer: (payload) =>
    request('/api/carto/layer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  vector: (payload) =>
    request('/api/carto/vector', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  shapefileTimeSteps: (id, timeCol = '') =>
    request(`/api/shapefile/${encodeURIComponent(id)}/time_steps?time_col=${encodeURIComponent(timeCol)}`),

  shapefileFilterTime: (id, payload) =>
    request(`/api/shapefile/${encodeURIComponent(id)}/filter_time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
}

// ── NetCDF time-band controls ──────────────────────────────────────────────
export const netcdfApi = {
  loadTimeBand: (id, timeIndex, levelIndex = 0, variables = null) =>
    request(`/api/netcdf/${encodeURIComponent(id)}/load_time_band`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_index: timeIndex, level_index: levelIndex, variables }),
    }),

  slice: (id, variable, timeIndex = 0, levelIndex = 0, colormap = 'viridis') =>
    request(`/api/netcdf/${encodeURIComponent(id)}/slice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variable, time_index: timeIndex, level_index: levelIndex, colormap }),
    }),

  variables: (id) =>
    request(`/api/netcdf/${encodeURIComponent(id)}/variables`),
}

// ── Export ─────────────────────────────────────────────────────────────────
export function exportDataset(id, fmt = 'csv') {
  // Use relative URL — goes through Vite proxy just like everything else
  const url = `/api/datasets/${encodeURIComponent(id)}/export?fmt=${fmt}`
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── Animation / band frame URLs (direct image URLs, not JSON) ─────────────
export const frameApi = {
  // Returns a direct URL to a PNG frame — used as <img src=...>
  netcdfFrameUrl: (id, variable, timeIndex, levelIndex = 0, colormap = 'viridis', width = 500) =>
    `/api/netcdf/${encodeURIComponent(id)}/animation_frame?variable=${encodeURIComponent(variable)}&time_index=${timeIndex}&level_index=${levelIndex}&colormap=${colormap}&width=${width}`,

  rasterFrameUrl: (id, band, colormap = 'viridis', width = 500) =>
    `/api/raster/${encodeURIComponent(id)}/animation_frame?band=${band}&colormap=${colormap}&width=${width}`,

  rasterBandSlice: (id, band, colormap = 'viridis') =>
    request(`/api/raster/${encodeURIComponent(id)}/band_slice?band=${band}&colormap=${colormap}`),
}

// ── SQL Lab ────────────────────────────────────────────────────────────────
export const sqlApi = {
  schema: () => request('/api/sql/schema'),
  query: (sql, limit = 1000) =>
    request('/api/sql/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, limit }),
    }),
  materialize: (sql, name) =>
    request('/api/sql/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, name }),
    }),
}

// ── Geoprocess (vector toolbox) ─────────────────────────────────────────────
export const geoprocessApi = {
  layers: () => request('/api/geoprocess/layers'),
  run: (tool, datasetId, params = {}, outputName = '') =>
    request('/api/geoprocess/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, dataset_id: datasetId, params, output_name: outputName }),
    }),
}

// ── Raster tools (terrain + spectral) ───────────────────────────────────────
export const rasterToolsApi = {
  layers: () => request('/api/raster-tools/layers'),
  run: (tool, datasetId, params = {}, outputName = '') =>
    request('/api/raster-tools/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, dataset_id: datasetId, params, output_name: outputName }),
    }),
}

// ── Network analysis ────────────────────────────────────────────────────────
export const networkApi = {
  layers: () => request('/api/network/layers'),
  run: (tool, datasetId, params = {}, outputName = '') =>
    request('/api/network/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, dataset_id: datasetId, params, output_name: outputName }),
    }),
}

// ── Projects (save / load the whole workspace) ──────────────────────────────
export const projectApi = {
  save: (body) => request('/api/project/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  load: (project) => request('/api/project/load', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }),
  }),
}

// ── Pipeline / lineage (re-run a recipe) ────────────────────────────────────
export const pipelineApi = {
  rerun: (derived, outputName = '') => request('/api/pipeline/rerun', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ derived, output_name: outputName }),
  }),
}

// ── Load remote data by URL ─────────────────────────────────────────────────
export const loadUrlApi = {
  load: (url, name = '') => request('/api/load-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name }),
  }),
}

// ── Sample data (one-click starters for newcomers) ──────────────────────────
export const samplesApi = {
  list: () => request('/api/samples'),
  load: (id) =>
    request('/api/samples/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }),
}
