import { decodeKittyPrintable } from "@mariozechner/pi-tui";

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

interface SanitizeTextInputOptions {
  preserveNewlines?: boolean;
}

function sanitizeTextInput(data: string, options: SanitizeTextInputOptions = {}): string {
  const normalized = decodeKittyPrintable(data) ?? data;
  if (!normalized || normalized.includes("\u001b")) {
    return "";
  }

  const withNewlines = normalized.replace(/\r\n?/g, "\n");
  const withoutTabs = options.preserveNewlines
    ? withNewlines.replace(/\t/g, "  ")
    : withNewlines.replace(/\n/g, " ").replace(/\t/g, " ");

  return withoutTabs.replace(CONTROL_CHARS, "");
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

interface TextInputBufferOptions {
  preserveNewlines?: boolean;
}

export function createTextInputBuffer(options: TextInputBufferOptions = {}): TextInputBuffer {
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
        return sanitizeTextInput(completeText, options);
      }

      const beforePaste = combined.slice(0, startIndex);
      const afterStart = combined.slice(startIndex + BRACKETED_PASTE_START.length);
      isInPaste = true;
      pasteBuffer = "";
      return sanitizeTextInput(beforePaste, options) + push(afterStart);
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

    return sanitizeTextInput(pastedText, options) + push(remaining);
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
