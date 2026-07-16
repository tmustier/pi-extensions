import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";

class PrivateImagePolicyError extends Error {}

function policyError(message: string): PrivateImagePolicyError {
	return new PrivateImagePolicyError(message);
}

/**
 * Read a cmux-produced image through the same no-follow file descriptor used for
 * validation, then remove its private temporary pathname on every outcome.
 */
export async function readPrivateImage(path: string, maxBytes: number): Promise<string> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw policyError("cmux screenshot byte limit was invalid.");
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const before = await handle.stat();
		if (!before.isFile()) throw policyError("cmux screenshot output was not a regular file.");
		if (before.nlink !== 1) throw policyError("cmux screenshot output was not a private standalone file.");
		if (typeof process.getuid === "function" && before.uid !== process.getuid()) {
			throw policyError("cmux screenshot output was not owned by the current user.");
		}
		if (before.size > maxBytes) throw policyError(`cmux screenshot exceeded the ${maxBytes} byte safety limit.`);

		// Validate the already-open descriptor before changing permissions so an
		// unexpected directory/device/link target is never modified by this helper.
		await handle.chmod(0o600);
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.dev !== before.dev || metadata.ino !== before.ino || metadata.nlink !== 1) {
			throw policyError("cmux screenshot output changed during secure validation.");
		}
		if ((metadata.mode & 0o077) !== 0) {
			throw policyError("cmux screenshot permissions could not be restricted to the current user.");
		}
		if (metadata.size > maxBytes) throw policyError(`cmux screenshot exceeded the ${maxBytes} byte safety limit.`);

		// Do not trust the pre-read stat alone: the file could grow after validation.
		// A fixed max+1 buffer makes the memory bound hold under that race too.
		const buffer = Buffer.allocUnsafe(maxBytes + 1);
		let offset = 0;
		while (offset < buffer.length) {
			const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		if (offset > maxBytes) throw policyError(`cmux screenshot exceeded the ${maxBytes} byte safety limit.`);
		return buffer.subarray(0, offset).toString("base64");
	} catch (error) {
		if (error instanceof PrivateImagePolicyError) throw error;
		throw new Error("cmux screenshot output could not be read securely.");
	} finally {
		await handle?.close().catch(() => undefined);
		await rm(path, { force: true }).catch(() => undefined);
	}
}
