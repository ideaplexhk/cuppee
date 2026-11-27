// Minimal types for the parts of nfc-pcsc the bridge uses. The package ships no types, and its native
// PC/SC module does not need to build for type checking (verify.sh installs with --ignore-scripts).
declare module 'nfc-pcsc' {
  import { EventEmitter } from 'node:events';

  export class Reader extends EventEmitter {
    reader: { name: string };
    autoProcessing: boolean;
    transmit(data: Buffer, responseMaxLength: number): Promise<Buffer>;
  }

  export class NFC extends EventEmitter {
    constructor();
    on(event: 'reader', listener: (reader: Reader) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}
