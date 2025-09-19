import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as os from 'os';
import { ensureApplinkPlugin, ensureHerokuCli, execPromise, getOutputChannel } from './extension';

function parseTableOutput(text: string): Array<Record<string, string>> {
  // Parse CLI table-like output split by 2+ spaces.
  // Example:
  // ID           NAME        APP           TYPE
  // 123...       my-conn     my-app        salesforce
  const rawLines = text.split(/\r?\n/).map(l => l.replace(/\u001b\[[0-9;]*m/g, '')).map(l => l.trimEnd());
  const lines = rawLines.filter(l => l.trim() !== '');
  if (lines.length < 2) {
    return [];
  }
  // Find header: a line with multiple columns (2+ spaces separated) optionally followed by a divider of dashes
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cols = lines[i].split(/\s{2,}/);
    if (cols.length >= 2) {
      // If next line is a divider, it's very likely the header
      const next = lines[i + 1] ?? '';
      if (/^[-\s]+$/.test(next) || cols.every(c => /[a-z]/i.test(c))) {
        headerIdx = i;
        break;
      }
    }
  }
  if (headerIdx === -1) {
    return [];
  }
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const headerParts = lines[headerIdx].split(/\s{2,}/).map(h => normalize(h));
  // Skip divider line if present (e.g., ----- or box-drawing ───)
  let start = headerIdx + 1;
  if (lines[start] && /^[\-\s\u2500]+$/.test(lines[start])) {
    start += 1;
  }
  const rows: Array<Record<string, string>> = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(/\s{2,}/).map(p => p.trim());
    if (parts.length < 1) {
      continue;
    }
    const row: Record<string, string> = {};
    for (let j = 0; j < Math.min(headerParts.length, parts.length); j++) {
      row[headerParts[j]] = parts[j];
    }
    rows.push(row);
  }
  return rows;
}

function parseFallbackRows(text: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip divider or header-like lines
    if (/^[\-\=\u2500]+$/.test(line) || /^id\b/i.test(line)) { continue; }
    const parts = line.split(/\s{2,}|\t+/).filter(Boolean);
    if (parts.length === 0) { continue; }
    const rec: Record<string, string> = {};
    rec['id'] = parts[0];
    if (parts.length > 1) { rec['name'] = parts[1]; }
    if (parts.length > 2) { rec['app'] = parts[2]; }
    rows.push(rec);
  }
  return rows;
}

// Extract trailing HTTP debug JSON array from Heroku CLI DEBUG output
function extractHttpDebugJsonArray(stdout: string): any[] | undefined {
  const lines = stdout.split(/\r?\n/);
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*http \[$/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return undefined;
  }
  const buf: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*http\s+(.*)$/);
    if (m) {
      const content = m[1];
      if (content.trim() === ']') {
        buf.push(']');
        break;
      }
      buf.push(content);
    }
  }
  const jsonText = buf.join('\n');
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export type NodeType = 'connections' | 'authorizations' | 'connection' | 'authorization' | 'root';

export class AppLinkExplorer implements vscode.TreeDataProvider<AppLinkNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<AppLinkNode | undefined | void> = new vscode.EventEmitter<AppLinkNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<AppLinkNode | undefined | void> = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AppLinkNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AppLinkNode): Promise<AppLinkNode[]> {
    // Preconditions: ensure CLI + plugin
    const hasCli = await ensureHerokuCli();
    if (!hasCli) {
      return [];
    }
    const hasPlugin = await ensureApplinkPlugin();
    if (!hasPlugin) {
      return [];
    }

    if (!element) {
      const conns = new AppLinkNode('Connections', 'connections', vscode.TreeItemCollapsibleState.Collapsed);
      conns.iconPath = new vscode.ThemeIcon('link');
      conns.contextValue = 'connections-root';
      const auths = new AppLinkNode('Authorizations', 'authorizations', vscode.TreeItemCollapsibleState.Collapsed);
      auths.iconPath = new vscode.ThemeIcon('shield');
      auths.contextValue = 'authorizations-root';
      return [conns, auths];
    }

