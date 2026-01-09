import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Container, Text, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export async function copyToClipboard(pi: ExtensionAPI, content: string): Promise<boolean> {
	const tmpPath = path.join(os.tmpdir(), `pi-code-${Date.now()}.txt`);
	fs.writeFileSync(tmpPath, content, "utf8");

	const commands: Array<{ command: string; args: string[] }> = [];
	if (process.platform === "darwin") {
		commands.push({ command: "sh", args: ["-c", `cat "${tmpPath}" | pbcopy`] });
	} else if (process.platform === "win32") {
		commands.push({ command: "powershell", args: ["-NoProfile", "-Command", `Get-Content -Raw "${tmpPath}" | Set-Clipboard`] });
	} else {
		commands.push({ command: "sh", args: ["-c", `cat "${tmpPath}" | wl-copy`] });
		commands.push({ command: "sh", args: ["-c", `cat "${tmpPath}" | xclip -selection clipboard`] });
		commands.push({ command: "sh", args: ["-c", `cat "${tmpPath}" | xsel --clipboard --input`] });
	}

	let success = false;
	for (const cmd of commands) {
		try {
			const result = await pi.exec(cmd.command, cmd.args);
			if (result.code === 0) {
				success = true;
				break;
			}
		} catch {
			// Try next command
		}
	}

	try {
		fs.unlinkSync(tmpPath);
	} catch {
		// Ignore cleanup errors
	}

	return success;
}

export function insertIntoEditor(ctx: ExtensionCommandContext, content: string): void {
	const existing = ctx.ui.getEditorText();
	const next = existing ? `${existing}\n${content}` : content;
	ctx.ui.setEditorText(next);
}

function formatOutput(command: string, result: { stdout: string; stderr: string; code: number }): string {
	const lines: string[] = [];
	lines.push(`Command: ${command}`);
	lines.push(`Exit code: ${result.code}`);

	if (result.stdout.trim().length > 0) {
		lines.push("");
		lines.push("STDOUT:");
		lines.push(result.stdout.trimEnd());
	}

	if (result.stderr.trim().length > 0) {
		lines.push("");
		lines.push("STDERR:");
		lines.push(result.stderr.trimEnd());
	}

	return lines.join("\n");
}

function truncateLines(text: string, maxLines: number): string {
	const lines = text.split(/\r?\n/);
	if (lines.length <= maxLines) return text;
	const truncated = lines.slice(0, maxLines).join("\n");
	return `${truncated}\n\n[Output truncated to ${maxLines} lines]`;
}

export async function runSnippet(pi: ExtensionAPI, ctx: ExtensionCommandContext, snippet: string): Promise<void> {
	const isWindows = process.platform === "win32";
	const command = isWindows ? "powershell" : "bash";
	const args = isWindows ? ["-NoProfile", "-Command", snippet] : ["-lc", snippet];

	const result = await pi.exec(command, args, { cwd: ctx.cwd });
	const output = truncateLines(formatOutput(`${command} ${args.join(" ")}`, result), 200);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Command Output")), 1, 0));

		const text = new Text(output, 1, 0);
		container.addChild(text);

		container.addChild(new Text(theme.fg("dim", "Enter/Esc to close"), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width).map((line) => truncateToWidth(line, width)),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape") || matchesKey(data, "enter")) {
					done();
				}
			},
		};
	});
}
