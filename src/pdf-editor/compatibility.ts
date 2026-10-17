// PDF.js 6's legacy bundle still calls this API, which is absent in the
// application's supported iOS 16.4 WebView. Run before importing PDF.js.
if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new this<T>((resolvePromise, rejectPromise) => {
        if (resolve !== undefined || reject !== undefined) throw new TypeError('Promise executor was called twice.');
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      if (typeof resolve !== 'function' || typeof reject !== 'function') {
        throw new TypeError('Invalid promise constructor.');
      }
      return { promise, resolve, reject };
    },
  });
}

// Font serialization uses transferToFixedLength even in the legacy worker.
// structuredClone can transfer ArrayBuffers on the minimum supported WebView.
if (typeof ArrayBuffer.prototype.transferToFixedLength !== 'function') {
  const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
  Object.defineProperty(ArrayBuffer.prototype, 'transferToFixedLength', {
    configurable: true,
    writable: true,
    value: function transferToFixedLength(this: ArrayBuffer, newLength: number | undefined = undefined) {
      const originalLength = byteLength.call(this) as number;
      // Constructing the view rejects already detached buffers before allocating.
      const source = new Uint8Array(this);
      const number = newLength === undefined ? originalLength : +newLength;
      const length = Number.isNaN(number) ? 0 : Math.trunc(number);
      if (length < 0 || length > Number.MAX_SAFE_INTEGER) throw new RangeError('Invalid buffer length.');
      const result = new ArrayBuffer(length);
      new Uint8Array(result).set(source.subarray(0, Math.min(originalLength, length)));
      // Detach the input, matching native transfer semantics. Return the newly
      // allocated fixed buffer even if an input supports resizing.
      structuredClone(this, { transfer: [this] });
      return result;
    },
  });
}
