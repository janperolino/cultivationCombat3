export const NETWORK_PROFILES = {
    local: { rtt: 0, jitter: 0, loss: 0 },
    mild: { rtt: 50, jitter: 5, loss: .01 },
    typical: { rtt: 100, jitter: 15, loss: .02 },
    harsh: { rtt: 150, jitter: 25, loss: .03 },
};
export type ProfileName = keyof typeof NETWORK_PROFILES;
export class NetworkLab {
    private seed: number;
    private profile: ProfileName;
    dropped = 0;
    requests = 0;
    constructor(profile: ProfileName = 'local', seed = 0x534856) { this.profile = profile; this.seed = seed; }
    private random() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296; }
    next() {
        const p = NETWORK_PROFILES[this.profile];
        const up = Math.max(0, p.rtt / 2 + (this.random() * 2 - 1) * p.jitter);
        const down = Math.max(0, p.rtt / 2 + (this.random() * 2 - 1) * p.jitter);
        const dropRequest = this.random() < p.loss, dropResponse = this.random() < p.loss;
        this.requests++; if (dropRequest || dropResponse) this.dropped++;
        return { up, down, dropRequest, dropResponse };
    }
}
