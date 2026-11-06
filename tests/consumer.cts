import telemetry = require('@lp-labs/privacy-telemetry');

const client = telemetry.createTelemetry({
  allowlist: { view: ['screen'] },
  consent: () => true,
  transport: (events) => console.log(events.length),
});
client.track('view', { screen: 'home' });
