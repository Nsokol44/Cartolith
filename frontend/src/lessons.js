// ─────────────────────────────────────────────────────────────────────────────
// Guided lessons.
//
// The point of these is that they VERIFY, not narrate. Each step carries a
// check(state) that inspects real app state — did a dataset with geometry
// actually get loaded, did the student actually select two variables — so a
// step only completes when the work is genuinely done. A student can't click
// "next" past a concept they haven't touched.
//
// Adding a lesson: append to LESSONS. Nothing else needs to change; the panel
// reads this file. Keep steps small (one action each) and write check() so it
// is true for ANY reasonable way of doing the step, not just one exact path —
// a check that is too strict is worse than no check, because it strands the
// student on a step they've already completed.
//
// State shape available to check() (see store.jsx):
//   state.datasets      { [id]: { id, name, format, shape, columns, types,
//                                 geo_meta?, netcdf_meta?, raster_meta? } }
//   state.activeDataset  id | null
//   state.selectedVars   [{ datasetId, column, key }]
// Plus a lesson-local scratchpad of things the app reports as they happen:
//   ctx.visited          Set of tab names the student has opened
//   ctx.events           Set of event names the app has fired (see fireLessonEvent)
// ─────────────────────────────────────────────────────────────────────────────

// ── check helpers ────────────────────────────────────────────────────────────
const values = (state) => Object.values(state.datasets || {})

export const has = {
  anyDataset: (state) => values(state).length > 0,
  nDatasets: (n) => (state) => values(state).length >= n,
  // A dataset that carries shapes — geo_meta is set by the shapefile/GeoJSON
  // parsers, and the _geom_* columns are added for anything with geometry.
  geometry: (state) => values(state).some(d =>
    d.geo_meta || (d.columns || []).some(c => String(c).startsWith('_geom'))),
  latLon: (state) => values(state).some(d =>
    (d.columns || []).some(c => /^(_?lat(itude)?|_centroid_lat|y)$/i.test(String(c)))),
  netcdf: (state) => values(state).some(d => d.netcdf_meta),
  raster: (state) => values(state).some(d => d.raster_meta),
  // Time-varying grid: the thing that makes NetCDF interesting to teach.
  timeSteps: (state) => values(state).some(d => (d.netcdf_meta?.time_info?.n_steps || 0) > 1),
  varsSelected: (n) => (state) => (state.selectedVars || []).length >= n,
  visited: (tab) => (state, ctx) => ctx.visited.has(tab),
  event: (name) => (state, ctx) => ctx.events.has(name),
}

