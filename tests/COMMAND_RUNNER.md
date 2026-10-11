# Command runner tests

Run from the repository root with Node.js 18 or newer:

```sh
node --test tests/command-runner.test.cjs
```

The tests evaluate the real `extension.js` module body in an isolated Node VM,
removing GNOME import declarations and the default export keyword. Gio
subprocesses and GLib timers are controlled doubles; production methods are not
copied or replaced. Each test gets independent process and timer state.

The scope is `SafeCommandRunner.run`, `cancel`, `destroy`, and `running`:
output/status contracts, exact output limits, spawn and communication errors,
timeout cancellation, replacement runs, stale completion cleanup, and teardown.
No subprocess, network request, wall-clock delay, or GNOME session is required.

Generate raw V8 unit coverage without installing dependencies:

```sh
NODE_V8_COVERAGE=/tmp/sjc-command-runner-coverage \
  node --test tests/command-runner.test.cjs
```

Use a fresh output directory for each revision. The VM script is tagged with
the absolute `extension.js` filename. Coverage refers to the import-stripped
source evaluated by the VM, not an unchanged-source line map. This suite does
not measure GNOME integration, widget rendering, Python feeds, or end-to-end
coverage; do not interpret its module-wide coverage as those measurements.
