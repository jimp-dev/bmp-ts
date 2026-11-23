/// <reference types="node" preserve="true" />
import HeaderTypes from './header-types.js';
import maskColor from './mask-color.js';
import { BmpCompression, BmpColor, BmpDecoderOptions, BmpImage } from './types.js';

type IColorProcessor = (x: number, line: number) => void;

const SUPPORTED_BIT_DEPTHS = [1, 4, 8, 16, 24, 32];

export default class BmpDecoder implements BmpImage {
  // Header
  public flag: string;
  public fileSize!: number;
  public reserved1!: number;
  public reserved2!: number;
  public offset!: number;
  public headerSize!: number;
  public width!: number;
  public height!: number;
  public planes!: number;
  public bitPP!: number;
  public compression?: BmpCompression;
  public rawSize!: number;
  public hr!: number;
  public vr!: number;
  public colors!: number;
  public importantColors!: number;
  public palette!: BmpColor[];
  public data!: Buffer;

  private maskRed!: number;
  private maskGreen!: number;
  private maskBlue!: number;
  private maskAlpha!: number;

  private readonly toRGBA: boolean;

  private pos: number;
  private bottomUp: boolean;
  private readonly buffer: Buffer;

  private readonly locRed: number;
  private readonly locGreen: number;
  private readonly locBlue: number;
  private readonly locAlpha: number;

  private shiftRed!: (x: number) => number;
  private shiftGreen!: (x: number) => number;
  private shiftBlue!: (x: number) => number;
  private shiftAlpha!: (x: number) => number;

  constructor(
    buffer: Buffer,
    { toRGBA, maxResolutionInMP = 100 }: BmpDecoderOptions = { toRGBA: false },
  ) {
    this.buffer = buffer;
    this.toRGBA = !!toRGBA;
    this.pos = 0;
    this.bottomUp = true;
    this.flag = this.buffer.toString('utf-8', 0, (this.pos += 2));

    if (this.flag !== 'BM') {
      throw new Error('Invalid BMP File');
    }

    this.locRed = this.toRGBA ? 0 : 3;
    this.locGreen = this.toRGBA ? 1 : 2;
    this.locBlue = this.toRGBA ? 2 : 1;
    this.locAlpha = this.toRGBA ? 3 : 0;

    this.parseHeader();
    // BMP pixel data starts at the file-header offset, which may include a gap
    // after the headers and color table.
    this.pos = Math.max(this.pos, this.offset);
    this.validate(maxResolutionInMP);
    this.parseRGBA();
  }

  /**
   * parseRGBA allocates width * height * 4 bytes straight from the header,
   * so make sure the header is sane and the pixel data can actually fill it.
   */
  private validate(maxResolutionInMP: number) {
    const { width, height, bitPP } = this;

    // The width is a signed value, but negative widths aren't allowed
    if (width === 0 || width > 0x7fffffff || height === 0) {
      throw new Error(`Invalid BMP dimensions ${width}x${height}`);
    }

    if (!SUPPORTED_BIT_DEPTHS.includes(bitPP)) {
      throw new Error(`Unsupported BMP bit depth ${bitPP}`);
    }

    if (width * height > maxResolutionInMP * 1_000_000) {
      throw new Error(
        `BMP dimensions ${width}x${height} exceed the maximum resolution of ${maxResolutionInMP} megapixels`,
      );
    }

    if (this.offset > this.buffer.length) {
      throw new Error(
        `BMP pixel data offset ${this.offset} is past the end of the file`,
      );
    }

    const available = Math.max(this.buffer.length - this.pos, 0);
    const isRle =
      (this.compression === BmpCompression.BI_RLE8 && bitPP === 8) ||
      (this.compression === BmpCompression.BI_RLE4 && bitPP === 4);

    if (isRle) {
      // A single run-length code is 2 bytes and expands to at most 255 pixels
      if (width * height > Math.ceil(available / 2) * 255) {
        throw new Error(
          `BMP data is too short for an RLE image of ${width}x${height}`,
        );
      }
    } else {
      // Rows are padded to 4 bytes, but the last row's padding is never read
      const stride = Math.ceil((width * bitPP) / 32) * 4;
      const required = stride * (height - 1) + Math.ceil((width * bitPP) / 8);

      if (required > available) {
        throw new Error(
          `BMP data is too short for an image of ${width}x${height} at ${bitPP} bits per pixel`,
        );
      }
    }
  }