// ── lessons ──────────────────────────────────────────────────────────────────
export const LESSONS = [
  {
    id: 'what-is-spatial',
    title: 'What makes data spatial',
    topic: 'Foundations',
    minutes: 5,
    blurb: 'The difference between a table and a map, and why one column changes everything.',
    intro:
      'Every GIS starts with the same idea: a table where some rows know where they are. ' +
      'This lesson is about seeing that difference directly rather than being told it.',
    concepts: ['dataset', 'geometry', 'attribute'],
    steps: [
      {
        title: 'Load some data',
        tab: 'Explore',
        concept: 'dataset',
        instruction:
          'Load the sample data from the left panel (or open a file of your own). ' +
          'Everything in Cartolith — files, query results, tool output — is a dataset: rows and columns.',
        hint: 'In the Datasets panel on the left, use "Load" and pick the sample data.',
        check: has.anyDataset,
        takeaway: 'A dataset is just a table. That is true of every layer you will ever load.',
      },
      {
        title: 'Find the geometry',
        tab: 'Explore',
        concept: 'geometry',
        instruction:
          'Load a dataset that has shapes — the sample "World regions" works. Look at its column list ' +
          'and find the columns beginning with an underscore: _geom_type, _centroid_lat, _centroid_lon. ' +
          'Those are what a plain spreadsheet does not have.',
        hint: 'World regions is a GEO dataset. The Variables list in the left panel shows its columns.',
        check: has.geometry,
        takeaway:
          'Geometry is the "where" attached to each row. A table with it can be drawn; a table without it cannot.',
      },
      {
        title: 'Tell attributes from geometry',
        tab: 'Explore',
        concept: 'attribute',
        instruction:
          'Click any two columns in the Variables list to select them. Notice that some describe the thing ' +
          '(region, market_tier — these are attributes) and some describe where it is (_centroid_lat).',
        hint: 'Click column names in the Variables panel on the left; selected ones highlight.',
        check: has.varsSelected(2),
        takeaway:
          'Attributes answer "what is it", geometry answers "where is it". Mapping is joining those two questions.',
      },
    ],
    wrapUp:
      'That is the whole foundation: a table, plus shapes, plus the attributes you want to say something about. ' +
      'Every tool in this app is a way of manipulating one of those three.',
  },

  {
    id: 'first-map',
    title: 'Your first map',
    topic: 'Cartography',
    minutes: 6,
    blurb: 'Get data onto a basemap and understand what a "layer" actually is.',
    intro:
      'A map is a stack of layers over a basemap. This lesson builds one from the bottom up.',
    concepts: ['point', 'polygon', 'crs'],
    steps: [
      {
        title: 'Open the map',
        tab: 'Cartography',
        instruction:
          'Switch to the Cartography tab. You should see a basemap and an empty Layers panel. ' +
          'The basemap is context only — it carries none of your data.',
        hint: 'Cartography is in the top navigation bar.',
        check: has.visited('Cartography'),
        takeaway: 'The basemap is a backdrop. Your data always sits in layers above it.',
      },
      {
        title: 'Add a layer',
        tab: 'Cartography',
        concept: 'polygon',
        instruction:
          'Click "+ Add" in the Layers panel and add one of your datasets to the map. ' +
          'Watch where it lands on the globe.',
        hint: 'Use the + Add button, choose a dataset, then confirm.',
        check: has.event('layer:added'),
        takeaway:
          'A layer is a dataset plus a decision about how to draw it. The same data can become many different layers.',
      },
      {
        title: 'Notice the alignment',
        tab: 'Cartography',
        concept: 'crs',
        instruction:
          'Your layer lined up with the basemap without you doing anything. That is a coordinate reference ' +
          'system doing quiet work. Open the "?" beside this step to read why that is not automatic in general.',
        hint: 'No action needed — just read the CRS concept, then continue.',
        check: () => true,
        takeaway:
          'Coordinates are meaningless without a CRS. Layers align only when they agree on one — here, EPSG:4326.',
      },
    ],
    wrapUp:
      'You now have the cartographic loop: pick data, add a layer, check it lands where it should. ' +
      'Everything else in Cartography is refinement of those three moves.',
  },

  {
    id: 'choropleth-classification',
    title: 'Choropleth maps and the classification trap',
    topic: 'Cartography',
    minutes: 8,
    blurb:
      'Colour a map by a number — then discover that the same data tells different stories depending on how you cut it.',
    intro:
      'This is the most important cartography lesson in the course, because it is the easiest place ' +
      'to mislead a reader without meaning to.',
    concepts: ['attribute', 'polygon'],
    steps: [
      {
        title: 'Map a number',
        tab: 'Cartography',
        instruction:
          'Add a layer and set its "Color-by column" to a numeric attribute. You have made a choropleth: ' +
          'areas shaded by value.',
        hint: 'In the Add-layer form, pick a dataset with polygons, then choose a numeric column to colour by.',
        check: has.event('layer:added'),
        takeaway: 'A choropleth encodes a number as colour across areas.',
      },
      {
        title: 'Change the classification',
        tab: 'Cartography',
        instruction:
          'Find the classification setting and switch it between Quantile and Equal interval. ' +
          'Watch the map redraw. Same data, same colours, different story.',
        hint: 'The classification dropdown is in the layer form, near the number of classes.',
        check: has.event('classification:changed'),
        takeaway:
          'Quantile puts an equal COUNT in each class; equal interval cuts the RANGE evenly. ' +
          'Quantile always looks balanced even when the data is not — that is its danger.',
      },
      {
        title: 'Change the class count',
        tab: 'Cartography',
        instruction:
          'Now vary the number of classes. Fewer classes generalise and can hide real variation; ' +
          'more classes show detail but get hard to read at a glance.',
        hint: 'Adjust the "classes" number in the same panel.',
        check: has.event('classes:changed'),
        takeaway:
          'Class count is an editorial decision, not a technical default. Five is a convention, not a rule.',
      },
    ],
    wrapUp:
      'Every choropleth you publish contains three choices — variable, classification method, class count — ' +
      'and a reader sees none of them. Stating your method in a caption is part of doing this honestly.',
  },

  {
    id: 'sql-questions',
    title: 'Asking questions with SQL',
    topic: 'Analysis',
    minutes: 7,
    blurb: 'Move from clicking filters to describing the answer you want.',
    intro:
      'Filters answer one question at a time. SQL answers a question you can re-run, share, and put in a methods section.',
    concepts: ['sql', 'spatial_sql'],
    steps: [
      {
        title: 'Open SQL Lab',
        tab: 'SQL Lab',
        concept: 'sql',
        instruction:
          'Switch to SQL Lab. Your loaded datasets are queryable as tables — the schema panel lists them.',
        hint: 'SQL Lab is in the top navigation bar.',
        check: has.visited('SQL Lab'),
        takeaway: 'Every loaded dataset is already a SQL table. Nothing to import.',
      },
      {
        title: 'Run a query',
        tab: 'SQL Lab',
        concept: 'sql',
        instruction:
          'Run any SELECT against one of your tables — start with SELECT * FROM your_table LIMIT 10 ' +
          'if you are new to this, then try adding a WHERE clause.',
        hint: 'Type into the editor and run it. Sample queries are provided if you want a starting point.',
        check: has.event('sql:ran'),
        takeaway: 'A query result is itself a dataset — you can map it, chart it, or query it again.',
      },
      {
        title: 'Group and count',
        tab: 'SQL Lab',
        instruction:
          'Write a query using GROUP BY to count rows per category — for example, ' +
          'SELECT region, count(*) FROM your_table GROUP BY region. This is the move a filter box cannot make.',
        hint: 'You need a text column to group on. Any category column works.',
        check: has.event('sql:groupby'),
        takeaway:
          'GROUP BY collapses many rows into one per group. Most real analytical questions are a GROUP BY in disguise.',
      },
    ],
    wrapUp:
      'SQL is the point where your analysis becomes reproducible. A saved query is a methods section that runs.',
  },

  {
    id: 'spatial-relationships',
    title: 'Spatial relationships',
    topic: 'Analysis',
    minutes: 8,
    blurb: 'Answer questions that only geometry can answer: what is near, what is inside, what overlaps.',
    intro:
      'Up to now location has been something you looked at. Here it becomes something you compute with.',
    concepts: ['buffer', 'spatial_join', 'intersection'],
    steps: [
      {
        title: 'Open Geoprocess',
        tab: 'Geoprocess',
        instruction: 'Switch to the Geoprocess tab and look at the tool list. These all take geometry in and give geometry out.',
        hint: 'Geoprocess is in the top navigation bar.',
        check: has.visited('Geoprocess'),
        takeaway: 'Geoprocessing tools are functions over shapes.',
      },
      {
        title: 'Build a buffer',
        tab: 'Geoprocess',
        concept: 'buffer',
        instruction:
          'Run a Buffer on a point or polygon dataset. A buffer draws a zone at a fixed distance around each shape — ' +
          'the geometric version of "within 5 km of".',
        hint: 'Choose Buffer, pick a dataset, set a distance, run it. The result becomes a new dataset.',
        check: has.event('geoprocess:ran'),
        takeaway:
          'Buffers turn a vague proximity question into an explicit, measurable area you can then test against.',
      },
      {
        title: 'Ask what falls inside',
        tab: 'Geoprocess',
        concept: 'spatial_join',
        instruction:
          'Now run a Spatial Join, or a Clip, using your buffer against another layer. ' +
          'This is the actual analytical payoff: attributes transferred based purely on location.',
        hint: 'Spatial join needs two datasets — your buffer output and something to test against it.',
        check: has.nDatasets(3),
        takeaway:
          'A spatial join is a normal table join where the matching condition is geometry instead of a shared key.',
      },
    ],
    wrapUp:
      'Buffer then join is the backbone of an enormous amount of applied GIS — access studies, ' +
      'impact zones, catchment analysis. The tools change; the two-step shape does not.',
  },

  {
    id: 'raster-time',
    title: 'Grids and time: reading a NetCDF',
    topic: 'Raster & climate',
    minutes: 8,
    blurb: 'Continuous surfaces instead of discrete shapes — and what changes when a dataset has a time axis.',
    intro:
      'Vector data is things. Raster data is a field measured everywhere on a grid. Climate data is usually the ' +
      'second kind, with time stacked on top.',
    concepts: ['raster'],
    steps: [
      {
        title: 'Load a grid',
        tab: 'Explore',
        concept: 'raster',
        instruction:
          'Load a NetCDF (.nc) or GeoTIFF file. Unlike a shapefile, this has no individual features — ' +
          'it is a grid of cells, each holding a measured value.',
        hint: 'Use Load in the Datasets panel. Any .nc or .tif file works.',
        check: (state) => has.netcdf(state) || has.raster(state),
        takeaway:
          'A raster stores a value per cell across a continuous surface. There are no "rows" in the vector sense.',
      },
      {
        title: 'Read the metadata',
        tab: 'Explore',
        instruction:
          'Look at the metadata panel for your grid: variables, dimensions, and — if it is NetCDF — time steps. ' +
          'A file with 552 time steps is 552 maps in one dataset.',
        hint: 'The NetCDF/raster metadata panel appears on the left once the file is loaded.',
        check: (state) => has.netcdf(state) || has.raster(state),
        takeaway:
          'Dimensions tell you the shape of the data: how many cells across, and how many moments in time.',
      },
      {
        title: 'Move through time',
        tab: 'Explore',
        instruction:
          'Use the time slider in the NetCDF Explorer to step through the series and watch the pattern change. ' +
          'Then pick a different variable if the file has more than one.',
        hint: 'The slider is under the variable selector. Drag it and watch the frame redraw.',
        check: has.event('netcdf:timestep'),
        takeaway:
          'Each time step is a full spatial snapshot. Analysis on time series means deciding whether you care ' +
          'about one moment, an average, or the trend between them.',
      },
    ],
    wrapUp:
      'Vector and raster answer different questions. Vector is good at "which one"; raster is good at ' +
      '"how much, here". Most real projects use both.',
  },
]

export const TOPICS = [...new Set(LESSONS.map(l => l.topic))]
export const lessonById = (id) => LESSONS.find(l => l.id === id)

// ── progress persistence ─────────────────────────────────────────────────────
// Saved locally so a student can close the app and come back mid-lesson.
// Fails silently if storage is unavailable — progress is a convenience, never
// a prerequisite for using the app.
const KEY = 'cartolith.lessons.v1'

export function loadProgress() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* non-fatal */ }
}
