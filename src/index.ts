import BmpDecoder from './decoder.js';
import BmpEncoder from './encoder.js';
import { BmpDecoderOptions, BmpImage } from './types.js';

export function decode(bmpData: Buffer, options?: BmpDecoderOptions) {
  return new BmpDecoder(bmpData, options);
}
export function encode(imgData: BmpImage) {
  return new BmpEncoder(imgData);
}

export * from './types.js';
