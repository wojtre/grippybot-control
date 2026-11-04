# Grippy Bot Control

Read README.md for setup and docs/development.md for implementation. For install or troubleshooting work, read skills/grippybot-setup/SKILL.md.

- Default to simulation for development: `python3 -m grippy_control --simulate`.
- Test with `python3 -m unittest discover -s tests -v`. No GPIO or pigpio package is required.
- Startup, opening the UI, config checking and diagnostics must not send servo pulses. Retain this invariant.
- Do not expose panel/pigpio beyond loopback. Use SSH forwarding.
- Preserve local config.json and data/ranges.json. Do not commit personal calibration, logs, passwords or keys.
- A code/setup request is not a request to move real hardware. Keep hardware tests explicit; do not restart an active controller without arranging support/STOP with its user.
- Keep beginner-facing explanations in Polish and separate computer commands from commands run on Pi.
