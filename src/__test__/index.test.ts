import { describe, expect, test } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import * as bmp from '../index.js';

const createPath = (p: string) => path.join(__dirname, p);
const readFile = (p: string) => fs.readFileSync(createPath(p));

const checksum = (str: Buffer, algorithm = 'md5', encoding = 'hex') =>
  crypto
    .createHash(algorithm)
    .update(str.toString(), 'utf8')
    // @ts-ignore
    .digest(encoding);

/** Build a BMP with a BITMAPINFOHEADER and an optional palette */
const createBmp = ({
  width,
  height,
  bitPP,
  compression = 0,
  palette = [],
  pixels,
}: {
  width: number;
  height: number;
  bitPP: number;
  compression?: number;
  palette?: number[];
  pixels: number[];
}) => {
  const offset = 14 + 40 + palette.length * 4;
  const buffer = Buffer.alloc(offset + pixels.length);

  buffer.write('BM', 0);
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(offset, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(bitPP, 28);
  buffer.writeUInt32LE(compression, 30);
  buffer.writeUInt32LE(pixels.length, 34);
  buffer.writeUInt32LE(palette.length, 46);
  palette.forEach((color, i) => buffer.writeUInt32LE(color, 54 + i * 4));
  buffer.set(pixels, offset);

  return buffer;
};

describe('decode', () => {
  const decodeTest =
    (bitPP: number | string, options = {}) =>
    () => {
      const buff = readFile(`./images/bit${bitPP}.bmp`);
      const { data } = bmp.decode(buff, options);
      expect(checksum(data)).toMatchSnapshot();
    };

  test('errors for non bmp files', () => {
    const buff = readFile('../../package.json');
    expect(() => bmp.decode(buff)).toThrow();
  });

  test('1-bit', decodeTest(1));

  describe('4-bit', () => {
    test('normal', decodeTest(4));
    test('RLE', decodeTest('4_RLE'));
  });

  describe('8-bit', () => {
    test('normal', decodeTest(8));
    test('RLE', decodeTest('8_RLE'));
  });

  describe('16-bit', () => {
    test('565', decodeTest('16_565'));
    test('a444', decodeTest('16_a444'));
    test('a555', decodeTest('16_a555'));
    test('x444', decodeTest('16_x444'));
    test('x555', decodeTest('16_x555'));
  });

  test('24-bit', decodeTest(24));

  test('reads pixel data from the header offset after the palette', () => {
    const original = readFile('./images/bit8.bmp');
    const originalOffset = original.readUInt32LE(10);
    const gap = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
    const withGap = Buffer.concat([
      original.subarray(0, originalOffset),
      gap,
      original.subarray(originalOffset),
    ]);

    withGap.writeUInt32LE(withGap.length, 2);
    withGap.writeUInt32LE(originalOffset + gap.length, 10);

    expect(bmp.decode(withGap).data).toEqual(bmp.decode(original).data);
  });

  describe('32-bit', () => {
    test('normal', decodeTest(32));
    test('alpha', decodeTest('32_alpha'));
    test('alpha - toRGBA', decodeTest('32_alpha', { toRGBA: true }));
  });
});

describe('encode', () => {
  const encodeTest =
    (bitPP: number, file = 32) =>
    () => {
      const buff = readFile(`./images/bit${file}.bmp`);
      const bitmap = bmp.decode(buff);

      bitmap.bitPP = bitPP;

      const { data } = bmp.encode(bitmap);
      expect(checksum(data)).toMatchSnapshot();
    };

  const errorTest = (bitPP: number) => () => {
    const buff = readFile('./images/bit32.bmp');
    const bitmap = bmp.decode(buff);

    bitmap.bitPP = bitPP;

    expect(() => bmp.encode(bitmap)).toThrow();
  };

  test('1-bit', encodeTest(1));

  describe('4-bit', () => {
    test('errors without color pallette', errorTest(4));
    test('works when colors provided', encodeTest(4, 4));
  });

  describe('8-bit', () => {
    test('errors without color pallette', errorTest(8));
    test('works when colors provided', encodeTest(8, 8));
  });

  test('16-bit', encodeTest(16));
  test('24-bit', encodeTest(24));
  test('32-bit', encodeTest(32));
});

describe('decode -> encode', () => {
  const compareDecodeEncode =
    (bitPP: number, file: number | string = bitPP) =>
    () => {
      const before = readFile(`./images/bit${file}.bmp`);
      const decoded = bmp.decode(before);

      decoded.bitPP = bitPP;

      const after = bmp.encode(decoded).data;

      expect(checksum(before)).toBe(checksum(after));
    };

  test('1-bit', compareDecodeEncode(1));
  test('4-bit', compareDecodeEncode(4));
  test('8-bit', compareDecodeEncode(8));
  test('16-bit', compareDecodeEncode(16, '16_x555'));
  test('24-bit', compareDecodeEncode(24));
  test('32-bit', compareDecodeEncode(32));
});

describe('decode pixels', () => {
  /** Count the pixels whose color differs, ignoring alpha */
  const countDifferentPixels = (a: Buffer, b: Buffer) => {
    let count = 0;

    for (let i = 0; i < a.length; i += 4) {
      if (a.compare(b, i, i + 4, i, i + 4) !== 0) {
        count++;
      }
    }

    return count;
  };

  describe.each([{ toRGBA: false }, { toRGBA: true }])('%o', (options) => {
    const decodeColors = (file: string) => {
      const { data } = bmp.decode(readFile(`./images/${file}.bmp`), options);
      const alpha = options.toRGBA ? 3 : 0;

      for (let i = alpha; i < data.length; i += 4) {
        data[i] = 0;
      }

      return data;
    };

    // Each image is compared with an uncompressed copy of itself
    test.each([
      ['1-bit with an odd width', 'odd_bit1', 'odd_bit1_bit24'],
      ['4-bit with an odd width', 'odd_bit4', 'odd_bit24'],
      ['RLE8 from ImageMagick', 'odd_bit8_RLE', 'odd_bit24'],
      ['RLE4 with deltas', 'bit4_RLE', 'bit4'],
      ['RLE8 with deltas', 'bit8_RLE', 'bit8'],
    ])('%s', (_, file, reference) => {
      const expected = decodeColors(reference);
      const actual = decodeColors(file);

      expect(actual.length).toBe(expected.length);
      expect(countDifferentPixels(actual, expected)).toBe(0);
    });
  });

  // White, red, green, blue
  const palette = [0xffffff, 0xff0000, 0x00ff00, 0x0000ff];

  /** Decode an image and turn each pixel back into its palette index */
  const decodeIndexes = (buffer: Buffer, toRGBA: boolean) => {
    const { width, height, data } = bmp.decode(buffer, { toRGBA });
    const [red, green, blue] = toRGBA ? [0, 1, 2] : [3, 2, 1];
    const rows: number[][] = [];

    for (let y = 0; y < height; y++) {
      const row: number[] = [];

      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const color =
          (data[i + red] << 16) | (data[i + green] << 8) | data[i + blue];
        row.push(palette.indexOf(color));
      }

      rows.push(row);
    }

    return rows;
  };

  test.each([false, true])('RLE4 (toRGBA: %s)', (toRGBA) => {
    const image = createBmp({
      width: 5,
      height: 3,
      bitPP: 4,
      compression: 2,
      palette,
      // Rows are stored bottom up
      pixels: [
        // 3 pixels alternating 1 and 2, then move right 1 and up 1
        ...[3, 0x12, 0, 2, 1, 1],
        // 1 pixel of 3, end of line
        ...[1, 0x30, 0, 0],
        // 3 literal pixels, then 2 pixels alternating 3 and 0
        ...[0, 3, 0x31, 0x20, 2, 0x30],
        // end of bitmap
        ...[0, 1],
      ],
    });

    // Skipped pixels get palette color 0
    expect(decodeIndexes(image, toRGBA)).toEqual([
      [3, 1, 2, 3, 0],
      [0, 0, 0, 0, 3],
      [1, 2, 1, 0, 0],
    ]);
  });

  test.each([false, true])('RLE8 (toRGBA: %s)', (toRGBA) => {
    const image = createBmp({
      width: 4,
      height: 3,
      bitPP: 8,
      compression: 1,
      palette,
      pixels: [
        // 3 literal pixels and a padding byte, then 1 pixel of 1, end of line
        ...[0, 3, 1, 2, 3, 0, 1, 1, 0, 0],
        // Move right 2 and up 1, then 2 pixels of 3, end of bitmap
        ...[0, 2, 2, 1, 2, 3, 0, 1],
      ],
    });

    expect(decodeIndexes(image, toRGBA)).toEqual([
      [0, 0, 3, 3],
      [0, 0, 0, 0],
      [1, 2, 3, 1],
    ]);
  });
});

