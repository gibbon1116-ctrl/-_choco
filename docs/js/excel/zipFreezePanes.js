const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

function uint16(view, offset) {
  return view.getUint16(offset, true);
}

function uint32(view, offset) {
  return view.getUint32(offset, true);
}

function setUint16(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function setUint32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function concatenate(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function endOffset(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65_557); offset -= 1) {
    if (uint32(view, offset) === END_SIGNATURE) return offset;
  }
  throw new Error("ExcelファイルのZIP終端を読み取れませんでした。");
}

function centralEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endOffset(bytes);
  const count = uint16(view, end + 10);
  let offset = uint32(view, end + 16);
  const decoder = new TextDecoder();
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (uint32(view, offset) !== CENTRAL_FILE_SIGNATURE) throw new Error("ExcelファイルのZIP索引を読み取れませんでした。");
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const length = 46 + nameLength + extraLength + commentLength;
    entries.push({
      name: decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)),
      central: bytes.slice(offset, offset + length),
      flags: uint16(view, offset + 8),
      method: uint16(view, offset + 10),
      crc: uint32(view, offset + 16),
      compressedSize: uint32(view, offset + 20),
      uncompressedSize: uint32(view, offset + 24),
      localOffset: uint32(view, offset + 42),
    });
    offset += length;
  }
  return entries;
}

async function transform(bytes, stream) {
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function crcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let result = value;
    for (let bit = 0; bit < 8; bit += 1) result = (result & 1) ? (0xedb88320 ^ (result >>> 1)) : (result >>> 1);
    return result >>> 0;
  });
}

const CRC_TABLE = crcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paneXml(freeze) {
  const attributes = [
    freeze.xSplit ? `xSplit="${Number(freeze.xSplit)}"` : "",
    freeze.ySplit ? `ySplit="${Number(freeze.ySplit)}"` : "",
    freeze.topLeftCell ? `topLeftCell="${freeze.topLeftCell}"` : "",
    freeze.activePane ? `activePane="${freeze.activePane}"` : "",
    `state="${freeze.state || "frozen"}"`,
  ].filter(Boolean).join(" ");
  return `<pane ${attributes}/>`;
}

function addSheetViewSettings(xml, settings) {
  const pane = settings.freeze ? paneXml(settings.freeze) : "";
  return xml.replace(
    /<sheetViews><sheetView([^>]*)\/><\/sheetViews>/,
    (_, attributes) => {
      const gridlineAttribute = settings.showGridLines === false && !attributes.includes("showGridLines")
        ? ' showGridLines="0"'
        : "";
      return `<sheetViews><sheetView${attributes}${gridlineAttribute}>${pane}</sheetView></sheetViews>`;
    },
  );
}

async function entryPayload(bytes, entry, sheetViewSettings) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (uint32(view, entry.localOffset) !== LOCAL_FILE_SIGNATURE) throw new Error("ExcelファイルのZIPデータを読み取れませんでした。");
  const nameLength = uint16(view, entry.localOffset + 26);
  const extraLength = uint16(view, entry.localOffset + 28);
  const headerLength = 30 + nameLength + extraLength;
  const header = bytes.slice(entry.localOffset, entry.localOffset + headerLength);
  let compressed = bytes.slice(
    entry.localOffset + headerLength,
    entry.localOffset + headerLength + entry.compressedSize,
  );
  let uncompressedSize = entry.uncompressedSize;
  let crc = entry.crc;
  if (sheetViewSettings) {
    if (![0, 8].includes(entry.method)) throw new Error(`未対応のZIP圧縮方式です: ${entry.method}`);
    let plain = entry.method === 8
      ? await transform(compressed, new DecompressionStream("deflate-raw"))
      : compressed;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    plain = encoder.encode(addSheetViewSettings(decoder.decode(plain), sheetViewSettings));
    compressed = entry.method === 8
      ? await transform(plain, new CompressionStream("deflate-raw"))
      : plain;
    uncompressedSize = plain.byteLength;
    crc = crc32(plain);
  }
  const flags = entry.flags & ~0x0008;
  setUint16(header, 6, flags);
  setUint32(header, 14, crc);
  setUint32(header, 18, compressed.byteLength);
  setUint32(header, 22, uncompressedSize);
  return { header, compressed, flags, crc, uncompressedSize };
}

export async function freezePanesInXlsx(arrayBuffer, workbook) {
  const settingsByName = new Map(workbook.SheetNames.map((name, index) => [
    `xl/worksheets/sheet${index + 1}.xml`,
    {
      freeze: workbook.Sheets[name]?.["!freeze"] ?? null,
      showGridLines: workbook.Sheets[name]?.["!gridlines"],
    },
  ]));
  if (![...settingsByName.values()].some((settings) => settings.freeze || settings.showGridLines === false)) return arrayBuffer;
  if (!globalThis.CompressionStream || !globalThis.DecompressionStream) {
    throw new Error("このブラウザはExcelの固定ウィンドウ設定に必要な圧縮APIに対応していません。");
  }

  const source = new Uint8Array(arrayBuffer);
  const entries = centralEntries(source);
  const localParts = [];
  const rebuiltEntries = [];
  let localOffset = 0;
  for (const entry of entries) {
    const settings = settingsByName.get(entry.name);
    const payload = await entryPayload(
      source,
      entry,
      settings && (settings.freeze || settings.showGridLines === false) ? settings : null,
    );
    localParts.push(payload.header, payload.compressed);
    rebuiltEntries.push({ ...entry, ...payload, localOffset, compressedSize: payload.compressed.byteLength });
    localOffset += payload.header.byteLength + payload.compressed.byteLength;
  }

  const centralParts = [];
  for (const entry of rebuiltEntries) {
    const central = entry.central.slice();
    setUint16(central, 8, entry.flags);
    setUint32(central, 16, entry.crc);
    setUint32(central, 20, entry.compressedSize);
    setUint32(central, 24, entry.uncompressedSize);
    setUint32(central, 42, entry.localOffset);
    centralParts.push(central);
  }
  const central = concatenate(centralParts);
  const end = new Uint8Array(22);
  setUint32(end, 0, END_SIGNATURE);
  setUint16(end, 8, entries.length);
  setUint16(end, 10, entries.length);
  setUint32(end, 12, central.byteLength);
  setUint32(end, 16, localOffset);
  return concatenate([...localParts, central, end]).buffer;
}
