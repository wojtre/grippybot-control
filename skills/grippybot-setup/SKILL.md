---
name: grippybot-setup
description: "Install, configure, explain or troubleshoot the Grippy Bot Control browser panel on Raspberry Pi 4, including SSH, pigpio, systemd and per-servo calibration. Use for this controller, not unrelated robot controllers."
---

# Grippy Bot Control

Help the user run the public `wojtre/grippybot-control` project and explain each step in their language. Keep commands copyable and distinguish commands for the computer from commands inside Pi's SSH session.

## Locate the project and route

Find the checkout containing `grippy_control/`, `config.example.json` and `scripts/install-pi.sh`. If missing, clone `https://github.com/wojtre/grippybot-control.git` into a user-appropriate directory. Read its `README.md` for the supported setup and current commands. Do not assume your current directory is the checkout or that the user has our original prototype.

Read only the relevant additional document from the checkout:

- `docs/wiring.md` for power, common ground or GPIO numbering.
- `docs/usage.md` for calibration, live checkboxes and the schematic.
- `docs/troubleshooting.md` for SSH, services, missing packages or jitter.
- `docs/development.md` for code changes, tests, API, update or uninstall.

## Operational facts that change decisions

- Reference: Pi 4, Raspberry Pi OS Lite Legacy/Bookworm, Python ≥3.10. Hardware prototype used 64-bit Bookworm. Installer accepts Pi 4 Model B/400, but Pi 400 has not been hardware-tested. Pi 5 needs a different GPIO backend; do not pretend installing a Python package adds support.
- The Python server listens on `127.0.0.1:8765`; the local-only pigpio daemon is on 8889. A computer reaches the browser through an SSH tunnel. Do not broaden network binding to solve an SSH issue.
- Never assume a login, host, password, private key, PSU rating or a safe servo range. Get the user's login/host or use clearly marked placeholders. They enter passwords in their own terminal; do not request private keys or Wi-Fi passwords in chat.
- `--simulate`, `--check-config`, `scripts/doctor.py`, `/api/state`, service status and logs do not command movement. Prefer them for initial diagnosis.
- Installation enables boot services but startup sends no servo pulses. The installer detects existing controllers and refuses to take them over. Do not kill unknown processes or silently disable an existing robot stack.
- Calibration belongs to that physical robot: preserve `config.json` and `data/ranges.json`. Never copy someone else's extrema as verified limits. 500–2500 µs are software technical bounds, not safe travel guarantees.
- `1500 µs` is nominal servo center. Live-on enables checked inactive servos at this value. Unchecking a servo disables its signal; STOP disables all signals. Those actions can release an unsupported arm. Closing the page, dropping SSH or leaving live mode does not remove power and can leave the last target active.
- The SVG and saved `pulse` values are commanded positions, not measured angles. No feedback, automatic collision detection, hardware power cut is implemented.

## Work with the user

Act within the requested setup/code task. Installation, reading state or improving docs does not authorize a test movement. Before a hardware test, establish which joint, what command and whether the mechanism is supported/clear; let the user perform it if they prefer. Before restarting a running hardware controller, inspect active outputs and arrange support/STOP if the arm is being held.

For code changes, run `python3 -m unittest discover -s tests -v` from the repository. Use simulation for UI tests and do not deploy to a live Pi as a side effect of a local change. Report what was tested and what still requires physical verification. For jitter, investigate power/ground, actual signal and unloaded servos rather than increasing speed or extrema.