  private parseHeader() {
    this.fileSize = this.readUInt32LE();

    this.reserved1 = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;
    this.reserved2 = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;

    this.offset = this.readUInt32LE();

    // End of BITMAP_FILE_HEADER
    this.headerSize = this.readUInt32LE();

    if (!(this.headerSize in HeaderTypes)) {
      throw new Error(`Unsupported BMP header size ${this.headerSize}`);
    }

    this.width = this.readUInt32LE();
    this.height = this.readUInt32LE();
    // negative value are possible here => implies bottom down
    this.height =
    this.height > 0x7fffffff ? this.height - 0x100000000 : this.height;

    this.planes = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;
    this.bitPP = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;

    this.compression = this.readUInt32LE();
    this.rawSize = this.readUInt32LE();
    this.hr = this.readUInt32LE();
    this.vr = this.readUInt32LE();
    this.colors = this.readUInt32LE();
    this.importantColors = this.readUInt32LE();

    // De facto defaults

    if (this.bitPP === 32) {
      this.maskAlpha = 0;
      this.maskRed = 0x00ff0000;
      this.maskGreen = 0x0000ff00;
      this.maskBlue = 0x000000ff;
    } else if (this.bitPP === 16) {
      this.maskAlpha = 0;
      this.maskRed = 0x7c00;
      this.maskGreen = 0x03e0;
      this.maskBlue = 0x001f;
    }

    // End of BITMAP_INFO_HEADER

    if (
      this.headerSize > HeaderTypes.BITMAP_INFO_HEADER ||
      this.compression === BmpCompression.BI_BIT_FIELDS ||
      this.compression === BmpCompression.BI_ALPHA_BIT_FIELDS
    ) {
      this.maskRed = this.readUInt32LE();
      this.maskGreen = this.readUInt32LE();
      this.maskBlue = this.readUInt32LE();
    }

    // End of BITMAP_V2_INFO_HEADER

    if (
      this.headerSize > HeaderTypes.BITMAP_V2_INFO_HEADER ||
      this.compression === BmpCompression.BI_ALPHA_BIT_FIELDS
    ) {
      this.maskAlpha = this.readUInt32LE();
    }

    // End of BITMAP_V3_INFO_HEADER

    if (this.headerSize > HeaderTypes.BITMAP_V3_INFO_HEADER) {
      this.pos +=
        HeaderTypes.BITMAP_V4_HEADER - HeaderTypes.BITMAP_V3_INFO_HEADER;
    }

    // End of BITMAP_V4_HEADER

    if (this.headerSize > HeaderTypes.BITMAP_V4_HEADER) {
      this.pos += HeaderTypes.BITMAP_V5_HEADER - HeaderTypes.BITMAP_V4_HEADER;
    }

    // End of BITMAP_V5_HEADER

    if (this.bitPP <= 8 || this.colors > 0) {
      const len = this.colors === 0 ? 1 << this.bitPP : this.colors;
      this.palette = new Array(len);

      for (let i = 0; i < len; i++) {
        const blue = this.buffer.readUInt8(this.pos++);
        const green = this.buffer.readUInt8(this.pos++);
        const red = this.buffer.readUInt8(this.pos++);
        const quad = this.buffer.readUInt8(this.pos++);

        this.palette[i] = {
          red,
          green,
          blue,
          quad,
        };
      }
    }

    // End of color table

    // Can the height ever be negative?
    if (this.height < 0) {
      this.height *= -1;
      this.bottomUp = false;
    }

    const coloShift = maskColor(
      this.maskRed,
      this.maskGreen,
      this.maskBlue,
      this.maskAlpha,
    );

    this.shiftRed = coloShift.shiftRed;
    this.shiftGreen = coloShift.shiftGreen;
    this.shiftBlue = coloShift.shiftBlue;
    this.shiftAlpha = coloShift.shiftAlpha;
  }

  private parseRGBA() {
    this.data = Buffer.alloc(this.width * this.height * 4);

    switch (this.bitPP) {
      case 1:
        this.bit1();
        break;
      case 4:
        this.bit4();
        break;
      case 8:
        this.bit8();
        break;
      case 16:
        this.bit16();
        break;
      case 24:
        this.bit24();
        break;
      default:
        this.bit32();
    }
  }

  private bit1() {
    const xLen = Math.ceil(this.width / 8);
    const mode = xLen % 4;
    const padding = mode !== 0 ? 4 - mode : 0;

    this.scanImage(padding, xLen, (x, line) => {
      const b = this.buffer.readUInt8(this.pos++);
      const location = line * this.width * 4 + x * 8 * 4;

      for (let i = 0; i < 8 && x * 8 + i < this.width; i++) {
        this.setPixelData(location + i * 4, (b >> (7 - i)) & 0x1);
      }
    });
  }

  private bit4() {
    if (this.compression === BmpCompression.BI_RLE4) {
      this.rle(4);
      return;
    }

    const xLen = Math.ceil(this.width / 2);
    const mode = xLen % 4;
    const padding = mode !== 0 ? 4 - mode : 0;

    this.scanImage(padding, xLen, (x, line) => {
      const b = this.buffer.readUInt8(this.pos++);
      const location = line * this.width * 4 + x * 2 * 4;

      this.setPixelData(location, b >> 4);

      // The low nibble of the last byte in an odd width row is padding
      if (x * 2 + 1 < this.width) {
        this.setPixelData(location + 4, b & 0x0f);
      }
    });
  }

