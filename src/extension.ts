// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as os from 'os';
import { AppLinkExplorer } from './explorer';

// All Heroku AppLink CLI commands we will expose as VS Code commands
const APPLINK_COMMANDS: readonly string[] = [
  'salesforce:disconnect',
  'salesforce:publications',
  'salesforce:publish',
  'datacloud:connect',
  'datacloud:disconnect',
  'datacloud:deploy',
  'applink:authorizations',
  'applink:authorizations:info',
  'applink:connections',
  'applink:connections:info',
  'salesforce:authorizations:add',
  'salesforce:authorizations:remove',
  'salesforce:connect',
  'salesforce:connect:jwt',
  'datacloud:authorizations:add',
  'datacloud:authorizations:remove',
  'datacloud:data-action-target:create',
] as const;

type CommandSchema = {
  requiresApp?: boolean;
  supportsJson?: boolean;
  supportedFlags?: {
    addon?: boolean;
    connection?: boolean;
    authorization?: boolean;
  };
  positional?: Array<{
    name: string;
    required?: boolean;
    prompt?: string;
  }>;
  // Future: positional args, validation, etc.
};

const COMMAND_SCHEMAS: Record<string, CommandSchema> = {
  'applink:connections': { supportsJson: true },
  'applink:connections:info': { supportsJson: true, positional: [{ name: 'idOrName', required: true, prompt: 'Enter a connection ID or name' }] },
  'applink:authorizations': { supportsJson: true },
  'applink:authorizations:info': { supportsJson: true, positional: [{ name: 'idOrName', required: true, prompt: 'Enter an authorization ID or name' }] },
  'salesforce:disconnect': {},
  'salesforce:publications': { supportsJson: true },
  'salesforce:publish': { requiresApp: true },
  'salesforce:authorizations:add': {},
  'salesforce:authorizations:remove': {},
  'salesforce:connect': {},
  'salesforce:connect:jwt': {},
  // Datacloud commands and their supported default flags
  'datacloud:connect': { supportedFlags: { addon: true, authorization: true } },
  'datacloud:disconnect': { supportedFlags: { addon: true, authorization: true } },
  'datacloud:authorizations:add': { supportedFlags: { authorization: true } },
  'datacloud:authorizations:remove': { supportedFlags: { authorization: true } },
  'datacloud:data-action-target:create': { requiresApp: true, supportedFlags: { connection: true } },
  // Default schema for newly added command
  'datacloud:deploy': { requiresApp: true, supportedFlags: { connection: true, authorization: true, addon: true } },
};

// Map a CLI command (e.g., "applink:connections") to an internal VS Code command id
// Use dot separators to remain compatible with common VS Code command id practices.
function toVSCodeCommandId(cliCommand: string): string {
  return `heroku-applink-vscode.${cliCommand.replace(/:/g, '.')}`;
}

// Cache for inferred command schemas from `heroku <cmd> --help`
const inferredSchemaCache = new Map<string, CommandSchema>();

function parseHelpForFlags(help: string): Partial<CommandSchema> {
  const lower = help.toLowerCase();
  const supportsJson = /\b--json\b/.test(help);
  const supportsAddon = /\b--add-on\b/.test(help) || /\b--addon\b/.test(help);
  const supportsConnection = /\b--connection\b/.test(help);
  const supportsAuthorization = /\b--authorization\b/.test(help) || /\bauthorization\b/.test(lower);
  const supportsAppFlag = /-a,?\s*--app\b/.test(help) || /\b--app\b/.test(help);
  const requiresApp = supportsAppFlag && (/(?:-a,?\s*--app[^\n]*\brequired\b)/i.test(help) || /usage:[^\n]*\s(-a|--app)\b/i.test(help));
  const supportedFlags: CommandSchema['supportedFlags'] = {
    addon: supportsAddon || undefined,
    connection: supportsConnection || undefined,
    authorization: supportsAuthorization || undefined,
  };
  return {
    supportsJson: supportsJson || undefined,
    requiresApp: requiresApp || undefined,
    supportedFlags,
  };
}

