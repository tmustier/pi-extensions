export function clearOwnedStatus(
	setStatus: (key: string, value: string | undefined) => void,
	ownerKey: string | undefined,
	renderedKey: string | undefined,
): string | undefined {
	if (!ownerKey) return renderedKey;
	setStatus(ownerKey, undefined);
	return renderedKey === ownerKey ? undefined : renderedKey;
}
