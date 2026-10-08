// Minimal ZIP writer (stored / no compression).
//
// A shapefile is a *set* of files (.shp + .shx + .dbf + .prj + .cpg) that
// only makes sense together, but the upload endpoint takes one file per
// request. Rather than adding a zip dependency, bundle the parts the user
// selected together into a plain stored zip — the backend's zip path
// already knows how to open it. Shapefile parts are small (the .shp of a
// classroom dataset is rarely more than a few MB), so skipping
// compression costs little.

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes) {
  let crc = -1
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

/** files: [{name, blob}] → Blob (application/zip) with stored entries. */
export async function zipStore(files) {
  const enc = new TextEncoder()
  const chunks = []
  const central = []
  let offset = 0
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer())
    const nameBytes = enc.encode(f.name)
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true) // local file header signature
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 filename flag
    local.setUint16(8, 0, true) // method: stored
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    chunks.push(new Uint8Array(local.buffer), nameBytes, data)

    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true) // central directory signature
    cen.setUint16(4, 20, true) // version made by
    cen.setUint16(6, 20, true) // version needed
    cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, 0, true) // method: stored
    cen.setUint32(16, crc, true)
    cen.setUint32(20, data.length, true)
    cen.setUint32(24, data.length, true)
    cen.setUint16(28, nameBytes.length, true)
    cen.setUint32(42, offset, true) // local header offset
    central.push(new Uint8Array(cen.buffer), nameBytes)

    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true) // end of central directory
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
    type: 'application/zip',
  })
}
