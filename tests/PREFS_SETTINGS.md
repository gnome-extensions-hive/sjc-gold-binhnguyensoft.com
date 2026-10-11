# Preferences settings tests

Run from the repository root with Node.js 18 or newer:

```sh
node --test tests/prefs-settings.test.cjs
```

The suite executes the original `prefs.js` body in a fresh Node VM for each
preferences instance, removing only GI/resource imports and the default export.
GNOME adapters are test doubles; no packages, display server, subprocesses or
network access are required.

It checks `fillPreferencesWindow` page/group placement, schema-derived labels
and adjustment bounds, integer spin controls, position settings bindings,
saved duration initialization, duration notification writes, and independent
settings instances. `_showAbout`, live GTK/GSettings behavior and GNOME
integration are outside this suite.

Generate raw unit coverage from the repository root:

```sh
NODE_V8_COVERAGE=.coverage/prefs-settings node --test tests/prefs-settings.test.cjs
```

V8 JSON files identify the evaluated script by its `prefs.js` filename. Import
removal changes source offsets, so interpret ranges against the adapted source
in the test, not as unchanged-source line percentages. Keep generated coverage
untracked and record the tested revision alongside any retained output.

The base repository at `1588c7683d113e42d2f36a69165a9bacd6b1d95b` documents
no integration/E2E suite or coverage mechanism. Authorized GitHub Actions
runs, workflows, artifacts and revision checks/statuses were empty on
2026-10-03. E2E coverage is unknown, not zero; these mocked unit results
cannot establish GNOME E2E coverage or a combined coverage percentage.
