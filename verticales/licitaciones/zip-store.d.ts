// Sólo lo que el navegador importa de este módulo: el armador del ZIP sin compresión.
export function zipStore(input?: {
  entries?: { name: string; content: string | Uint8Array | ArrayBuffer | null }[];
  folders?: readonly string[];
  now?: Date;
}): Uint8Array;
export function zipEntryName(name: string): string;
export function crc32(bytes: Uint8Array): number;