  private bit8() {
    if (this.compression === BmpCompression.BI_RLE8) {
      this.rle(8);
      return;
    }

    const mode = this.width % 4;
    const padding = mode !== 0 ? 4 - mode : 0;

    this.scanImage(padding, this.width, (x, line) => {
      const b = this.buffer.readUInt8(this.pos++);
      this.setPixelData(line * this.width * 4 + x * 4, b);
    });
  }

  /**
   * Decode BI_RLE4 and BI_RLE8 data. Each code is two bytes: a pixel count
   * and a palette index (two alternating indexes for RLE4), or a zero
   * followed by an escape.
   */
  private rle(bitPP: 4 | 8) {
    // Pixels that the data skips over get the first palette color, like
    // other decoders do
    for (let location = 0; location < this.data.length; location += 4) {
      this.setPixelData(location, 0);
    }

    const step = this.bottomUp ? -1 : 1;
    let line = this.bottomUp ? this.height - 1 : 0;
    let x = 0;

    const pixel = (byte: number, i: number) =>
      bitPP === 8 ? byte : i & 1 ? byte & 0x0f : byte >> 4;

    const setPixel = (index: number) => {
      if (x < this.width) {
        this.setPixelData((line * this.width + x) * 4, index);
      }

      x++;
    };

    while (
      line >= 0 &&
      line < this.height &&
      this.pos + 1 < this.buffer.length
    ) {
      const a = this.buffer.readUInt8(this.pos++);
      const b = this.buffer.readUInt8(this.pos++);

      if (a !== 0) {
        // Encoded mode: repeat b for a pixels
        for (let i = 0; i < a; i++) {
          setPixel(pixel(b, i));
        }
      } else if (b === 0) {
        // End of line
        line += step;
        x = 0;
      } else if (b === 1) {
        // End of bitmap
        break;
      } else if (b === 2) {
        // Delta: move right and to a later line
        if (this.pos + 1 >= this.buffer.length) {
          break;
        }

        x += this.buffer.readUInt8(this.pos++);
        line += step * this.buffer.readUInt8(this.pos++);
      } else {
        // Absolute mode: b pixels follow, padded to a 16-bit boundary
        const bytes = bitPP === 8 ? b : Math.ceil(b / 2);

        if (this.pos + bytes > this.buffer.length) {
          break;
        }

        for (let i = 0; i < b; i++) {
          const byte = this.buffer.readUInt8(
            this.pos + (bitPP === 8 ? i : i >> 1),
          );
          setPixel(pixel(byte, i));
        }

        this.pos += bytes + (bytes & 1);
      }
    }
  }

  private bit16() {
    const padding = (this.width % 2) * 2;

    this.scanImage(padding, this.width, (x, line) => {
      const loc = line * this.width * 4 + x * 4;
      const px = this.buffer.readUInt16LE(this.pos);
      this.pos += 2;

      this.data[loc + this.locRed] = this.shiftRed(px);
      this.data[loc + this.locGreen] = this.shiftGreen(px);
      this.data[loc + this.locBlue] = this.shiftBlue(px);
      this.data[loc + this.locAlpha] = this.shiftAlpha(px);
    });
  }

  private bit24() {
    const padding = this.width % 4;

    this.scanImage(padding, this.width, (x, line) => {
      const loc = line * this.width * 4 + x * 4;
      const blue = this.buffer.readUInt8(this.pos++);
      const green = this.buffer.readUInt8(this.pos++);
      const red = this.buffer.readUInt8(this.pos++);

      this.data[loc + this.locRed] = red;
      this.data[loc + this.locGreen] = green;
      this.data[loc + this.locBlue] = blue;
      this.data[loc + this.locAlpha] = 0;
    });
  }

  private bit32() {
    this.scanImage(0, this.width, (x, line) => {
      const loc = line * this.width * 4 + x * 4;
      const px = this.readUInt32LE();

      this.data[loc + this.locRed] = this.shiftRed(px);
      this.data[loc + this.locGreen] = this.shiftGreen(px);
      this.data[loc + this.locBlue] = this.shiftBlue(px);
      this.data[loc + this.locAlpha] = this.shiftAlpha(px);
    });
  }

  private scanImage(
    padding = 0,
    width = this.width,
    processPixel: IColorProcessor,
  ) {
    for (let y = this.height - 1; y >= 0; y--) {
      const line = this.bottomUp ? y : this.height - 1 - y;

      for (let x = 0; x < width; x++) {
        processPixel.call(this, x, line);
      }

      this.pos += padding;
    }
  }

  private readUInt32LE() {
    const value = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    return value;
  }

  private setPixelData(location: number, rgbIndex: number) {
    // Out of range indexes are drawn white
    const { blue, green, red } = this.palette[rgbIndex] ?? {
      blue: 0xff,
      green: 0xff,
      red: 0xff,
    };

    this.data[location + this.locAlpha] = 0;
    this.data[location + this.locBlue] = blue;
    this.data[location + this.locGreen] = green;
    this.data[location + this.locRed] = red;
  }
}
