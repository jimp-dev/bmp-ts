export const enum Compression {
  NONE = 0,
  BI_RLE8 = 1,
  BI_RLE4 = 2,
  BI_BIT_FIELDS = 3,
  BI_ALPHA_BIT_FIELDS = 6,
}

export interface IColor {
  red: number;
  green: number;
  blue: number;
  quad: number;
}

export interface IDecoderOptions {
  toRGBA?: boolean;
}

export interface IImage {
  width: number;
  height: number;
  data: Buffer;

  flag?: string;
  fileSize?: number;
  reserved1?: number;
  reserved2?: number;
  offset?: number;
  headerSize?: number;
  planes?: number;
  bitPP?: number;
  compression?: Compression;
  rawSize?: number;
  hr?: number;
  vr?: number;
  colors?: number;
  importantColors?: number;
  palette?: IColor[];
}
