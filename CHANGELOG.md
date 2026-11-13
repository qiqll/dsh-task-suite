# Changelog

All notable changes to `dsh-task-suite` are documented here.

## 1.1.0 — 2026-11-12

### Added

- **Web task pipeline dashboard**: a read-only panel for the task pool, current worker, agent tree, completion metrics and the live event stream.
- **Better Sidebar integration**: a `任务流水线` tab, a `+` menu entry, and a frame-level launcher. Better Sidebar is a soft dependency: without it the Host tools still work and the Web app boots normally.
- **Host dashboard route** `GET /dsh-task-suite/state`, scoped by session and working directory.
- **Dashboard metrics**: completion rate, first-pass rate, 7-day throughput, median cycle time, WIP, verification count and confirm/reject counts.

### Fixed

- Register the dashboard route only after the `webServer` service is available, so a cold boot no longer serves an empty 404 from `/dsh-task-suite/state`.
- Read `agents` and `subagents` through optional service lookup, so the dashboard does not crash when those services are not injected.
- Parse dashboard responses defensively and report the HTTP status instead of surfacing a raw `Unexpected end of JSON input`.
- Keep Better Sidebar out of the hard client dependency list; the panel is optional and the Web app no longer waits forever for a missing service.
- Document that the client half needs one full DSH restart after first install; a page refresh alone does not rebuild the Web client graph.

### Changed

- Dashboard fetch errors now include the status code and a short response excerpt.
- README now describes the one-time restart and the soft Better Sidebar dependency.

## 1.0.0 — 2026-11-10

### Added

- Initial release: file-based P0–P3 task pool, `task-*` tool set, `task-loop` dispatcher, background subagent worker contract, git and file-snapshot acceptance, and the `task-admin` / `task-loop` / `task-worker` skills.
