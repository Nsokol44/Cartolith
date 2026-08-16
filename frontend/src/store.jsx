import { createContext, useContext, useReducer } from 'react'
const Ctx = createContext(null)
const init = { datasets: {}, activeDataset: null, selectedVars: [], backendOnline: null, capabilities: {}, mapRequest: null }
function reducer(state, action) {
  switch (action.type) {
    case 'SET_BACKEND': return { ...state, backendOnline: action.online, capabilities: action.capabilities || {} }
    case 'ADD_DATASET': return { ...state, datasets: { ...state.datasets, [action.dataset.id]: action.dataset }, activeDataset: action.dataset.id }
    case 'REMOVE_DATASET': {
      const ds = { ...state.datasets }; delete ds[action.id]
      const rem = Object.keys(ds)
      return { ...state, datasets: ds, activeDataset: rem.includes(state.activeDataset) ? state.activeDataset : (rem[0] || null), selectedVars: state.selectedVars.filter(v => v.datasetId !== action.id) }
    }
    case 'SET_ACTIVE_DATASET': return { ...state, activeDataset: action.id }
    case 'UPDATE_DATASET': return { ...state, datasets: { ...state.datasets, [action.id]: { ...state.datasets[action.id], ...action.patch } } }
    case 'TOGGLE_VAR': {
      const key = `${action.datasetId}::${action.column}`
      const exists = state.selectedVars.find(v => v.datasetId === action.datasetId && v.column === action.column)
      if (exists) return { ...state, selectedVars: state.selectedVars.filter(v => !(v.datasetId === action.datasetId && v.column === action.column)) }
      return { ...state, selectedVars: [...state.selectedVars.slice(-7), { datasetId: action.datasetId, column: action.column, key }] }
    }
    case 'SET_VARS': return { ...state, selectedVars: (action.columns || []).map(column => ({ datasetId: action.datasetId, column, key: `${action.datasetId}::${column}` })) }
    case 'CLEAR_VARS': return { ...state, selectedVars: [] }
    // one-click "show this dataset on the map" — Cartography watches this and auto-adds a layer
    case 'REQUEST_MAP': return { ...state, mapRequest: { datasetId: action.datasetId, ts: Date.now() } }
    case 'CLEAR_MAP_REQUEST': return { ...state, mapRequest: null }
    default: return state
  }
}
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, init)
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}
export function useApp() { return useContext(Ctx) }
