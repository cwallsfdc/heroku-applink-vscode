# Heroku AppLink for VS Code

Heroku AppLink for VS Code helps you run Heroku AppLink CLI commands directly from the Command Palette and a dedicated Explorer view. It streamlines working with AppLink connections and authorizations, Salesforce and Data Cloud integrations, and provides a convenient way to set and reuse default parameters (app, add-on, connection, authorization).

## Features

- Heroku AppLink Command Palette commands for common AppLink, Salesforce, and Data Cloud tasks.
- Explorer view to list and inspect AppLink Connections and Authorizations.
- “Diagnose Environment” to verify the Heroku CLI and AppLink plugin installation.
- “Set Defaults” to store default `app`, `add-on`, `connection`, and `authorization` values used across commands.
- Automatic installation of the Heroku AppLink CLI plugin from the GitHub repo if not present.

## Requirements

- Heroku CLI installed and available on your PATH.
- Heroku AppLink plugin. If missing, the extension can install it for you from:
  - https://github.com/heroku/heroku-cli-plugin-applink
  - https://github.com/cwallsfdc/heroku-cli-plugin-applink (for "AppLink: Data Cloud Deploy" command)

## Commands

- AppLink: Run Command...
- AppLink: Diagnose Environment
- AppLink: Set Default App
- AppLink: Set Defaults
- AppLink: List Connections
- AppLink: Show Connection Details
- AppLink: List Authorizations
- AppLink: Show Authorization Details
- AppLink: Salesforce Connect
- AppLink: Salesforce Connect (JWT)
- AppLink: Salesforce Disconnect
- AppLink: Salesforce Publish (requires app)
- AppLink: Salesforce Add Authorization
- AppLink: Salesforce Remove Authorization
- AppLink: Data Cloud Connect
- AppLink: Data Cloud Disconnect
- AppLink: Data Cloud Deploy (requires app)
- AppLink: Data Cloud Add Authorization
- AppLink: Data Cloud Remove Authorization
- AppLink: Data Cloud Create Data Action Target (requires app)

## Explorer View

Open the `AppLink` view (Activity Bar > Explorer > AppLink section) to:

- Browse Connections and Authorizations
- Open details for a selected item
- Copy IDs
- Refresh the view

## Settings

This extension contributes the following settings (scoped per user or workspace):

- `applink.defaultApp`: Default Heroku app name (used for `-a`).
- `applink.defaultAddon`: Default add-on name (used for `--add-on`).
- `applink.defaultConnection`: Default connection name (used for `--connection`).
- `applink.defaultAuthorization`: Default authorization name.
  - For most commands this is used as `--authorization`.
  - For `datacloud:deploy` this is used as `--authorization-name`.
- `applink.debugLogging`: When enabled, Explorer logs the exact command and raw CLI output to the "AppLink" output channel.
- `applink.debugHttp`: When enabled, commands run with `DEBUG="http,-http:headers"` so the Heroku CLI emits HTTP debug (the Explorer uses this as a parsing fallback).
- `applink.datacloudDeploy.accessToken`: When set, the extension will export `DEPLOY_ACCESS_TOKEN` for `datacloud:deploy`.
- `applink.datacloudDeploy.instanceUrl`: When set, the extension will export `DEPLOY_INSTANCE_URL` for `datacloud:deploy`.

Defaults are automatically applied to commands that support them. You can override by providing the flag explicitly at runtime.

Notes for Data Cloud Deploy:
- The underlying CLI now expects `--authorization-name` instead of `--authorization`.
- The extension automatically injects `--authorization-name <applink.defaultAuthorization>` when set.
- If you supply `--authorization` manually, the extension strips it and logs a note, to avoid errors.
- If `applink.datacloudDeploy.accessToken` or `applink.datacloudDeploy.instanceUrl` are set, the extension prepends `DEPLOY_ACCESS_TOKEN` / `DEPLOY_INSTANCE_URL` to the environment for `datacloud:deploy` only.

Debugging:
- Enable `applink.debugLogging` to see the command the extension runs and the raw CLI output in the AppLink output channel.
- Enable `applink.debugHttp` to add `DEBUG="http,-http:headers"` to the environment for all extension-invoked commands.

## Usage

1. Open the Command Palette and run “AppLink: Diagnose Environment” to verify your setup.
2. Optionally run “AppLink: Set Defaults” to store commonly used parameter values.
3. Run AppLink commands from the Command Palette or use the Explorer view to discover and inspect resources.

### Data Cloud Deploy

From the Command Palette or Explorer toolbar choose "AppLink: Data Cloud Deploy". The extension will:
- Add `-a <applink.defaultApp>` when set.
- Add `--add-on <applink.defaultAddon>` when set.
- Add `--authorization-name <applink.defaultAuthorization>` when set (note: not `--authorization`).
- If configured, export `DEPLOY_ACCESS_TOKEN` and `DEPLOY_INSTANCE_URL` to the CLI process.

Example:

```bash
heroku datacloud:deploy -a my-app --authorization-name my-dc-auth --name my_func
```

To troubleshoot, enable `applink.debugLogging` and `applink.debugHttp` and review the AppLink output channel.

## Testing

Manual verification steps:
- Set defaults via "AppLink: Set Defaults" (at minimum set `defaultApp`; optionally set `defaultAddon`, `defaultAuthorization`).
- Explorer: expand Connections and Authorizations. If none exist, you should see friendly placeholders that link to docs.
- Explorer parsing: with `applink.debugHttp` enabled, ensure HTTP debug appears and the Explorer can still list items using the trailing `http [ ... ]` JSON as a fallback.
- Run "AppLink: Data Cloud Deploy":
  - Confirm the command line in the output shows `--authorization-name` (not `--authorization`).
  - If you set `applink.datacloudDeploy.*`, confirm notes appear indicating `DEPLOY_*` overrides were applied.
  - With `applink.debugHttp` enabled, confirm a `Note: DEBUG=...` line appears.

## Packaging (.vsix)

Use `@vscode/vsce` to create a `.vsix` package you can install locally or distribute.

- Prerequisites
  - Node.js and npm installed
  - Run `npm ci` to install dependencies
  - The build output (`dist/extension.js`) is produced by the existing scripts

- Build the extension (production bundle)

```bash
npm run package
```

- Package into a `.vsix`

Primary (uses included npm script, no global install required):

```bash
npm run vsix
```

Alternative (run `vsce` directly via `npx`):

```bash
npx @vscode/vsce package
```

This will generate a file like `heroku-applink-vscode-0.0.1.vsix` in the project root.

Optional: install `vsce` globally instead of using `npx`:

```bash
npm i -g @vscode/vsce
vsce package
```

Notes:
- The `package.json` already includes `vscode:prepublish` and `package` scripts that build the production bundle. `vsce package` uses that output to create the `.vsix`.
- To install the built `.vsix` in VS Code, use the Extensions view menu > Install from VSIX..., and select the generated file.

## Release Notes

### 0.0.1

- Initial preview release with command palette support, Explorer view, default parameter management, and dynamic CLI help parsing for flag inference.
