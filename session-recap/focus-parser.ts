export type FocusEvent = "in" | "out";

/** Incremental parser for configurable terminal focus sequences. */
export class FocusSequenceParser {
	private buffer = "";
	private readonly sequences: Array<{ value: string; event: FocusEvent }>;
	private readonly bufferCap: number;

	constructor(inSequence: string, outSequence: string, bufferCap: number) {
		if (!inSequence || !outSequence) throw new Error("focus sequences must be non-empty");
		if (inSequence === outSequence || inSequence.startsWith(outSequence) || outSequence.startsWith(inSequence)) {
			throw new Error("focus sequences must be distinct and not prefix-overlapping");
		}
		if (!Number.isInteger(bufferCap) || bufferCap < Math.max(inSequence.length, outSequence.length)) {
			throw new Error("focus parser cap must fit the longest sequence");
		}
		this.bufferCap = bufferCap;
		this.sequences = [
			{ value: inSequence, event: "in" as const },
			{ value: outSequence, event: "out" as const },
		].sort((left, right) => right.value.length - left.value.length);
	}

	push(chunk: string): FocusEvent[] {
		this.buffer += chunk;
		const events: FocusEvent[] = [];
		while (this.buffer.length > 0) {
			const full = this.sequences.find(({ value }) => this.buffer.startsWith(value));
			if (full) {
				const ambiguousLonger = this.sequences.some(
					({ value }) => value.length > full.value.length && value.startsWith(full.value) && this.buffer.length < value.length,
				);
				if (ambiguousLonger) break;
				events.push(full.event);
				this.buffer = this.buffer.slice(full.value.length);
				continue;
			}
			if (this.sequences.some(({ value }) => value.startsWith(this.buffer))) break;
			this.buffer = this.buffer.slice(1);
		}
		if (this.buffer.length > this.bufferCap) this.buffer = this.buffer.slice(-this.bufferCap);
		return events;
	}
}
