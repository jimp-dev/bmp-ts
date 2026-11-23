/// <reference types="node" preserve="true" />
import HeaderTypes from './header-types.js';
import { BmpColor, BmpImage } from './types.js';

type IColorProcessor = (p: number, i: number, x: number, y: number) => number;

function createInteger(numbers: number[]) {
  return numbers.reduce((final, n) => (final << 1) | n, 0);
}

function createColor(color: BmpColor): number {
  // >>> 0 keeps the color unsigned when the quad is 128 or more
  return (
    ((color.quad << 24) |
      (color.red << 16) |
      (color.green << 8) |
      color.blue) >>>
    0
  );
}

/**
 * Find the palette index of a color. Colors that aren't in the palette use
 * the nearest palette color. Alpha and the palette's quad are ignored.
 */
function createPaletteLookup(palette: BmpColor[]) {
  const cache = new Map<number, number>();

  return (red: number, green: number, blue: number) => {
    const key = (red << 16) | (green << 8) | blue;
    let index = cache.get(key);

    if (index === undefined) {
      let nearest = Infinity;

      index = 0;

      for (let i = 0; i < palette.length && nearest > 0; i++) {
        const distance =
          (palette[i].red - red) ** 2 +
          (palette[i].green - green) ** 2 +
          (palette[i].blue - blue) ** 2;

        if (distance < nearest) {
          nearest = distance;
          index = i;
        }
      }

      cache.set(key, index);
    }

    return index;
  };
}

export default class BmpEncoder implements BmpImage {
  public readonly fileSize: number;
  public readonly reserved1: number;
  public readonly reserved2: number;
  public readonly offset: number;
  public readonly width: number;
  public readonly flag: string;
  public readonly height: number;
  public readonly planes: number;
  public readonly bitPP: number;
  public readonly compress: number;
  public readonly hr: number;
  public readonly vr: number;
  public readonly colors: number;
  public readonly importantColors: number;
  public readonly rawSize: number;
  public readonly headerSize: number;
  public readonly data: Buffer;
  public readonly palette: BmpColor[];

  private readonly extraBytes: number;
  private readonly buffer: Buffer;
  private readonly bytesInColor: number;
  private pos: number;

  constructor(imgData: BmpImage) {
    this.buffer = imgData.data;
    this.width = imgData.width;
    this.height = imgData.height;
    this.headerSize = HeaderTypes.BITMAP_INFO_HEADER;

    // Header
    this.flag = 'BM';
    this.bitPP = imgData.bitPP || 24;
    this.offset = 54;
    this.reserved1 = imgData.reserved1 || 0;
    this.reserved2 = imgData.reserved2 || 0;
    this.planes = 1;
    this.compress = 0;
    this.hr = imgData.hr || 0;
    this.vr = imgData.vr || 0;
    this.importantColors = imgData.importantColors || 0;
    this.palette = imgData.palette || [];

    if (this.bitPP === 1 || this.bitPP === 4 || this.bitPP === 8) {
      // Without a palette 1-bit images are black and white
      const maxColors = this.palette.length
        ? Math.min(2 ** this.bitPP, this.palette.length)
        : 2;

      this.colors = Math.min(maxColors, imgData.colors || maxColors);
      this.offset += this.colors * 4;
    } else {
      this.colors = 0;
    }

    switch (this.bitPP) {
      case 32:
        this.bytesInColor = 4;
        break;
      case 16:
        this.bytesInColor = 2;
        break;
      case 8:
        this.bytesInColor = 1;
        break;
      case 4:
        this.bytesInColor = 1 / 2;
        break;
      case 1:
        this.bytesInColor = 1 / 8;
        break;
      default:
        this.bytesInColor = 3;
        this.bitPP = 24;
    }

    const rowWidth = (this.width * this.bitPP) / 32;
    const rowBytes = Math.ceil(rowWidth);

    this.extraBytes = (rowBytes - rowWidth) * 4;
    // Why 2?
    this.rawSize = this.height * rowBytes * 4 + 2;
    this.fileSize = this.rawSize + this.offset;
    this.data = Buffer.alloc(this.fileSize, 0x1);
    this.pos = 0;

    this.encode();
  }

  public encode() {
    this.pos = 0;

    this.writeHeader();

    switch (this.bitPP) {
      case 32:
        this.bit32();
        break;
      case 16:
        this.bit16();
        break;
      case 8:
        this.bit8();
        break;
      case 4:
        this.bit4();
        break;
      case 1:
        this.bit1();
        break;
      default:
        this.bit24();
    }
  }

