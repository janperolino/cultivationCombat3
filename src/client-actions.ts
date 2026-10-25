import type { ActorInput } from './sim.ts';
import type { InputReceipt } from './session-authority.ts';

// One in-flight head, immutable retry payload, bounded UI backlog. A new instance
// is required after connection recovery; actions never cross generations.
export class ActionOutbox {
    private sequence = 0;
    private queue: { sequence: number; input: ActorInput; expiresTick?: number }[] = [];
    get size() { return this.queue.length; }
    get next() { return this.queue[0] ? structuredClone(this.queue[0]) : undefined; }
    enqueue(input: ActorInput, expiresTick?: number): boolean {
        if (this.queue.length >= 16 || (!input.fire && !input.dash)) return false;
        this.queue.push({ sequence: ++this.sequence, input: structuredClone(input), expiresTick });
        return true;
    }
    acknowledge(receipt: InputReceipt) {
        this.queue = this.queue.filter(a => a.sequence > (receipt.actionApplied ?? 0));
    }
}
