import BmpDecoder from './decoder.js';
import BmpEncoder from './encoder.js';
import { IDecoderOptions, IImage } from './types.js';

export default {
  decode: (bmpData: Buffer, options?: IDecoderOptions) =>
    new BmpDecoder(bmpData, options),
  encode: (imgData: IImage) => new BmpEncoder(imgData),
};
