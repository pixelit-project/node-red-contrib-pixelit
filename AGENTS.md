# Node-RED PixelIt agent guidance

This repository contains Node-RED nodes for controlling PixelIt displays.
Read `README.md`, `package.json` and the relevant node's JavaScript and HTML.

## Shared project requirements

Smooth device animations and ESP8266 memory compatibility are hard requirements.
Evaluate changes against the smallest supported device, not just ESP32 or a desktop.
Keep device-bound payloads, frame counts, dimensions, request frequency and concurrent
transfers bounded. Avoid unnecessary polling, retries or duplicate transfers that
consume firmware heap or interrupt playback. Do not raise firmware limits implicitly.
Consult the target firmware version's `include/AnimationLimits.h` and
`docs/development.md`; avoid copying limits here where they can become stale.
Builds and host tests alone do not prove smooth playback or safe device RAM usage.
For changes affecting device load, report whether ESP8266 timing and peak-memory
validation was performed, and identify any remaining gap.

## Related repositories

- [PixelIt](https://github.com/pixelit-project/PixelIt): device firmware and device-side HTTP/MQTT/WebSocket contracts.
- [PixelIt.Docs](https://github.com/pixelit-project/PixelIt.Docs): project and user documentation.
- [node-red-contrib-pixelit](https://github.com/pixelit-project/node-red-contrib-pixelit): Node-RED control nodes.
- [PixelIt.WebUI](https://github.com/pixelit-project/PixelIt.WebUI): device WebUI.
- [PixelIt.API](https://github.com/pixelit-project/PixelIt.API): bitmap API service, separate from the device API.

Inspect relevant companion code when changing shared formats or behavior. Preserve
compatibility with existing clients and supported firmware; explicitly identify
required companion changes and external documentation updates. Report unavailable
sources rather than assuming their behavior.

## Node conventions and validation

- Preserve registered node types, configuration fields, message formats and existing
  flows. Keep runtime code, editor UI, help text and examples consistent.
- Validate animation data and transport payloads against supported firmware.
  Do not silently truncate animations or send oversized requests.
- Bound queues and retries; clean up timers and pending work on node close/redeploy.
  Preserve playlist, alert and sleep behavior without flooding the device.
- Keep credentials in Node-RED credential storage. Do not expose secrets in logs,
  example flows or normal exported node properties.
- For code changes run `npm test` and `npm run check`. For editor or lifecycle
  changes also verify affected nodes in Node-RED, including redeployment.
- Update relevant examples and README guidance when behavior changes. Report checks
  and gaps; documentation-only changes do not need runtime tests.
