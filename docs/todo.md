Implement schedule-bound desktop notifications in the Fetchary repository.

Context:

Fetchary is a local-first web monitoring and evidence archiving CLI/library.

Current relevant CLI behavior:

```bash
fetchary schedule <id> <interval> [--now]
fetchary schedules
fetchary run
```

Schedules are persisted in SQLite and processed by the persistent scheduler started through:

```bash
fetchary run
```

Fetchary already distinguishes between:

- unchanged
- raw response changed, but visible/content comparison unchanged
- actual content change

Notifications must be tied to an individual persisted schedule, not globally to `fetchary run`.

## Goal

Add support for:

```bash
fetchary schedule 4 6h --notify desktop
```

This means:

- source `4` is checked every `6h`
- the schedule has the notification target `desktop`
- when the scheduler detects an actual content change for that scheduled source, Fetchary sends a native desktop notification
- unchanged checks must not trigger a notification
- raw-only changes where `contentChanged === false` must not trigger a notification
- notification failures must never break fetching, archiving, scheduling, or the Fetchary runner

For this first implementation, support only the built-in notification type:

```text
desktop
```

Do not build a generic notification-provider configuration system yet.

However, structure the implementation so additional notification types such as `webhook`, `command`, `imessage`, or `ntfy` could be added later without rewriting the scheduler.

## Desired CLI

### Create or update schedule

```bash
fetchary schedule 4 6h --notify desktop
```

Existing syntax must continue to work:

```bash
fetchary schedule 4 6h
fetchary schedule 4 6h --now
fetchary schedule 4 6h --now --notify desktop
```

The `--notify` option should accept a value.

For now valid values are:

```text
desktop
```

Unknown notification values should produce a clear validation error.

Example:

```bash
fetchary schedule 4 6h --notify foo
```

should fail with something similar to:

```text
Error: unsupported notification type "foo"
```

### List schedules

Extend:

```bash
fetchary schedules
```

with a `NOTIFY` column.

Example:

```text
ID  EVERY  NOTIFY   LAST RUN  NEXT RUN
4   6h     desktop  2h ago    in 4h
7   1h     -        42m ago   in 18m
```

`fetchary schedules --json` should also expose the persisted notification configuration.

## Persistence

The notification setting belongs to the schedule.

Extend the current SQLite schedule model accordingly.

Prefer a schema that can grow to multiple notification targets later.

A reasonable representation would be either:

```js
notifications: ['desktop'];
```

or an equivalent persisted JSON representation.

Do not attach the notification configuration directly to the source because the concept belongs to the schedule.

Existing databases must continue to work.

Add an appropriate migration or backwards-compatible schema update so existing schedules simply behave as:

```js
notifications: [];
```

## Notification behavior

Notifications are triggered only when a scheduled fetch results in:

```js
contentChanged === true;
```

Do not trigger for:

```js
changed === false;
```

or:

```js
rawChanged === true;
contentChanged === false;
```

The notification should only be sent after the new version has successfully been archived.

Example notification:

Title:

```text
Fetchary · Change detected
```

Body:

```text
Example News changed · version 7
```

If the source has no name, use something sensible such as:

```text
Source #4 changed · version 7
```

Do not include the entire diff or page content.

## Native desktop implementation

Do not add a large notification dependency unless absolutely necessary.

Prefer built-in OS commands.

Create a small notification abstraction, for example:

```text
src/
  notifications/
    index.js
    desktop.js
```

or an equivalent structure consistent with the existing repository.

Suggested API:

```js
await notify('desktop', {
    title,
    message,
});
```

or:

```js
await notifications.send('desktop', {
    title,
    message,
});
```

### macOS

Use a native approach such as `osascript`.

Example conceptually:

```bash
osascript -e 'display notification "Example News changed · version 7" with title "Fetchary · Change detected"'
```

Use `spawn`/`execFile` safely.

Do not construct unsafe shell commands from page names, URLs, or other external values.

### Linux

If reasonable, support:

```text
notify-send
```

### Windows

If reasonable without adding significant complexity, support a native PowerShell toast or notification mechanism.

If cross-platform support becomes disproportionately complex, macOS support is acceptable for the first implementation, but the abstraction must make the unsupported-platform behavior clean.

Unsupported platforms must not crash Fetchary.

Notification failures should be treated as non-fatal.

## Failure handling

This is important.

A notification error must never affect evidence collection.

The following must continue succeeding even if desktop notifications fail:

```text
fetch
hashing
archiving
SQLite version creation
schedule state updates
next-run calculation
scheduler loop
```

Example:

```js
try {
    await notify(...)
} catch (error) {
    // emit/log diagnostic information
}
```

