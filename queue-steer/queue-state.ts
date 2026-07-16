export interface QueuedFollowUp<TImage = unknown> {
	id: string;
	text: string;
	images: TImage[];
}

/** Small FIFO with stable ids so a visible item can be edited while the queue advances. */
export class FollowUpQueue<TImage = unknown> {
	private items: QueuedFollowUp<TImage>[] = [];
	private nextId = 1;

	enqueue(text: string, images: readonly TImage[] = []): QueuedFollowUp<TImage> {
		const item = { id: `follow-up-${this.nextId++}`, text, images: [...images] };
		this.items.push(item);
		return this.copy(item);
	}

	prepend(item: QueuedFollowUp<TImage>): void {
		this.items.unshift(this.copy(item));
	}

	update(id: string, text: string, images?: readonly TImage[]): boolean {
		const item = this.items.find((candidate) => candidate.id === id);
		if (!item) return false;
		item.text = text;
		if (images) item.images = [...images];
		return true;
	}

	remove(id: string): QueuedFollowUp<TImage> | undefined {
		const index = this.items.findIndex((item) => item.id === id);
		if (index === -1) return undefined;
		const [item] = this.items.splice(index, 1);
		return item ? this.copy(item) : undefined;
	}

	shift(): QueuedFollowUp<TImage> | undefined {
		const item = this.items.shift();
		return item ? this.copy(item) : undefined;
	}

	get(id: string): QueuedFollowUp<TImage> | undefined {
		const item = this.items.find((candidate) => candidate.id === id);
		return item ? this.copy(item) : undefined;
	}

	previousId(currentId?: string): string | undefined {
		if (this.items.length === 0) return undefined;
		if (!currentId) return this.items.at(-1)?.id;
		const index = this.items.findIndex((item) => item.id === currentId);
		if (index <= 0) return this.items.at(-1)?.id;
		return this.items[index - 1]?.id;
	}

	snapshot(): QueuedFollowUp<TImage>[] {
		return this.items.map((item) => this.copy(item));
	}

	get length(): number {
		return this.items.length;
	}

	clear(): void {
		this.items = [];
	}

	private copy(item: QueuedFollowUp<TImage>): QueuedFollowUp<TImage> {
		return { ...item, images: [...item.images] };
	}
}
