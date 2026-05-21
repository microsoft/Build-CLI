const CSI_RE = /\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g;
const OSC_RE = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const STRING_RE = /\x1B[PX^_][\s\S]*?\x1B\\/g;
const ESC_TAIL_RE = /\x1B./g;
const CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

export function stripControlSequences(input: string): string {
  return input
    .replace(STRING_RE, '')
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(ESC_TAIL_RE, '')
    .replace(CTRL_RE, '');
}