Prefer integrating this with Fetchary's existing events/hooks/error conventions rather than silently swallowing everything.

If appropriate, introduce an event such as:

```text
notification:error
```

but avoid unnecessary API expansion if existing diagnostics already provide a clean mechanism.

## Scheduler architecture

Keep the notification logic outside the fetch/archive core.

The intended flow is:

```text
scheduler
    ↓
scheduled fetch
    ↓
Fetchary core archives response
    ↓
contentChanged === true
    ↓
schedule has notifications
    ↓
notification dispatcher
    ↓
desktop notification
```

Do not make `fetch()` itself automatically send notifications when called through the library or through:

```bash
fetchary fetch
```

Only scheduler-triggered fetches belonging to a schedule configured with `--notify` should trigger them.

This distinction is important.

These should not notify:

```bash
fetchary fetch 4
fetchary fetch
```

unless they are being executed internally as part of a configured scheduler run.

## Library API

Extend the existing schedule API without breaking callers.

Currently code may effectively do:

```js
await fetchary.schedule(sourceId, interval, {
    now: true,
});
```

Add support for something along the lines of:

```js
await fetchary.schedule(sourceId, interval, {
    now: true,
    notifications: ['desktop'],
});
```

or:

```js
await fetchary.schedule(sourceId, interval, {
    now: true,
    notify: 'desktop',
});
```

Prefer `notifications` internally because it leaves room for multiple channels later.

The CLI can still expose the simpler:

```bash
--notify desktop
```

## Updating schedules

If a schedule already exists:

```bash
fetchary schedule 4 6h --notify desktop
```

should update the existing schedule rather than create duplicate schedules.

Preserve the current Fetchary behavior for rescheduling.

Consider how notification configuration behaves when the user later runs:

```bash
fetchary schedule 4 12h
```

Prefer preserving the existing notification setting unless the current schedule API clearly treats the command as full replacement.

If the existing architecture makes replacement semantics more appropriate, document and test the behavior.

Do not invent a `--no-notify` flag unless needed for a clean implementation.

If notification removal becomes necessary, a natural future syntax could be:

```bash
fetchary schedule 4 6h --notify none
```

but do not implement additional CLI surface unless required.

## Argument parser

The CLI currently has sets such as:

```js
VALUE_OPTIONS;
REPEATABLE_VALUE_OPTIONS;
FLAG_OPTIONS;
```

Integrate `notify` consistently with the existing parser.

Update:

- `HELP`
- `EXAMPLES` where useful
- `COMMAND_GUIDANCE.schedule`
- README CLI documentation
- monitoring/scheduling documentation

The documented command should become something similar to:

```text
fetchary schedule <id> <interval> [--now] [--notify <type>]
```

## Tests

Add tests covering at least:

1. `schedule --notify desktop` parsing
2. notification configuration is persisted
3. `schedules` returns notification configuration
4. `schedules --json` exposes it
5. existing schedules without notifications still work
6. invalid notification types are rejected
7. scheduled content changes trigger a notification
8. unchanged scheduled fetches do not notify
9. raw-only changes do not notify
10. manual `fetch` does not notify
11. notification failures do not fail the fetch or scheduler
12. reloading Fetchary from the same data directory preserves notification configuration
13. database migration/backwards compatibility
14. existing scheduler tests remain green

The tests must not show real operating-system notifications.

Make the notification dispatcher injectable or mockable so tests stay deterministic.

## Compatibility

Preserve:

- Node.js >= 22.5
- CommonJS
- current public API unless extending it
- current exit codes
- current scheduler locking semantics
- current SQLite storage behavior
- local-first design
- zero cloud dependencies

Do not introduce accounts, remote services, analytics, telemetry, or cloud notification infrastructure.

## Code quality

Before changing code:

1. inspect the current scheduler implementation
2. inspect schedule persistence/schema
3. inspect current migrations/schema initialization
4. inspect the existing event/hook implementation
5. inspect current scheduler and CLI tests

Then implement the feature using the existing conventions of the project rather than creating a parallel architecture.

Keep the implementation small and explicit.

Avoid speculative abstractions.

The final architecture should essentially remain:

```text
Fetchary core
    |
    +-- archive/change detection

Scheduler
    |
    +-- schedule metadata
    |     └── notifications
    |
    +-- scheduled fetch
          |
          └── actual content change
                |
                └── notification dispatcher
                        |
                        └── desktop
```

## Final verification

Run the full test suite:

```bash
npm test
```

Fix any regressions.

Also manually verify the expected CLI flows:

```bash
fetchary schedule 4 6h --notify desktop
fetchary schedules
fetchary schedules --json
fetchary run
```

Update README/docs so users can discover the feature.

Do not change unrelated functionality.
