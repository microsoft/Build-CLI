// CSI: ESC [ ... <final byte>
const CSI_RE = /\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g;
// OSC: ESC ] ... (BEL | ESC \) -- includes OSC 8 hyperlinks and OSC 52 clipboard
const OSC_RE = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
// DCS / SOS / PM / APC: ESC (P|X|^|_) ... ESC \
const STR_RE = /\x1B[PX^_][\s\S]*?\x1B\\/g;
// Any remaining ESC + one byte
const ESC_TAIL_RE = /\x1B./g;
// C0 controls except TAB (0x09), LF (0x0A), CR (0x0D); plus DEL (0x7F) and C1 (0x80–0x9F).
const CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

export function stripControlSequences(input: string): string {
  return input
    .replace(STR_RE, '')
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(ESC_TAIL_RE, '')
    .replace(CTRL_RE, '');
}
