/** The smallest power of two that is at least `n` (1 for n ≤ 1). */
export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT of a complex signal. Both arrays must have the same
 * length, a power of two.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (im.length !== n) throw new RangeError("re and im must have the same length");
  if (n === 0 || (n & (n - 1)) !== 0) throw new RangeError(`length ${n} is not a power of two`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = start + k;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * The magnitude spectrum |X[k]| of a real signal, zero-padded to the next power of two of at least
 * `minSize` (and of the signal's length). Bin k is the frequency k · rate / size.
 */
export function magnitudeSpectrum(values: readonly number[], minSize = 0): number[] {
  const size = nextPowerOfTwo(Math.max(values.length, minSize, 1));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  values.forEach((value, index) => {
    re[index] = value;
  });
  fft(re, im);
  return Array.from(re, (real, index) => Math.hypot(real, im[index]));
}

/** The frequency of each bin of a spectrum of `size` points, for a signal sampled at `rateHz`. */
export function binFrequencies(size: number, rateHz: number): number[] {
  return Array.from({ length: size }, (_, index) => (index * rateHz) / size);
}
