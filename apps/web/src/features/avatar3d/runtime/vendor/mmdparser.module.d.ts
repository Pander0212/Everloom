/* eslint-disable @typescript-eslint/no-explicit-any */
export class Parser {
  parsePmd(buffer: ArrayBuffer, leftToRight?: boolean): any;
  parsePmx(buffer: ArrayBuffer, leftToRight?: boolean): any;
  parseVmd(buffer: ArrayBuffer, leftToRight?: boolean): any;
  parseVpd(text: string, leftToRight?: boolean): any;
  mergeVmds(vmds: any[]): any;
}
