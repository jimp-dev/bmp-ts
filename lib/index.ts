import BmpDecoder from './decoder';
import BmpEncoder from './encoder';

export default {
  decode: (bmpData: Buffer, options?: IDecoderOptions) =>
    new BmpDecoder(bmpData, options),
  encode: (imgData: IImage) => new BmpEncoder(imgData)
};

export function decode(bmpData: Buffer, options?: IDecoderOptions) {
  return new BmpDecoder(bmpData, options);
}
export function encode(imgData: IImage) {
  return new BmpEncoder(imgData);
}
