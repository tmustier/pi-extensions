import { decodeKittyPrintable } from "@mariozechner/pi-tui";

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

function sanitizeTextInput(data: string): string {
  const normalized = decodeKittyPrintable(data) ?? data;
  if (!normalized || normalized.includes("\u001b")) {
    return "";
  }

  return normalized
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ")
    .replace(CONTROL_CHARS, "");
}

function getPendingStartSuffix(data: string): string {
  const maxLength = BRACKETED_PASTE_START.length - 1;
  for (let length = Math.min(data.length, maxLength); length > 0; length--) {
    const suffix = data.slice(-length);
    if (BRACKETED_PASTE_START.startsWith(suffix)) {
      return suffix;
    }
  }
  return "";
}

export interface TextInputBuffer {
  push(data: string): string;
  reset(): void;
}

export function createTextInputBuffer(): TextInputBuffer {
  let isInPaste = false;
  let pasteBuffer = "";
  let pendingStart = "";

  const push = (data: string): string => {
    if (!data) {
      return "";
    }

    const combined = pendingStart + data;
    pendingStart = "";

    if (!isInPaste) {
      const startIndex = combined.indexOf(BRACKETED_PASTE_START);
      if (startIndex === -1) {
        const pendingSuffix = getPendingStartSuffix(combined);
        const completeText = pendingSuffix ? combined.slice(0, combined.length - pendingSuffix.length) : combined;
        pendingStart = pendingSuffix;
        return sanitizeTextInput(completeText);
      }

      const beforePaste = combined.slice(0, startIndex);
      const afterStart = combined.slice(startIndex + BRACKETED_PASTE_START.length);
      isInPaste = true;
      pasteBuffer = "";
      return sanitizeTextInput(beforePaste) + push(afterStart);
    }

    pasteBuffer += combined;
    const endIndex = pasteBuffer.indexOf(BRACKETED_PASTE_END);
    if (endIndex === -1) {
      return "";
    }

    const pastedText = pasteBuffer.slice(0, endIndex);
    const remaining = pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
    isInPaste = false;
    pasteBuffer = "";

    return sanitizeTextInput(pastedText) + push(remaining);
  };

  return {
    push,
    reset(): void {
      isInPaste = false;
      pasteBuffer = "";
      pendingStart = "";
    },
  };
}