async function inferSchemaFromHelp(cliCommand: string): Promise<CommandSchema | undefined> {
  if (inferredSchemaCache.has(cliCommand)) {
    return inferredSchemaCache.get(cliCommand);
  }
  try {
    const { stdout } = await execPromise(`heroku ${cliCommand} --help`);
    const partial = parseHelpForFlags(stdout);
    const schema: CommandSchema = {
      requiresApp: partial.requiresApp,
      supportsJson: partial.supportsJson,
      supportedFlags: partial.supportedFlags,
    };
    inferredSchemaCache.set(cliCommand, schema);
    return schema;
  } catch {
    return undefined;
  }
}

async function getSchemaForCommand(cliCommand: string): Promise<CommandSchema> {
  const base = COMMAND_SCHEMAS[cliCommand] ?? {};
  // If base already provides all key hints, return it.
  if (base.supportedFlags && base.requiresApp !== undefined && base.supportsJson !== undefined) {
    return base;
  }
  const inferred = await inferSchemaFromHelp(cliCommand);
  if (!inferred) {
    return base;
  }
  return {
    requiresApp: base.requiresApp !== undefined ? base.requiresApp : inferred.requiresApp,
    supportsJson: base.supportsJson !== undefined ? base.supportsJson : inferred.supportsJson,
    supportedFlags: { ...inferred.supportedFlags, ...base.supportedFlags },
    positional: base.positional,
  };
}