    if (element.nodeType === 'connections') {
      try {
        const defaultApp = vscode.workspace.getConfiguration('applink').get<string>('defaultApp')?.trim();
        const base = 'heroku applink:connections';
        const cmd = defaultApp && defaultApp.length > 0 ? `${base} -a ${defaultApp}` : base;
        const debugHttp = vscode.workspace.getConfiguration('applink').get<boolean>('debugHttp') === true;
        const env = debugHttp ? { ...process.env, DEBUG: 'http,-http:headers' } : process.env;
        const { stdout } = await execPromise(cmd, { env });
        const debug = vscode.workspace.getConfiguration('applink').get<boolean>('debugLogging') === true;
        if (debug) {
          const out = getOutputChannel();
          out.show(true);
          out.appendLine(`[Explorer] Ran: ${cmd}${debugHttp ? ' (with DEBUG="http,-http:headers")' : ''}`);
          out.appendLine('[Explorer] Raw connections output:');
          out.appendLine(stdout);
        }
        let items = parseTableOutput(stdout);
        if (items.length === 0) {
          items = parseFallbackRows(stdout);
        }
        // If still empty, check if stdout itself is a JSON array (CLI may print [])
        if (items.length === 0) {
          const t = stdout.trim();
          if (/^\[/.test(t)) {
            try {
              const arr = JSON.parse(t);
              if (Array.isArray(arr)) {
                items = arr.map((e: any) => {
                  const rec: Record<string, string> = {};
                  if (e && typeof e === 'object') {
                    if (e.id) { rec['id'] = String(e.id); }
                    if (e.status) { rec['status'] = String(e.status); }
                    if (e.addon_id) { rec['addon id'] = String(e.addon_id); }
                    const org = e.org || {};
                    if (org && typeof org === 'object') {
                      if (org.connection_name) { rec['connection name'] = String(org.connection_name); }
                      if (org.username) { rec['username'] = String(org.username); }
                      if (org.type) { rec['type'] = String(org.type); }
                    }
                  }
                  return rec;
                });
              }
            } catch {}
          }
        }
        // If still empty, try to parse trailing HTTP debug JSON
        if (items.length === 0) {
          const arr = extractHttpDebugJsonArray(stdout);
          if (Array.isArray(arr)) {
            items = arr.map((e: any) => {
              const rec: Record<string, string> = {};
              if (e && typeof e === 'object') {
                if (e.id) {
                  rec['id'] = String(e.id);
                }
                if (e.status) {
                  rec['status'] = String(e.status);
                }
                if (e.addon_id) {
                  rec['addon id'] = String(e.addon_id);
                }
                const org = e.org || {};
                if (org && typeof org === 'object') {
                  if (org.connection_name) {
                    rec['connection name'] = String(org.connection_name);
                  }
                  if (org.username) {
                    rec['username'] = String(org.username);
                  }
                  if (org.type) {
                    rec['type'] = String(org.type);
                  }
                }
              }
              return rec;
            });
          }
        }
        if (items.length === 0) {
          const node = new AppLinkNode('No connections found', 'root', vscode.TreeItemCollapsibleState.None);
          node.iconPath = new vscode.ThemeIcon('info');
          node.contextValue = 'placeholder';
          node.command = {
            title: 'Open Docs',
            command: 'heroku-applink-vscode.explorer.openDocs',
            arguments: ['https://devcenter.heroku.com/categories/add-ons']
          };
          return [node];
        }
        const nodes = items.map((c, idx) => {
          // normalize keys
          const keys = Object.keys(c).reduce<Record<string, string>>((acc, k) => {
            acc[k.toLowerCase()] = (c as any)[k];
            return acc;
          }, {});
          const id = keys['id'] || keys['connection id'] || keys['connection'] || keys['name'] || '';
          const connName = keys['connection name'] || keys['name'] || keys['connection'] || '';
          const username = keys['username'] || '';
          const type = keys['type'];
          const status = keys['status'];
          const addOn = keys['add on'] || keys['addon'] || keys['addon id'];
          const label = connName || username || id || `connection #${idx + 1}`;
          const node = new AppLinkNode(label, 'connection', vscode.TreeItemCollapsibleState.None);
          const descParts = [type ? `type: ${type}` : undefined, status ? `status: ${status}` : undefined, addOn ? `add-on: ${addOn}` : undefined].filter(Boolean);
          node.description = descParts.length > 0 ? descParts.join(' • ') : undefined;
          node.contextValue = 'connection';
          node.iconPath = new vscode.ThemeIcon('plug');
          node.tooltip = [
            label,
            id ? `ID: ${id}` : undefined,
            username ? `User: ${username}` : undefined,
            type ? `Type: ${type}` : undefined,
            status ? `Status: ${status}` : undefined,
            addOn ? `Add-On: ${addOn}` : undefined,
          ].filter(Boolean).join('\n');
          node.command = {
            title: 'Open Connection Info',
            command: 'heroku-applink-vscode.explorer.openInfo',
            arguments: [node, { id: connName || id || username, name: connName || id || username }],
          };
          node.id = id || connName || username || `${label}`;
          return node;
        });
        if (debug && nodes.every(n => n.label?.toString().toLowerCase().startsWith('connection'))) {
          const out = getOutputChannel();
          out.appendLine('[Explorer] Note: All connection labels fell back to generic names. Check the raw output above.');
        }
        return nodes;
      } catch (e) {
        const output = getOutputChannel();
        output.appendLine('Failed to load connections');
        if (e && typeof (e as any).stderr === 'string') {
          output.appendLine((e as any).stderr);
        }
        return [];
      }
    }

    if (element.nodeType === 'authorizations') {
      try {
        const defaultApp = vscode.workspace.getConfiguration('applink').get<string>('defaultApp')?.trim();
        const base = 'heroku applink:authorizations';
        const cmd = defaultApp && defaultApp.length > 0 ? `${base} -a ${defaultApp}` : base;
        const debugHttp = vscode.workspace.getConfiguration('applink').get<boolean>('debugHttp') === true;
        const env = debugHttp ? { ...process.env, DEBUG: 'http,-http:headers' } : process.env;
        const { stdout } = await execPromise(cmd, { env });
        const debug = vscode.workspace.getConfiguration('applink').get<boolean>('debugLogging') === true;
        if (debug) {
          const out = getOutputChannel();
          out.show(true);
          out.appendLine(`[Explorer] Ran: ${cmd}${debugHttp ? ' (with DEBUG="http,-http:headers")' : ''}`);
          out.appendLine('[Explorer] Raw authorizations output:');
          out.appendLine(stdout);
        }
        let items = parseTableOutput(stdout);
        if (items.length === 0) {
          items = parseFallbackRows(stdout);
        }
        // If still empty, check if stdout itself is a JSON array (CLI may print [])
        if (items.length === 0) {
          const t = stdout.trim();
          if (/^\[/.test(t)) {
            try {
              const arr = JSON.parse(t);
              if (Array.isArray(arr)) {
                items = arr.map((e: any) => {
                  const rec: Record<string, string> = {};
                  if (e && typeof e === 'object') {
                    const org = e.org || {};
                    if (org && typeof org === 'object') {
                      if (org.developer_name) { rec['developer name'] = String(org.developer_name); }
                      if (org.type) { rec['type'] = String(org.type); }
                    }
                    if (e.status) { rec['status'] = String(e.status); }
                    if (e.id) { rec['id'] = String(e.id); }
                  }
                  return rec;
                });
              }
            } catch {}
          }
        }
        // If we still have generic data, try to parse trailing HTTP debug JSON
        if (items.length === 0) {
          const arr = extractHttpDebugJsonArray(stdout);
          if (Array.isArray(arr)) {
            items = arr.map((e: any) => {
              const rec: Record<string, string> = {};
              if (e && typeof e === 'object') {
                const org = e.org || {};
                if (org && typeof org === 'object') {
                  if (org.developer_name) {
                    rec['developer name'] = String(org.developer_name);
                  }
                  if (org.type) {
                    rec['type'] = String(org.type);
                  }
                }
                if (e.status) {
                  rec['status'] = String(e.status);
                }
                if (e.id) {
                  rec['id'] = String(e.id);
                }
              }
              return rec;
            });
          }
        }
        if (items.length === 0) {
          const node = new AppLinkNode('No authorizations found', 'root', vscode.TreeItemCollapsibleState.None);
          node.iconPath = new vscode.ThemeIcon('info');
          node.contextValue = 'placeholder';
          node.command = {
            title: 'Open Docs',
            command: 'heroku-applink-vscode.explorer.openDocs',
            arguments: ['https://devcenter.heroku.com/categories/add-ons']
          };
          return [node];
        }
        const nodes = items.map((a, idx) => {
          const keys = Object.keys(a).reduce<Record<string, string>>((acc, k) => {
            acc[k.toLowerCase()] = (a as any)[k];
            return acc;
          }, {});
          const devName = keys['developer name'] || keys['name'] || keys['authorization'] || '';
          const addOn = keys['add on'] || keys['add-on'] || keys['addon'] || '';
          const id = keys['id'] || keys['authorization id'] || devName || addOn || '';
          const name = devName || addOn || id || '';
          const type = keys['type'];
          const status = keys['status'];
          const label = name || `authorization #${idx + 1}`;
          const node = new AppLinkNode(label, 'authorization', vscode.TreeItemCollapsibleState.None);
          const descParts = [type ? `type: ${type}` : undefined, status ? `status: ${status}` : undefined, addOn ? `add-on: ${addOn}` : undefined].filter(Boolean);
          node.description = descParts.length > 0 ? descParts.join(' • ') : undefined;
          node.contextValue = 'authorization';
          node.iconPath = new vscode.ThemeIcon('key');
          node.tooltip = [
            label,
            id ? `ID/Name: ${id}` : undefined,
            type ? `Type: ${type}` : undefined,
            status ? `Status: ${status}` : undefined,
            addOn ? `Add-On: ${addOn}` : undefined,
          ].filter(Boolean).join('\n');
          node.command = {
            title: 'Open Authorization Info',
            command: 'heroku-applink-vscode.explorer.openInfo',
            arguments: [node, { id: name || id, name: name || id }],
          };
          node.id = id || name || `${label}`;
          return node;
        });
        if (debug && nodes.every(n => n.label?.toString().toLowerCase().startsWith('authorization'))) {
          const out = getOutputChannel();
          out.appendLine('[Explorer] Note: All authorization labels fell back to generic names. Check the raw output above.');
        }
        return nodes;
      } catch (e) {
        const output = getOutputChannel();
        output.appendLine('Failed to load authorizations');
        if (e && typeof (e as any).stderr === 'string') {
          output.appendLine((e as any).stderr);
        }
        return [];
      }
    }

    return [];
  }

  async openInfo(node: AppLinkNode, raw?: any) {
    const output = getOutputChannel();
    output.show(true);

    const isConn = node.nodeType === 'connection';
    const id = raw?.id || raw?.name || node.id;
    if (!id) {
      vscode.window.showWarningMessage('No identifier found to fetch details.');
      return;
    }

    const defaultApp = vscode.workspace.getConfiguration('applink').get<string>('defaultApp')?.trim();
    const base = isConn ? `heroku applink:connections:info ${id}` : `heroku applink:authorizations:info ${id}`;
    const cmd = defaultApp && defaultApp.length > 0 ? `${base} -a ${defaultApp}` : base;
    output.appendLine(`$ ${cmd}`);
    const child = exec(cmd, { env: process.env, windowsHide: true });
    child.stdout?.on('data', (d: string) => output.append(d));
    child.stderr?.on('data', (d: string) => output.append(d));
    child.on('close', (code: number | null) => {
      output.appendLine(os.EOL + `Process exited with code ${code ?? 'null'}`);
    });
    child.on('error', (err) => {
      output.appendLine(`Error: ${(err as Error).message}`);
    });
  }
}

export class AppLinkNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly nodeType: NodeType,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
  }
}
