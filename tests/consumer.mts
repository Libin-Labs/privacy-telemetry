import { createTelemetry, type TelemetryEvent } from '@lp-labs/privacy-telemetry';

const sent: TelemetryEvent[][] = [];
const telemetry = createTelemetry({
  allowlist: { view: ['screen'] },
  consent: () => true,
  transport: (events) => {
    sent.push([...events]);
  },
});
telemetry.track('view', { screen: 'settings' });
await telemetry.flush();
