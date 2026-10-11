// Node.js icon generator — TrustLayer AI branding
// Creates valid PNG files using only built-in modules (zlib + fs)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'icons');

function u32be(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
}

function chunk(type, data) {
    const typeB = Buffer.from(type, 'ascii');
    const lenB = u32be(data.length);
    const crcB = u32be(crc32(Buffer.concat([typeB, data])));
    return Buffer.concat([lenB, typeB, data, crcB]);
}

// CRC32 table
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function makePng(size) {
    // Build raw pixel rows (RGB, no alpha) — black bg, white T shape
    const rows = [];
    const s = size / 128;

    // T proportions (relative to 128px)
    const barX1 = Math.round(14 * s), barY1 = Math.round(20 * s);
    const barX2 = Math.round(114 * s), barY2 = Math.round(42 * s);
    const stemX1 = Math.round(50 * s), stemY1 = Math.round(42 * s);
    const stemX2 = Math.round(78 * s), stemY2 = Math.round(108 * s);

    for (let y = 0; y < size; y++) {
        const row = [0]; // filter byte = None
        for (let x = 0; x < size; x++) {
            const inBar = x >= barX1 && x < barX2 && y >= barY1 && y < barY2;
            const inStem = x >= stemX1 && x < stemX2 && y >= stemY1 && y < stemY2;
            const px = (inBar || inStem) ? 255 : 0;
            row.push(px, px, px); // RGB
        }
        rows.push(Buffer.from(row));
    }

    const raw = Buffer.concat(rows);
    const compressed = zlib.deflateSync(raw, { level: 9 });

    const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdr = chunk('IHDR', Buffer.concat([
        u32be(size), u32be(size),
        Buffer.from([8, 2, 0, 0, 0]) // 8-bit RGB
    ]));
    const idat = chunk('IDAT', compressed);
    const iend = chunk('IEND', Buffer.alloc(0));

    return Buffer.concat([sig, ihdr, idat, iend]);
}

[16, 48, 128].forEach(sz => {
    const data = makePng(sz);
    const out = path.join(OUT, `icon${sz}.png`);
    fs.writeFileSync(out, data);
    console.log(`✅ Created ${out} (${data.length} bytes)`);
});

console.log('All TrustLayer AI icons generated!');
