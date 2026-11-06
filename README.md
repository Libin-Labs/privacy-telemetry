# @lp-labs/privacy-telemetry

Explicit-consent telemetry with per-event property allowlists, scalar-only payloads, a bounded in-memory
buffer, and an injected transport. The package never chooses a destination or transmits automatically.

## Install

```sh
npm install @lp-labs/privacy-telemetry
```

## Quick start

```js
import assert from 'node:assert/strict';
import { createTelemetry } from '@lp-labs/privacy-telemetry';

const deliveries = [];
let consent = true;
const telemetry = createTelemetry({
  allowlist: { screen_view: ['screen'] },
  consent: () => consent,
  transport: (events) => deliveries.push(...events),
});
assert.equal(telemetry.track('screen_view', { screen: 'settings' }), true);
assert.equal(await telemetry.flush(), 1);
assert.deepEqual(deliveries[0], {
  name: 'screen_view',
  properties: { screen: 'settings' },
});
consent = false;
assert.equal(telemetry.track('screen_view', { screen: 'home' }), false);
assert.equal(telemetry.pending(), 0);
```

## API and types

- `createTelemetry(options): TelemetryClient` constructs a client; options require an `allowlist`,
  a live `consent(): boolean` callback, and an injected `transport(events)` callback.
- `TelemetryClient.track(name, properties?): boolean` validates an allowlisted event and returns
  `false` when consent is off. Properties must be plain records containing only allowlisted scalar
  values (`string`, finite `number`, `boolean`, or `null`).
- `TelemetryClient.flush(): Promise<number>` delivers the current immutable batch and returns its
  event count. A transport rejection is propagated and the batch remains available for retry.
- `TelemetryClient.clear(): void` removes queued local events.
- `TelemetryClient.pending(): number` reports the number of buffered events.
- `TelemetryEvent` is the immutable `{ name, properties }` transport payload;
  `TelemetryProperties` is its immutable scalar record; `TelemetryScalar` is the allowed scalar union.
- `TelemetryOptions` describes event fields, consent, transport, and optional resource bounds.

## Customization and limits

Declare each event and each allowed field before use. Add only low-risk, purpose-limited properties;
do not place secrets, identifiers, free-form user input, or personal data in telemetry. Set `maxEvents`
(default 100, maximum 100,000), `maxBytes` (default 65,536 UTF-8 bytes, maximum 10,000,000), and
`maxStringLength` (default 256, maximum 16,384) to suit a deployment. The allowlist supports at most
256 events and 128 fields per event. No event is buffered without affirmative consent. If consent is
revoked before flush, pending events are cleared and no transport is called. `clear()` also discards
only local buffered data; it cannot retract events already delivered.

## Errors

Invalid options, unknown event names, unapproved properties, malformed property records, and non-finite
numbers throw `TypeError`. Invalid limits, overlong strings, full buffers, and byte-budget overruns throw
`RangeError`. A consent callback that does not return a boolean fails explicitly. Transport errors reject
`flush()`; callers should decide whether and when to retry.

## Scope and security

This is a local collection/buffering primitive, not consent management, anonymization, a network client,
or a guarantee that a transport is compliant. The application owns the consent source, data minimization,
transport security, retention, and legal basis.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
