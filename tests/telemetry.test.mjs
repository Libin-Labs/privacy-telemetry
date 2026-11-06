import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry } from '../dist/esm/index.js';

const setup = (overrides = {}) => {
  const sent = [];
  let allowed = true;
  const client = createTelemetry({
    allowlist: { opened: ['screen', 'count'], saved: [] },
    consent: () => allowed,
    transport: async (events) => sent.push(...events),
    ...overrides,
  });
  return { client, sent, setConsent: (value) => (allowed = value) };
};

test('records only allowlisted scalar properties and passes immutable events to transport', async () => {
  const { client, sent } = setup();
  assert.equal(client.track('opened', { screen: 'home', count: 2 }), true);
  assert.equal(await client.flush(), 1);
  assert.deepEqual(sent[0], { name: 'opened', properties: { screen: 'home', count: 2 } });
  assert.equal(Object.isFrozen(sent[0].properties), true);
});

test('explicit consent gates both collection and sending', async () => {
  const { client, sent, setConsent } = setup();
  setConsent(false);
  assert.equal(client.track('opened', { screen: 'home' }), false);
  assert.equal(client.pending(), 0);
  setConsent(true);
  client.track('saved');
  setConsent(false);
  assert.equal(await client.flush(), 0);
  assert.equal(client.pending(), 0);
  assert.equal(sent.length, 0);
});

test('rejects unknown events, unapproved properties, complex values, and invalid numbers', () => {
  const { client } = setup();
  assert.throws(() => client.track('secret'), /not allowlisted/);
  assert.throws(() => client.track('opened', { email: 'person@example.test' }), /not allowlisted/);
  assert.throws(() => client.track('opened', { screen: { name: 'home' } }), /must be a string/);
  assert.throws(() => client.track('opened', { count: Number.NaN }), /finite/);
  assert.throws(() => client.track('opened', Object.create({ screen: 'home' })), /plain record/);
});

test('preserves a literal __proto__ allowlisted field and rejects accessors without invoking them', async () => {
  const sent = [];
  const client = createTelemetry({
    allowlist: { special: ['__proto__'] },
    consent: () => true,
    transport: (events) => sent.push(...events),
  });
  const property = Object.fromEntries([['__proto__', 'safe-value']]);
  client.track('special', property);
  await client.flush();
  assert.equal(sent[0].properties.__proto__, 'safe-value');
  let invoked = false;
  const accessor = {};
  Object.defineProperty(accessor, '__proto__', {
    enumerable: true,
    get() {
      invoked = true;
      return 'unexpected';
    },
  });
  assert.throws(() => client.track('special', accessor), /data properties/);
  assert.equal(invoked, false);
  const hidden = {};
  Object.defineProperty(hidden, '__proto__', { value: 'hidden' });
  assert.throws(() => client.track('special', hidden), /non-enumerable/);
});

test('bounds event count, encoded bytes, strings, and allowlist sizes', () => {
  const { client } = setup({ maxEvents: 1 });
  client.track('saved');
  assert.throws(() => client.track('saved'), /buffer is full/);
  const byteBound = setup({ maxBytes: 16 }).client;
  assert.throws(() => byteBound.track('opened', { screen: 'a'.repeat(12) }), /byte budget/);
  const stringBound = setup({ maxStringLength: 2 }).client;
  assert.throws(() => stringBound.track('opened', { screen: 'long' }), /maxStringLength/);
  assert.throws(
    () => createTelemetry({ allowlist: {}, consent: () => true, transport() {} }),
    /1 to 256/,
  );
});

test('retains failed batches for retry and drains only after transport success', async () => {
  let attempts = 0;
  const client = createTelemetry({
    allowlist: { saved: [] },
    consent: () => true,
    transport: async () => {
      attempts++;
      if (attempts === 1) throw new Error('offline');
    },
  });
  client.track('saved');
  await assert.rejects(client.flush(), /offline/);
  assert.equal(client.pending(), 1);
  assert.equal(await client.flush(), 1);
  assert.equal(client.pending(), 0);
});

test('coalesces concurrent flushes and clear discards only local queued data', async () => {
  let release;
  let sends = 0;
  const client = createTelemetry({
    allowlist: { saved: [] },
    consent: () => true,
    transport: () => {
      sends++;
      return new Promise((resolve) => (release = resolve));
    },
  });
  client.track('saved');
  const first = client.flush();
  const second = client.flush();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 1);
  release();
  assert.equal(await first, 1);
  client.track('saved');
  client.clear();
  assert.equal(client.pending(), 0);
});

test('does not remove newly queued events when an in-flight batch is cleared', async () => {
  let release;
  let sends = 0;
  const client = createTelemetry({
    allowlist: { saved: [] },
    consent: () => true,
    transport: () => {
      sends++;
      return sends === 1 ? new Promise((resolve) => (release = resolve)) : undefined;
    },
  });
  client.track('saved');
  const flush = client.flush();
  await new Promise((resolve) => setImmediate(resolve));
  client.clear();
  client.track('saved');
  release();
  await flush;
  assert.equal(client.pending(), 1);
  assert.equal(await client.flush(), 1);
});

test('requires a boolean consent result and injected transport', () => {
  const malformed = createTelemetry({
    allowlist: { saved: [] },
    consent: () => 'yes',
    transport() {},
  });
  assert.throws(() => malformed.track('saved'), /boolean/);
  assert.throws(
    () => createTelemetry({ allowlist: { saved: [] }, consent: () => true, transport: null }),
    /transport/,
  );
  assert.throws(() => malformed.flush(), /boolean/);
});
