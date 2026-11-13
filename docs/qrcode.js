/**
 * Self-contained ISO/IEC 18004 QR Code SVG Generator (Versions 1-6, ECC Level L)
 * Zero external dependencies — works 100% offline on mobile hotspots.
 */
(function (global) {
  'use strict';

  // Version capacities for ECC Level L (single RS block for V1..V5, 2 blocks for V6)
  // Using V1-L..V5-L covers up to 106 UTF-8 bytes with a single Reed-Solomon block!
  const VERSIONS_L = [
    null,
    { v: 1, size: 21, total: 26, ec: 7, data: 19, align: [] },
    { v: 2, size: 25, total: 44, ec: 10, data: 34, align: [6, 18] },
    { v: 3, size: 29, total: 70, ec: 15, data: 55, align: [6, 22] },
    { v: 4, size: 33, total: 100, ec: 20, data: 80, align: [6, 26] },
    { v: 5, size: 37, total: 134, ec: 26, data: 108, align: [6, 30] }
  ];

  // GF(256) log/exp tables with primitive polynomial 0x11d
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      EXP[i] = EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly; // poly[0] === 1
  }

  function rsEncode(dataBytes, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const rem = new Uint8Array(ecLen);
    for (let i = 0; i < dataBytes.length; i++) {
      const factor = dataBytes[i] ^ rem[0];
      for (let j = 0; j < ecLen - 1; j++) {
        rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
      }
      rem[ecLen - 1] = gfMul(gen[ecLen], factor);
    }
    return rem;
  }

  function computeFormatBits(eccLevelBits, mask) {
    const data = (eccLevelBits << 3) | mask;
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) {
      if ((rem >> i) & 1) {
        rem ^= 0x537 << (i - 10);
      }
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function maskFn(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0;
      case 7: return ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0;
      default: return false;
    }
  }

  function penaltyScore(modules, size) {
    let score = 0;
    // Rule 1: 5+ consecutive modules in row/col
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (modules[r][c] === modules[r][c - 1]) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runLen = 1;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (modules[r][c] === modules[r - 1][c]) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runLen = 1;
        }
      }
    }
    // Rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = modules[r][c];
        if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
          score += 3;
        }
      }
    }
    return score;
  }

  function encodeMatrix(text) {
    const utf8 = new TextEncoder().encode(String(text));
    let spec = null;
    for (let v = 1; v <= 5; v++) {
      // Byte mode overhead: 4 bits mode + 8 bits len + 8*N bits <= data*8
      if (utf8.length + 2 <= VERSIONS_L[v].data) {
        spec = VERSIONS_L[v];
        break;
      }
    }
    if (!spec) {
      throw new Error('QR text too long (max 106 bytes)');
    }

    // Build bit buffer
    const bits = [];
    function pushBits(val, count) {
      for (let i = count - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    }
    pushBits(0b0100, 4); // Byte mode
    pushBits(utf8.length, 8); // 8-bit count for V1..V9
    for (let i = 0; i < utf8.length; i++) {
      pushBits(utf8[i], 8);
    }
    const maxDataBits = spec.data * 8;
    const term = Math.min(4, maxDataBits - bits.length);
    pushBits(0, term);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = new Uint8Array(spec.data);
    for (let i = 0; i < bits.length / 8; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
      dataCodewords[i] = byte;
    }
    const padBytes = [0xec, 0x11];
    for (let i = bits.length / 8, p = 0; i < spec.data; i++, p++) {
      dataCodewords[i] = padBytes[p & 1];
    }

    const ecCodewords = rsEncode(dataCodewords, spec.ec);
    const allCodewords = new Uint8Array(spec.total);
    allCodewords.set(dataCodewords, 0);
    allCodewords.set(ecCodewords, spec.data);

    const size = spec.size;
    const base = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    function setFunc(r, c, dark) {
      if (r < 0 || r >= size || c < 0 || c >= size) return;
      base[r][c] = dark ? 1 : 0;
      isFunc[r][c] = 1;
    }

    function placeFinder(topR, leftC) {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = topR + dr;
          const c = leftC + dc;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setFunc(r, c, inOuter && (onBorder || inCenter));
        }
      }
    }

    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    // Alignment patterns
    if (spec.align.length > 0) {
      for (const ar of spec.align) {
        for (const ac of spec.align) {
          if (
            (ar === 6 && ac === 6) ||
            (ar === 6 && ac === size - 7) ||
            (ar === size - 7 && ac === 6)
          ) {
            continue;
          }
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const dist = Math.max(Math.abs(dr), Math.abs(dc));
              setFunc(ar + dr, ac + dc, dist !== 1);
            }
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (!isFunc[6][i]) setFunc(6, i, i % 2 === 0);
      if (!isFunc[i][6]) setFunc(i, 6, i % 2 === 0);
    }

    // Reserve format areas & dark module
    for (let i = 0; i <= 8; i++) {
      if (!isFunc[8][i]) setFunc(8, i, false);
      if (!isFunc[i][8]) setFunc(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      setFunc(8, size - 1 - i, false);
    }
    for (let i = 0; i < 7; i++) {
      setFunc(size - 1 - i, 8, false);
    }
    setFunc(size - 8, 8, true); // Fixed dark module

    // Zig-zag data placement
    let bitIdx = 0;
    const totalBits = allCodewords.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunc[r][c]) {
            let dark = 0;
            if (bitIdx < totalBits) {
              dark = (allCodewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            base[r][c] = dark;
          }
        }
      }
      upward = !upward;
    }

    function writeFormatBits(mat, mask) {
      // ECC Level L = 0b01
      const fmt = computeFormatBits(0b01, mask);
      const getBit = (i) => (fmt >> i) & 1;

      // Top-left copy (MSB 14 -> LSB 0)
      const tlCoords = [
        [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
        [8, 7], [8, 8], [7, 8],
        [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
      ];
      for (let idx = 0; idx < 15; idx++) {
        const [r, c] = tlCoords[idx];
        mat[r][c] = getBit(14 - idx);
      }

      // Split copy: bits 14..8 along bottom-left col 8, bits 7..0 along top-right row 8
      for (let idx = 0; idx < 7; idx++) {
        mat[size - 1 - idx][8] = getBit(14 - idx);
      }
      for (let idx = 0; idx < 8; idx++) {
        mat[8][size - 8 + idx] = getBit(7 - idx);
      }
    }

    // Pick lowest penalty mask
    let bestMat = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const candidate = base.map((row) => Uint8Array.from(row));
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!isFunc[r][c] && maskFn(mask, r, c)) {
            candidate[r][c] ^= 1;
          }
        }
      }
      writeFormatBits(candidate, mask);
      const s = penaltyScore(candidate, size);
      if (s < bestScore) {
        bestScore = s;
        bestMat = candidate;
      }
    }

    return { size, modules: bestMat };
  }

  function renderSVG(text, opts) {
    const options = Object.assign({ margin: 3, dark: '#11131c', light: '#ffffff' }, opts || {});
    const { size, modules } = encodeMatrix(text);
    const total = size + options.margin * 2;
    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modules[r][c]) {
          path += `M${c + options.margin},${r + options.margin}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR Code for ${String(text).replace(/"/g, '&quot;')}"><rect width="${total}" height="${total}" rx="2" fill="${options.light}"/><path d="${path}" fill="${options.dark}"/></svg>`;
  }

  global.QRCodeSVG = { encodeMatrix, renderSVG };
})(typeof window !== 'undefined' ? window : globalThis);