  private writeHeader() {
    this.data.write(this.flag, this.pos, 2);
    this.pos += 2;

    this.writeUInt32LE(this.fileSize);

    this.data.writeUInt16LE(this.reserved1, this.pos);
    this.pos += 2;
    this.data.writeUInt16LE(this.reserved2, this.pos);
    this.pos += 2;

    this.writeUInt32LE(this.offset);
    this.writeUInt32LE(this.headerSize);
    this.writeUInt32LE(this.width);
    this.writeUInt32LE(this.height);

    this.data.writeUInt16LE(this.planes, this.pos);
    this.pos += 2;

    this.data.writeUInt16LE(this.bitPP, this.pos);
    this.pos += 2;

    this.writeUInt32LE(this.compress);
    this.writeUInt32LE(this.rawSize);
    this.writeUInt32LE(this.hr);
    this.writeUInt32LE(this.vr);
    this.writeUInt32LE(this.colors);
    this.writeUInt32LE(this.importantColors);
  }

  private bit1() {
    let getIndex: (red: number, green: number, blue: number) => number;

    if (this.palette.length) {
      getIndex = this.initColors(1);
    } else {
      this.writeUInt32LE(0x00ffffff); // White
      this.writeUInt32LE(0x00000000); // Black
      getIndex = (red, green, blue) =>
        red * 0.2126 + green * 0.7152 + blue * 0.0722 > 127 ? 0 : 1;
    }

    this.pos += 1; // ?

    let lineArr: number[] = [];

    this.writeImage((p, index, x) => {
      let i = index;

      i++;
      const b = this.buffer[i++];
      const g = this.buffer[i++];
      const r = this.buffer[i++];

      lineArr.push(getIndex(r, g, b));

      if ((x + 1) % 8 === 0) {
        this.data[p - 1] = createInteger(lineArr);
        lineArr = [];
      } else if (x === this.width - 1 && lineArr.length > 0) {
        // The last pixels of a row go in the high bits of its last byte
        this.data[p - 1] = createInteger(lineArr) << (8 - lineArr.length);
        lineArr = [];
      }

      return i;
    });
  }

  private bit4() {
    const getIndex = this.initColors(4);

    let integerPair: number[] = [];

    this.writeImage((p, index, x) => {
      const i = index + 1;

      integerPair.push(
        getIndex(this.buffer[i + 2], this.buffer[i + 1], this.buffer[i]),
      );

      if ((x + 1) % 2 === 0) {
        this.data[p] = (integerPair[0] << 4) | integerPair[1];
        integerPair = [];
      } else if (x === this.width - 1) {
        // An odd width leaves the low half of the row's last byte empty
        this.data[p] = integerPair[0] << 4;
        integerPair = [];
      }

      return i + 3;
    });
  }

  private bit8() {
    const getIndex = this.initColors(8);

    this.writeImage((p, index) => {
      const i = index + 1;

      this.data[p] = getIndex(
        this.buffer[i + 2],
        this.buffer[i + 1],
        this.buffer[i],
      );

      return i + 3;
    });
  }

  private bit16() {
    this.writeImage((p, index) => {
      let i = index + 1;

      const b = this.buffer[i++] / 8; // b
      const g = this.buffer[i++] / 8; // g
      const r = this.buffer[i++] / 8; // r

      const color = (r << 10) | (g << 5) | b;

      this.data[p] = color & 0x00ff;
      this.data[p + 1] = (color & 0xff00) >> 8;

      return i;
    });
  }

  private bit24() {
    this.writeImage((p, index) => {
      let i = index + 1;

      this.data[p] = this.buffer[i++]; //b
      this.data[p + 1] = this.buffer[i++]; //g
      this.data[p + 2] = this.buffer[i++]; //r

      return i;
    });
  }

  private bit32() {
    this.writeImage((p, index) => {
      let i = index;

      this.data[p + 3] = this.buffer[i++]; // a
      this.data[p] = this.buffer[i++]; // b
      this.data[p + 1] = this.buffer[i++]; // g
      this.data[p + 2] = this.buffer[i++]; // r

      return i;
    });
  }

  private writeImage(writePixel: IColorProcessor) {
    const rowBytes = this.extraBytes + this.width * this.bytesInColor;

    let i = 0;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const p = Math.floor(
          this.pos + (this.height - 1 - y) * rowBytes + x * this.bytesInColor,
        );

        i = writePixel.call(this, p, i, x, y);
      }
    }
  }

  /** Write the palette and return a lookup from a color to its index */
  private initColors(bit: number) {
    if (!this.palette.length) {
      throw new Error(
        `To encode ${bit}-bit BMPs a palette is needed. Please choose up to ${2 ** bit} colors.`,
      );
    }

    const palette = this.palette.slice(0, this.colors);

    for (const color of palette) {
      this.writeUInt32LE(createColor(color));
    }

    return createPaletteLookup(palette);
  }

  private writeUInt32LE(value: number) {
    this.data.writeUInt32LE(value, this.pos);
    this.pos += 4;
  }
}
