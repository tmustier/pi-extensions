export function isPrintableChar(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127;
}
