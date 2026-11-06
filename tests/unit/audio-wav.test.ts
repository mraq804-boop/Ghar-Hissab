import { describe, expect, it } from "vitest";
import { downsample, encodeWav, speakable, toMono } from "@/lib/audio/wav";

describe("wav", () => {
  it("writes a 16-bit mono PCM header and samples", () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 8);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...new Uint8Array(buf, 8, 4))).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768]);
  });

  it("mixes channels and downsamples 48 kHz to 16 kHz", () => {
    expect([...toMono([new Float32Array([1, 0]), new Float32Array([0, 0])])]).toEqual([0.5, 0]);
    const out = downsample(new Float32Array([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]), 48000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.3);
    expect(out[1]).toBeCloseTo(0.6);
    expect(downsample(new Float32Array([1, 2]), 16000)).toHaveLength(2);
  });

  it("cleans an answer for reading aloud", () => {
    expect(speakable("- **Purse:** Rs 1,200\n- Chicken | Rs. 563")).toBe("Purse: Rupees 1,200\nChicken ,  Rupees 563");
  });
});
