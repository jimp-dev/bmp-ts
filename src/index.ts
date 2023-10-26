import BmpDecoder from './decoder.js';
import BmpEncoder from './encoder.js';
import { IDecoderOptions, IImage } from './types.js';

export function decode(bmpData: Buffer, options?: IDecoderOptions) {
  return new BmpDecoder(bmpData, options);
}
export function encode(imgData: IImage) {
  return new BmpEncoder(imgData);
}