function getWorkspaceCwd(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

let sharedOutput: vscode.OutputChannel | undefined;
export function getOutputChannel(): vscode.OutputChannel {
  if (!sharedOutput) {
    sharedOutput = vscode.window.createOutputChannel('AppLink');
  }
  return sharedOutput;
}

export function execPromise(cmd: string, options: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: options.cwd, env: process.env, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function ensureHerokuCli(): Promise<boolean> {
  try {
    await execPromise('heroku --version');
    return true;
  } catch {
    const choice = await vscode.window.showWarningMessage(
      'Heroku CLI is not installed or not available on PATH. Install the Heroku CLI to use AppLink commands.',
      'Open Install Guide',
      'Cancel',
    );
    if (choice === 'Open Install Guide') {
      vscode.env.openExternal(vscode.Uri.parse('https://devcenter.heroku.com/articles/heroku-cli'));
    }
    return false;
  }
}

export async function isApplinkPluginInstalled(): Promise<boolean> {
  try {
    const { stdout } = await execPromise('heroku plugins --json');
    const plugins = JSON.parse(stdout) as Array<{ name?: string; version?: string; alias?: string }>;
    return plugins.some(p => p.name === '@heroku-cli/plugin-applink');
  } catch {
    // If we cannot parse or fetch plugins, assume not installed
    return false;
  }
}

export async function ensureApplinkPlugin(): Promise<boolean> {
  if (await isApplinkPluginInstalled()) {
    return true;
  }

  const choice = await vscode.window.showInformationMessage(
    'The Heroku AppLink plugin is not installed. Install it now?',
    'Install Now',
    'Cancel',
  );
  if (choice !== 'Install Now') {
    return false;
  }

  const output = getOutputChannel();
  output.show(true);
  const repoUrl = 'https://github.com/cwallsfdc/heroku-cli-plugin-applink';
  output.appendLine(`$ heroku plugins:install ${repoUrl}`);

  return await new Promise<boolean>((resolve) => {
    const child = exec(`heroku plugins:install ${repoUrl}` , { env: process.env, windowsHide: true });
    child.stdout?.on('data', (d: string) => output.append(d));
    child.stderr?.on('data', (d: string) => output.append(d));
    child.on('close', (code: number | null) => {
      output.appendLine(os.EOL + `Plugin install exited with code ${code ?? 'null'}`);
      resolve(code === 0);
    });
    child.on('error', (err) => {
      output.appendLine(`Error: ${(err as Error).message}`);
      resolve(false);
    });
  });
}

async function runHerokuCommand(cliCommand: string): Promise<void> {
  const output = getOutputChannel();
  output.show(true);

  // Preconditions
  const hasCli = await ensureHerokuCli();
  if (!hasCli) {
    return;
  }
  const hasPlugin = await ensureApplinkPlugin();
  if (!hasPlugin) {
    return;
  }

  // Collect some helpful common flags informed by per-command schema
  const schema = await getSchemaForCommand(cliCommand);
  const defaultApp = vscode.workspace.getConfiguration('applink').get<string>('defaultApp') ?? '';
  let app: string | undefined = defaultApp;
  // Prompt for app name if required or default is empty; otherwise prefill
  if (schema.requiresApp || !defaultApp) {
    app = await vscode.window.showInputBox({
      title: `App name (-a) for heroku ${cliCommand}`,
      prompt: schema.requiresApp ? 'Enter a Heroku app name (required for this command)' : 'Optional: specify a Heroku app name (equivalent to -a <app>)',
      placeHolder: 'my-heroku-app',
      value: defaultApp,
      ignoreFocusOut: true,
    });
    if (schema.requiresApp && (!app || app.trim() === '')) {
      vscode.window.showWarningMessage('This command requires an app name (-a).');
      return;
    }
  }
  const jsonPick = schema.supportsJson
    ? await vscode.window.showQuickPick(['No', 'Yes'], {
        title: 'Output as JSON? (--json)',
        canPickMany: false,
        ignoreFocusOut: true,
      })
    : undefined;

  // Collect positional args (if any)
  const positionalInputs: string[] = [];
  if (schema.positional && schema.positional.length > 0) {
    for (const p of schema.positional) {
      const val = await vscode.window.showInputBox({
        title: `${cliCommand}: ${p.name}`,
        prompt: p.prompt ?? `Enter value for ${p.name}${p.required ? ' (required)' : ''}`,
        ignoreFocusOut: true,
      });
      if (p.required && (!val || val.trim() === '')) {
        vscode.window.showWarningMessage(`Missing required value for ${p.name}.`);
        return;
      }
      if (val && val.trim() !== '') {
        positionalInputs.push(val.trim());
      }
    }
  }

  // Allow the user to provide any extra flags/args as a final step
  const extraArgs = await vscode.window.showInputBox({
    title: `heroku ${cliCommand}`,
    prompt: 'Optional: enter additional flags/arguments',
    placeHolder: '--help',
    value: '',
    ignoreFocusOut: true,
  });

  const parts: string[] = ['heroku', cliCommand];
  // Add positional args first
  if (positionalInputs.length > 0) {
    parts.push(...positionalInputs);
  }
  if (app && app.trim() !== '') {
    parts.push('-a', app.trim());
  }
  // Apply default parameters if present and supported by the command (and not explicitly provided)
  const cfg = vscode.workspace.getConfiguration('applink');
  const defaultAddon = cfg.get<string>('defaultAddon')?.trim();
  const defaultConnection = cfg.get<string>('defaultConnection')?.trim();
  const defaultAuthorization = cfg.get<string>('defaultAuthorization')?.trim();
  const extra = (extraArgs || '').toLowerCase();
  if (schema.supportedFlags?.addon && defaultAddon && !extra.includes('--add-on') && !parts.includes('--add-on')) {
    parts.push('--add-on', defaultAddon);
  }
  if (schema.supportedFlags?.connection && defaultConnection && !extra.includes('--connection') && !parts.includes('--connection')) {
    parts.push('--connection', defaultConnection);
  }
  if (schema.supportedFlags?.authorization && defaultAuthorization && !extra.includes('--authorization') && !parts.includes('--authorization')) {
    parts.push('--authorization', defaultAuthorization);
  }
  if (jsonPick === 'Yes') {
    parts.push('--json');
  }
  if (extraArgs && extraArgs.trim() !== '') {
    parts.push(extraArgs.trim());
  }
  const cmd = parts.join(' ');
  const cwd = getWorkspaceCwd();

  output.appendLine(`$ ${cmd}`);
  if (!cwd) {
    output.appendLine('Note: No workspace folder found. Running in the extension host environment.');
  }

  const child = exec(cmd, { cwd, env: process.env, windowsHide: true });

  child.stdout?.on('data', (data: string) => output.append(data));
  child.stderr?.on('data', (data: string) => output.append(data));
  child.on('close', (code: number | null) => {
    output.appendLine(os.EOL + `Process exited with code ${code ?? 'null'}`);
  });
  child.on('error', (err) => {
    output.appendLine(`Error: ${(err as Error).message}`);
  });
}

// This method is called when your extension is activated
// Your extension is activated the very first time any of our commands are executed
export function activate(context: vscode.ExtensionContext) {
  console.log('heroku-applink-vscode activated');

  // Register a generic "Run any AppLink command" command with a quick pick
  const runAnyId = 'heroku-applink-vscode.run';
  const runAnyDisposable = vscode.commands.registerCommand(runAnyId, async () => {
    const pick = await vscode.window.showQuickPick(APPLINK_COMMANDS, {
      title: 'AppLink: Select a command to run',
      placeHolder: 'Choose a command...',
      canPickMany: false,
      ignoreFocusOut: true,
    });
    if (!pick) {
      return;
    }
    await runHerokuCommand(pick);
  });
  context.subscriptions.push(runAnyDisposable);

  // Register a dedicated VS Code command for each AppLink CLI command
  for (const cli of APPLINK_COMMANDS) {
    const id = toVSCodeCommandId(cli);
    const disposable = vscode.commands.registerCommand(id, async () => {
      await runHerokuCommand(cli);
    });
    context.subscriptions.push(disposable);
  }

  // Diagnostics command to verify environment readiness
  const diagId = 'heroku-applink-vscode.diagnose';
  const diagDisposable = vscode.commands.registerCommand(diagId, async () => {
    const output = getOutputChannel();
    output.show(true);
    output.appendLine('AppLink Diagnostics');
    output.appendLine('-------------------');
    output.appendLine('Checking Heroku CLI...');
    const hasCli = await ensureHerokuCli();
    output.appendLine(`Heroku CLI: ${hasCli ? 'OK' : 'Missing'}`);
    if (!hasCli) {
      output.appendLine('Please install the Heroku CLI and re-run diagnostics.');
      return;
    }
    output.appendLine('Checking AppLink plugin...');
    if (await isApplinkPluginInstalled()) {
      output.appendLine('AppLink plugin: Installed');
    } else {
      output.appendLine('AppLink plugin: Not installed');
      const proceed = await ensureApplinkPlugin();
      output.appendLine(`Plugin install attempted: ${proceed ? 'Success' : 'Failed/Skipped'}`);
    }
    output.appendLine('Diagnostics complete.');
  });
  context.subscriptions.push(diagDisposable);

  // Status bar item to open the AppLink command picker quickly
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = '$(link) AppLink';
  statusItem.tooltip = 'Open AppLink Command Picker';
  statusItem.command = runAnyId;
  statusItem.show();
  context.subscriptions.push(statusItem);

  // Register Tree View (Explorer)
  const explorer = new AppLinkExplorer();
  const viewId = 'applinkExplorer';
  vscode.window.registerTreeDataProvider(viewId, explorer);
  const refreshCmd = vscode.commands.registerCommand('heroku-applink-vscode.explorer.refresh', () => explorer.refresh());
  const openInfoCmd = vscode.commands.registerCommand('heroku-applink-vscode.explorer.openInfo', (node) => explorer.openInfo(node));
  const copyIdCmd = vscode.commands.registerCommand('heroku-applink-vscode.explorer.copyId', async (node: any) => {
    const id: string | undefined = node?.id;
    if (id) {
      await vscode.env.clipboard.writeText(id);
      vscode.window.showInformationMessage(`Copied ID: ${id}`);
    }
  });
  context.subscriptions.push(refreshCmd, openInfoCmd, copyIdCmd);

  // Command to set default app config
  const setDefaultAppCmd = vscode.commands.registerCommand('heroku-applink-vscode.setDefaultApp', async () => {
    const current = vscode.workspace.getConfiguration('applink').get<string>('defaultApp') ?? '';
    const app = await vscode.window.showInputBox({
      title: 'Set Default App (-a)',
      prompt: 'Enter a Heroku app name to use as default for AppLink commands',
      value: current,
      ignoreFocusOut: true,
    });
    if (app === undefined) {
      return; // cancelled
    }
    const targetPick = await vscode.window.showQuickPick(['Global', 'Workspace'], {
      title: 'Save scope',
      canPickMany: false,
      ignoreFocusOut: true,
    });
    const target = targetPick === 'Workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('applink').update('defaultApp', app.trim(), target);
    vscode.window.showInformationMessage(app.trim() === '' ? 'Cleared default app.' : `Default app set to ${app.trim()}`);
  });
  context.subscriptions.push(setDefaultAppCmd);

  // Command to set default AppLink parameters (app, add-on, connection, authorization)
  const setDefaultsCmd = vscode.commands.registerCommand('heroku-applink-vscode.setDefaults', async () => {
    const cfg = vscode.workspace.getConfiguration('applink');
    const currentApp = cfg.get<string>('defaultApp') ?? '';
    const currentAddon = cfg.get<string>('defaultAddon') ?? '';
    const currentConnection = cfg.get<string>('defaultConnection') ?? '';
    const currentAuthorization = cfg.get<string>('defaultAuthorization') ?? '';

    const app = await vscode.window.showInputBox({
      title: 'Default App (-a)',
      prompt: 'Enter default Heroku app name (-a)',
      value: currentApp,
      ignoreFocusOut: true,
    });
    if (app === undefined) { return; }
    const addon = await vscode.window.showInputBox({
      title: 'Default Add-on (--add-on)',
      prompt: 'Enter default Heroku add-on name (used as --add-on)',
      value: currentAddon,
      ignoreFocusOut: true,
    });
    if (addon === undefined) { return; }
    const connection = await vscode.window.showInputBox({
      title: 'Default Connection (--connection)',
      prompt: 'Enter default connection name (used as --connection)',
      value: currentConnection,
      ignoreFocusOut: true,
    });
    if (connection === undefined) { return; }
    const authorization = await vscode.window.showInputBox({
      title: 'Default Authorization (--authorization)',
      prompt: 'Enter default authorization name (used as --authorization)',
      value: currentAuthorization,
      ignoreFocusOut: true,
    });
    if (authorization === undefined) { return; }

    const targetPick = await vscode.window.showQuickPick(['Global', 'Workspace'], {
      title: 'Save scope',
      canPickMany: false,
      ignoreFocusOut: true,
    });
    const target = targetPick === 'Workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await cfg.update('defaultApp', (app ?? '').trim(), target);
    await cfg.update('defaultAddon', (addon ?? '').trim(), target);
    await cfg.update('defaultConnection', (connection ?? '').trim(), target);
    await cfg.update('defaultAuthorization', (authorization ?? '').trim(), target);
    vscode.window.showInformationMessage('Saved default AppLink parameters.');
  });
  context.subscriptions.push(setDefaultsCmd);
}

// This method is called when your extension is deactivated
export function deactivate() {
  // No-op currently
}
