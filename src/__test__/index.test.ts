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

/**
 * Build a BMP with a BITMAPINFOHEADER, an optional palette and optional
 * bytes between the palette and the pixel data
 */
const createBmp = ({
  width,
  height,
  bitPP,
  compression = 0,
  palette = [],
  gap = [],
  pixels,
}: {
  width: number;
  height: number;
  bitPP: number;
  compression?: number;
  palette?: number[];
  gap?: number[];
  pixels: number[];
}) => {
  const offset = 14 + 40 + palette.length * 4 + gap.length;
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
  buffer.set(gap, offset - gap.length);
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

describe('pixel data offset', () => {
  // End of bitmap codes, so an RLE decoder that reads them stops early
  const gap = [0, 1, 0, 1, 0, 1, 0, 1];
  const palette = [0x000000, 0xff0000, 0x00ff00, 0x0000ff];

  const images = [
    {
      width: 3,
      height: 2,
      bitPP: 24,
      pixels: Array.from({ length: 24 }, (_, i) => i * 10),
    },
    {
      width: 4,
      height: 2,
      bitPP: 8,
      compression: 1,
      palette,
      // 4 x color 1, end of line, 2 x color 2, 2 x color 3, end of bitmap
      pixels: [4, 1, 0, 0, 2, 2, 2, 3, 0, 1],
    },
    {
      width: 4,
      height: 2,
      bitPP: 4,
      compression: 2,
      palette,
      // 4 pixels alternating 1 and 2, end of line, 4 x color 3, end of bitmap
      pixels: [4, 0x12, 0, 0, 4, 0x33, 0, 1],
    },
  ];

  test.each([
    ['24-bit', images[0]],
    ['RLE8', images[1]],
    ['RLE4', images[2]],
  ])('skips bytes before the pixel data of a %s image', (_, image) => {
    const expected = bmp.decode(createBmp(image)).data;

    expect(bmp.decode(createBmp({ ...image, gap })).data).toEqual(expected);
  });

  test.each([
    ['24-bit', images[0]],
    ['RLE8', images[1]],
    ['RLE4', images[2]],
  ])('rejects an offset past the end of a %s image', (_, image) => {
    const buffer = createBmp(image);

    buffer.writeUInt32LE(buffer.length + 1, 10);
    expect(() => bmp.decode(buffer)).toThrow(
      `BMP pixel data offset ${buffer.length + 1} is past the end of the file`,
    );

    buffer.writeUInt32LE(0xffffffff, 10);
    expect(() => bmp.decode(buffer)).toThrow(
      'BMP pixel data offset 4294967295 is past the end of the file',
    );
  });

  test('reads pixel data after the palette when the offset points inside the headers', () => {
    const buffer = createBmp(images[1]);
    const expected = bmp.decode(buffer).data;

    buffer.writeUInt32LE(0, 10);
    expect(bmp.decode(buffer).data).toEqual(expected);
  });
});

describe('encode palette images', () => {
  type Rgb = [number, number, number];

  const toColor = ([red, green, blue]: Rgb, quad = 0) => ({
    red,
    green,
    blue,
    quad,
  });

  /** Build ABGR pixel data, which is what encode expects */
  const createData = (pixels: Rgb[], alpha = 0xff) => {
    const data = Buffer.alloc(pixels.length * 4);

    pixels.forEach(([red, green, blue], i) => {
      data[i * 4] = alpha;
      data[i * 4 + 1] = blue;
      data[i * 4 + 2] = green;
      data[i * 4 + 3] = red;
    });

    return data;
  };

  /** Decode an image to a list of RGB colors */
  const decodePixels = (buffer: Buffer) => {
    const { data } = bmp.decode(buffer, { toRGBA: true });
    const pixels: Rgb[] = [];

    for (let i = 0; i < data.length; i += 4) {
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }

    return pixels;
  };

  /** A different color for every index */
  const createPalette = (length: number) =>
    Array.from({ length }, (_, i): Rgb => [i, 255 - i, (i * 7) % 256]);

  test.each([
    [4, 16],
    [8, 256],
  ])('%i-bit uses up to %i palette colors', (bitPP, length) => {
    const palette = createPalette(length);
    const encoded = bmp.encode({
      data: createData(palette),
      width: length,
      height: 1,
      bitPP,
      palette: palette.map((color) => toColor(color)),
    });
    const decoded = bmp.decode(encoded.data);

    expect(decoded.colors).toBe(length);
    expect(decoded.palette).toHaveLength(length);
    expect(decodePixels(encoded.data)).toEqual(palette);
  });

  test.each([1, 4, 8])(
    '%i-bit only writes as many colors as the palette has',
    (bitPP) => {
      const palette: Rgb[] = [
        [0, 0, 0],
        [255, 255, 255],
      ];
      const encoded = bmp.encode({
        data: createData([palette[1], palette[0]]),
        width: 2,
        height: 1,
        bitPP,
        palette: palette.map((color) => toColor(color)),
      });

      expect(bmp.decode(encoded.data).colors).toBe(2);
      expect(decodePixels(encoded.data)).toEqual([palette[1], palette[0]]);
    },
  );

  test.each([
    [4, 16],
    [8, 256],
  ])('%i-bit asks for a palette of up to %i colors', (bitPP, length) => {
    expect(() =>
      bmp.encode({ data: createData([[0, 0, 0]]), width: 1, height: 1, bitPP }),
    ).toThrow(
      `To encode ${bitPP}-bit BMPs a palette is needed. Please choose up to ${length} colors.`,
    );
  });

  test.each([1, 4, 8])(
    '%i-bit uses the nearest palette color for other colors',
    (bitPP) => {
      const palette: Rgb[] = [
        [255, 255, 255],
        [0, 0, 0],
      ];
      const encoded = bmp.encode({
        data: createData([
          [10, 20, 30],
          [240, 230, 220],
          [200, 40, 40],
          [100, 100, 100],
        ]),
        width: 4,
        height: 1,
        bitPP,
        palette: palette.map((color) => toColor(color)),
      });

      expect(decodePixels(encoded.data)).toEqual([
        [0, 0, 0],
        [255, 255, 255],
        [0, 0, 0],
        [0, 0, 0],
      ]);
    },
  );

  test('matches colors whatever their alpha or the palette quad', () => {
    const palette: Rgb[] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];
    const pixels = [palette[2], palette[1], palette[0]];
    const encoded = bmp.encode({
      data: createData(pixels, 0x80),
      width: 3,
      height: 1,
      bitPP: 8,
      palette: palette.map((color) => toColor(color, 0)),
    });

    expect(decodePixels(encoded.data)).toEqual(pixels);
  });

  test.each([1, 4, 8])('%i-bit allows a palette quad of 255', (bitPP) => {
    const palette: Rgb[] = [
      [255, 255, 255],
      [0, 0, 0],
    ];
    const encoded = bmp.encode({
      data: createData(palette),
      width: 2,
      height: 1,
      bitPP,
      palette: palette.map((color) => toColor(color, 255)),
    });

    expect(bmp.decode(encoded.data).palette[0]).toEqual(
      toColor(palette[0], 255),
    );
    expect(decodePixels(encoded.data)).toEqual(palette);
  });

  describe.each([1, 4, 8])(
    '%i-bit with a width that is not byte aligned',
    (bitPP) => {
      test.each([
        [13, 5],
        [10, 3],
        [3, 2],
        [1, 1],
      ])('%ix%i', (width, height) => {
        const palette: Rgb[] = [
          [255, 255, 255],
          [0, 0, 0],
        ];
        // An uneven pattern, so pixels that end up in the wrong place show
        const pixels = Array.from(
          { length: width * height },
          (_, i) => palette[(i * i + Math.floor(i / 3)) % 2],
        );
        const encoded = bmp.encode({
          data: createData(pixels),
          width,
          height,
          bitPP,
          palette: palette.map((color) => toColor(color)),
        });

        expect(decodePixels(encoded.data)).toEqual(pixels);
      });
    },
  );

  test('1-bit without a palette is black and white', () => {
    const pixels: Rgb[] = Array.from({ length: 13 * 3 }, (_, i) =>
      i % 3 ? [255, 255, 255] : [0, 0, 0],
    );
    const encoded = bmp.encode({
      data: createData(pixels),
      width: 13,
      height: 3,
      bitPP: 1,
    });

    expect(decodePixels(encoded.data)).toEqual(pixels);
  });

  test('writes the reserved fields where the decoder reads them', () => {
    const encoded = bmp.encode({
      data: createData([[0, 0, 0]]),
      width: 1,
      height: 1,
      reserved1: 0x1234,
      reserved2: 0xfedc,
    });
    const decoded = bmp.decode(encoded.data);

    expect(decoded.reserved1).toBe(0x1234);
    expect(decoded.reserved2).toBe(0xfedc);
  });
});
