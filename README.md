# AppLink for VS Code

AppLink for VS Code helps you run Heroku AppLink CLI commands directly from the Command Palette and a dedicated Explorer view. It streamlines working with AppLink connections and authorizations, Salesforce and Data Cloud integrations, and provides a convenient way to set and reuse default parameters (app, add-on, connection, authorization).

## Features

- AppLink Command Palette commands for common Heroku AppLink, Salesforce, and Data Cloud tasks.
- Explorer view to list and inspect AppLink Connections and Authorizations.
- “Diagnose Environment” to verify the Heroku CLI and AppLink plugin installation.
- “Set Defaults” to store default `app`, `add-on`, `connection`, and `authorization` values used across commands.
- Automatic installation of the Heroku AppLink CLI plugin from the GitHub repo if not present.

## Requirements

- Heroku CLI installed and available on your PATH.
- Heroku AppLink plugin. If missing, the extension can install it for you from:
  - https://github.com/cwallsfdc/heroku-cli-plugin-applink

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
- `applink.defaultAuthorization`: Default authorization name (used for `--authorization`).

Defaults are automatically applied to commands that support them. You can override by providing the flag explicitly at runtime.

## Usage

1. Open the Command Palette and run “AppLink: Diagnose Environment” to verify your setup.
2. Optionally run “AppLink: Set Defaults” to store commonly used parameter values.
3. Run AppLink commands from the Command Palette or use the Explorer view to discover and inspect resources.

## Release Notes

### 0.0.1

- Initial preview release with command palette support, Explorer view, default parameter management, and dynamic CLI help parsing for flag inference.
