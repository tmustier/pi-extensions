import type { CommentPayload } from "./viewer";

export function formatCommentMessage(payload: CommentPayload, comment: string): string {
  return `In \`${payload.relPath}\` (${payload.lineRange}):\n\`\`\`${payload.ext}\n${payload.selectedText}\n\`\`\`\n\nComment: ${comment}\n`;
}
