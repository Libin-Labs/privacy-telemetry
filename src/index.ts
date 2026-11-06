export type TelemetryScalar = string | number | boolean | null;
export type TelemetryProperties = Readonly<Record<string, TelemetryScalar>>;
export interface TelemetryEvent {
  readonly name: string;
  readonly properties: TelemetryProperties;
}
export interface TelemetryOptions {
  readonly allowlist: Readonly<Record<string, readonly string[]>>;
  readonly consent: () => boolean;
  readonly transport: (events: readonly TelemetryEvent[]) => void | Promise<void>;
  readonly maxEvents?: number;
  readonly maxBytes?: number;
  readonly maxStringLength?: number;
}
export interface TelemetryClient {
  track(name: string, properties?: Readonly<Record<string, unknown>>): boolean;
  flush(): Promise<number>;
  clear(): void;
  pending(): number;
}

const label = (value: string, name: string, maxLength = 128): void => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength)
    throw new TypeError(`${name} must be a nonempty string up to ${maxLength} characters.`);
};
const limit = (value: number, name: string, max: number): void => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new RangeError(`${name} must be an integer from 1 to ${max}.`);
};
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export function createTelemetry(options: TelemetryOptions): TelemetryClient {
  if (!options || typeof options !== 'object') throw new TypeError('Options are required.');
  if (typeof options.consent !== 'function') throw new TypeError('A consent function is required.');
  if (typeof options.transport !== 'function')
    throw new TypeError('An injected transport is required.');
  const maxEvents = options.maxEvents ?? 100;
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const maxStringLength = options.maxStringLength ?? 256;
  limit(maxEvents, 'maxEvents', 100_000);
  limit(maxBytes, 'maxBytes', 10_000_000);
  limit(maxStringLength, 'maxStringLength', 16_384);
  if (
    !options.allowlist ||
    typeof options.allowlist !== 'object' ||
    Array.isArray(options.allowlist)
  )
    throw new TypeError('An event allowlist is required.');
  const allowed = new Map<string, Set<string>>();
  for (const [name, fields] of Object.entries(options.allowlist)) {
    label(name, 'Event name');
    if (!Array.isArray(fields) || fields.length > 128)
      throw new TypeError('Allowlisted fields must be an array of at most 128 names.');
    const fieldSet = new Set<string>();
    for (const field of fields) {
      label(field, 'Property name');
      if (fieldSet.has(field)) throw new TypeError(`Duplicate allowlisted property: ${field}`);
      fieldSet.add(field);
    }
    if (allowed.has(name)) throw new TypeError(`Duplicate event name: ${name}`);
    allowed.set(name, fieldSet);
  }
  if (allowed.size === 0 || allowed.size > 256)
    throw new RangeError('Allowlist must contain 1 to 256 events.');
  const buffer: { event: TelemetryEvent; bytes: number }[] = [];
  let totalBytes = 0;
  let flushing: Promise<number> | undefined;

  const clear = (): void => {
    buffer.length = 0;
    totalBytes = 0;
  };
  const hasConsent = (): boolean => {
    const result = options.consent();
    if (typeof result !== 'boolean') throw new TypeError('Consent function must return a boolean.');
    return result;
  };
  return {
    track(name, properties = {}) {
      label(name, 'Event name');
      const fields = allowed.get(name);
      if (!fields) throw new TypeError(`Event is not allowlisted: ${name}`);
      if (!hasConsent()) return false;
      if (!properties || typeof properties !== 'object' || Array.isArray(properties))
        throw new TypeError('Event properties must be a plain record.');
      const prototype = Object.getPrototypeOf(properties);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError('Event properties must be a plain record.');
      const propertyKeys = Reflect.ownKeys(properties);
      if (propertyKeys.some((key) => typeof key === 'symbol'))
        throw new TypeError('Event properties cannot contain symbol keys.');
      if (propertyKeys.length !== Object.keys(properties).length)
        throw new TypeError('Event properties cannot contain non-enumerable keys.');
      if (propertyKeys.length > fields.size)
        throw new RangeError('Event contains more properties than its allowlist permits.');
      const normalized: Record<string, TelemetryScalar> = {};
      for (const key of propertyKeys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(properties, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
          throw new TypeError('Event properties must be enumerable data properties.');
        label(key, 'Property name');
        if (!fields.has(key))
          throw new TypeError(`Property is not allowlisted for ${name}: ${key}`);
        const value: unknown = descriptor.value;
        if (typeof value === 'string') {
          if (value.length > maxStringLength)
            throw new RangeError(`Property ${key} exceeds maxStringLength.`);
        } else if (typeof value === 'number') {
          if (!Number.isFinite(value)) throw new TypeError(`Property ${key} must be finite.`);
        } else if (typeof value !== 'boolean' && value !== null) {
          throw new TypeError(`Property ${key} must be a string, finite number, boolean, or null.`);
        }
        Object.defineProperty(normalized, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      const event = Object.freeze({ name, properties: Object.freeze(normalized) });
      const bytes = byteLength(JSON.stringify(event));
      if (buffer.length >= maxEvents) throw new RangeError('Telemetry event buffer is full.');
      if (totalBytes + bytes > maxBytes) throw new RangeError('Telemetry byte budget exceeded.');
      buffer.push({ event, bytes });
      totalBytes += bytes;
      return true;
    },
    flush() {
      if (!hasConsent()) {
        clear();
        return Promise.resolve(0);
      }
      if (flushing) return flushing;
      if (buffer.length === 0) return Promise.resolve(0);
      const batchItems = buffer.slice();
      const batch = batchItems.map((item) => item.event);
      flushing = Promise.resolve()
        .then(() => options.transport(Object.freeze(batch)))
        .then(() => {
          for (const sent of batchItems) {
            const index = buffer.indexOf(sent);
            if (index >= 0) {
              buffer.splice(index, 1);
              totalBytes -= sent.bytes;
            }
          }
          return batch.length;
        })
        .finally(() => {
          flushing = undefined;
        });
      return flushing;
    },
    clear,
    pending: () => buffer.length,
  };
}
