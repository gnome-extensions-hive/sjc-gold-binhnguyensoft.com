# About-window preferences contracts

Run from the repository root with Node.js 18 or newer:

```sh
node --test tests/prefs-about.test.cjs
```

The suite executes the original `prefs.js::_showAbout` method in a fresh
Node VM with a recording `Adw.AboutWindow` double. Import declarations and
the default-export prefix are replaced by equal-length spaces, preserving
source offsets. No production method is copied or modified. No packages,
network access, display server or user settings are required.

Contracts cover metadata-derived name/version/issue URL, developer/website
attribution, exact parent identity, modality, construction/presentation
ordering, repeated activation, updated metadata, instance isolation and
construction/presentation error propagation. `fillPreferencesWindow`,
its activation-signal wiring, settings, GTK rendering and live GNOME
integration are outside this suite. URL assertions use canonical URLs
without trailing slashes; URL normalization is not established.

Generate raw unit coverage outside the checkout:

```sh
git rev-parse HEAD
NODE_V8_COVERAGE=/tmp/sjc-prefs-about-coverage node --test tests/prefs-about.test.cjs
```

V8 JSON identifies the adapted script by its `prefs.js` filename. Interpret
function/block ranges against the equal-length adapted source; this is
mocked unit evidence, not a module-wide line percentage. Record the revision
and timestamp with any retained output.

Base `main@1588c7683d113e42d2f36a69165a9bacd6b1d95b` contains no tracked
unit/integration/E2E runner, CI definition or coverage command. On
2026-10-08, baseline `node --test` discovered zero tests; authorized GitHub
Actions workflows/runs/artifacts and revision checks/statuses returned zero
records. Integration/E2E coverage is unknown, not zero. There is no
compatible integration/E2E raw data to combine with these unit results.