describe('decode validation', () => {
  test('rejects an RLE8 image whose dimensions do not fit its data', () => {
    // The header claims 10000x10000 but there is no pixel data at all
    const crafted = createBmp({
      width: 10_000,
      height: 10_000,
      bitPP: 8,
      compression: 1,
      palette: new Array(256).fill(0),
      pixels: [],
    });

    expect(() => bmp.decode(crafted)).toThrow(
      'BMP data is too short for an RLE image of 10000x10000',
    );
  });

  test('rejects an RLE4 image whose dimensions do not fit its data', () => {
    const crafted = createBmp({
      width: 10_000,
      height: 10_000,
      bitPP: 4,
      compression: 2,
      palette: new Array(16).fill(0),
      pixels: [0, 1],
    });

    expect(() => bmp.decode(crafted)).toThrow(
      'BMP data is too short for an RLE image of 10000x10000',
    );
  });

  test('decodes a small RLE8 image', () => {
    const { width, height, data } = bmp.decode(
      createBmp({
        width: 4,
        height: 2,
        bitPP: 8,
        compression: 1,
        palette: [0x000000, 0xff0000],
        // 4 x color 1, end of line, 4 x color 0, end of bitmap
        pixels: [4, 1, 0, 0, 4, 0, 0, 1],
      }),
    );

    expect([width, height, data.length]).toEqual([4, 2, 32]);
  });

  test('rejects an uncompressed image whose dimensions do not fit its data', () => {
    const crafted = createBmp({
      width: 5000,
      height: 5000,
      bitPP: 24,
      pixels: [0, 0, 0, 0],
    });

    expect(() => bmp.decode(crafted)).toThrow(
      'BMP data is too short for an image of 5000x5000 at 24 bits per pixel',
    );
  });

  test('rejects an image missing its last row', () => {
    const crafted = createBmp({
      width: 2,
      height: 2,
      bitPP: 24,
      pixels: [0xff, 0, 0, 0, 0xff, 0, 0, 0],
    });

    expect(() => bmp.decode(crafted)).toThrow(
      'BMP data is too short for an image of 2x2 at 24 bits per pixel',
    );
  });

  test('allows the last row to be missing its padding', () => {
    const { data } = bmp.decode(
      createBmp({
        width: 2,
        height: 2,
        bitPP: 24,
        pixels: [0xff, 0, 0, 0, 0xff, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff],
      }),
    );

    expect(data.length).toBe(16);
  });

  test('rejects images larger than the maximum resolution', () => {
    const crafted = createBmp({
      width: 0x7fffffff,
      height: 0x7fffffff,
      bitPP: 32,
      pixels: [],
    });

    expect(() => bmp.decode(crafted)).toThrow(
      'exceed the maximum resolution of 100 megapixels',
    );
  });

  test('maxResolutionInMP can be configured', () => {
    const buffer = createBmp({
      width: 2,
      height: 2,
      bitPP: 32,
      pixels: new Array(16).fill(0xff),
    });

    expect(() => bmp.decode(buffer, { maxResolutionInMP: 0.000003 })).toThrow(
      'exceed the maximum resolution of 0.000003 megapixels',
    );
    expect(bmp.decode(buffer, { maxResolutionInMP: 0.00001 }).width).toBe(2);
  });

  test.each([
    [0, 10, '0x10'],
    [10, 0, '10x0'],
    [-10, 10, '4294967286x10'],
  ])('rejects dimensions %ix%i', (width, height, message) => {
    const crafted = createBmp({ width, height, bitPP: 24, pixels: [] });

    expect(() => bmp.decode(crafted)).toThrow(
      `Invalid BMP dimensions ${message}`,
    );
  });

  test('rejects unsupported bit depths', () => {
    const crafted = createBmp({
      width: 1,
      height: 1,
      bitPP: 64,
      pixels: [0, 0, 0, 0],
    });

    expect(() => bmp.decode(crafted)).toThrow('Unsupported BMP bit depth 64');
  });
});
