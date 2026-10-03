# Publishing Fetchary

Run the release workflow from the Fetchary repository:

```bash
npm run publish
```

The script runs the tests, builds the npm package, publishes it to npm, updates
and pushes the Homebrew formula, then publishes a GitHub release.

## Preparation

- Set the new version in `package.json` and add its release notes under a matching
  version heading in `docs/changelog.md`.
- Commit and push the release changes. The Fetchary checkout must be clean, and
  its current commit must already be available in the GitHub repository.
- Authenticate with npm (`npm login`) and GitHub CLI (`gh auth login`). The
  GitHub account needs write access to the repository in `package.json`.
- Have a clean Homebrew tap checkout at `../homebrew-tap`, or set
  `HOMEBREW_TAP_PATH` or `--tap-path` to its location, with permission to push.

GitHub authentication, repository access, the release commit, and any existing
version tag are checked before publishing to npm.

## GitHub release

The GitHub release uses `v<version>` as its tag, `Fetchary <version>` as its title,
and the matching changelog section as its notes. A new tag points to the exact
commit used for the release. An existing tag must point to that same commit.

A published release is kept as it is when the workflow is retried. An existing
draft is updated with the changelog notes and published. Prerelease versions are
marked as GitHub prereleases. Prereleases and npm dist-tags other than `latest`
do not replace GitHub's latest release.

Preview the formula and release details locally:

```bash
npm run publish -- --dry-run
```

Dry runs run the tests and build the package, but do not require GitHub
authentication or publish anything. With uncommitted changes, the displayed
commit is the current `HEAD`; commit and push those changes before publishing.

## Options

Pass script options after `--`:

| Option | Behavior |
| --- | --- |
| `--dry-run` | Run tests, build the package, and preview the formula and GitHub release. |
| `--tap-path <path>` | Choose the Homebrew tap checkout. |
| `--tag <tag>` | Choose the npm dist-tag; defaults to `latest`. |
| `--otp <code>` | Supply the npm one-time password. |
| `--no-push` | Commit the Homebrew formula locally without pushing the tap; GitHub release publication still runs. |
| `--skip-tests` | Skip the test suite. |
| `--skip-npm` | Skip npm publication. |
| `--skip-brew` | Skip the Homebrew formula update. |
| `--skip-github` | Skip the GitHub release and its preflight checks. |
| `--help` | Show the publish script's help. |

## Resuming a partial publish

If npm succeeded but a later step failed, fix the reported issue and continue
without publishing the same npm version again:

```bash
npm run publish -- --skip-npm
```

If only the GitHub release remains:

```bash
npm run publish -- --skip-npm --skip-brew
```

Completed npm and Homebrew steps stay completed if GitHub publication fails.
