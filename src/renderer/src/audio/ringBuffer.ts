/** Bounded PCM byte queue. Audio remains in memory and is never persisted here. */
export class PcmRingBuffer {
  private bytes: Uint8Array;
  private head=0;
  private used=0;
  readonly capacity: number;
  constructor(capacity=96_000) {
    this.capacity=capacity;
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity % 2 !== 0) throw new RangeError('PCM buffer capacity must be a positive even number');
    this.bytes=new Uint8Array(capacity);
  }
  get size(): number { return this.used; }
  /** Appends complete PCM16 samples, discarding oldest samples on overflow. */
  push(input: Uint8Array): number {
    if (input.byteLength % 2 !== 0) throw new RangeError('PCM16 input must contain complete samples');
    let dropped=0;
    if (input.length >= this.capacity) {
      dropped=this.used + input.length-this.capacity;
      this.clear(); input=input.subarray(input.length-this.capacity);
    } else {
      const excess=Math.max(0,this.used+input.length-this.capacity);
      this.discard(excess); dropped=excess;
    }
    const tail=(this.head+this.used)%this.capacity;
    const first=Math.min(input.length,this.capacity-tail);
    this.bytes.set(input.subarray(0,first),tail);
    this.bytes.set(input.subarray(first),0);
    this.used+=input.length;
    return dropped;
  }
  /** Returns exactly size bytes; shortage is filled with silence. */
  readPadded(size: number): Uint8Array {
    if (!Number.isInteger(size) || size<0 || size%2!==0) throw new RangeError('PCM16 size must be a nonnegative even number');
    const result=new Uint8Array(size), n=Math.min(size,this.used);
    const first=Math.min(n,this.capacity-this.head);
    result.set(this.bytes.subarray(this.head,this.head+first),0);
    result.set(this.bytes.subarray(0,n-first),first);
    this.discard(n);
    return result;
  }
  clear(): void { this.bytes.fill(0); this.head=0; this.used=0; }
  private discard(n: number): void {
    if (!n) return;
    const first=Math.min(n,this.capacity-this.head);
    this.bytes.fill(0,this.head,this.head+first);
    this.bytes.fill(0,0,n-first);
    this.head=(this.head+n)%this.capacity; this.used-=n;
  }
}
