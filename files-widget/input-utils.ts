const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function getTextInput(data: string): string {
  if (!data || data.includes("\u001b")) {
    return "";
  }

  return data
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ")
    .replace(CONTROL_CHARS, "");
}
