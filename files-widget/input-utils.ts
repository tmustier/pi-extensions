const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const BRACKETED_PASTE_START = /\u001b\[200~/g;
const BRACKETED_PASTE_END = /\u001b\[201~/g;

export function getTextInput(data: string): string {
  if (!data) {
    return "";
  }

  const normalized = data
    .replace(BRACKETED_PASTE_START, "")
    .replace(BRACKETED_PASTE_END, "");

  if (normalized.includes("\u001b")) {
    return "";
  }

  return normalized
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ")
    .replace(CONTROL_CHARS, "");
}
