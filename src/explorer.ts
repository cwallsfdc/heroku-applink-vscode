import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as os from 'os';
import { ensureApplinkPlugin, ensureHerokuCli, execPromise, getOutputChannel } from './extension';

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
        const { stdout } = await execPromise('heroku applink:connections --json');
        const items = JSON.parse(stdout) as Array<{ id?: string; name?: string; app?: string; type?: string }>;
        return items.map((c) => {
          const label = c.name || c.id || 'connection';
          const node = new AppLinkNode(label, 'connection', vscode.TreeItemCollapsibleState.None);
          node.description = c.app ? `app: ${c.app}` : undefined;
          node.contextValue = 'connection';
          node.iconPath = new vscode.ThemeIcon('plug');
          node.command = {
            title: 'Open Connection Info',
            command: 'heroku-applink-vscode.explorer.openInfo',
            arguments: [node, c],
          };
          node.id = c.id || c.name;
          return node;
        });
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
        const { stdout } = await execPromise('heroku applink:authorizations --json');
        const items = JSON.parse(stdout) as Array<{ id?: string; name?: string; org?: string }>;
        return items.map((a) => {
          const label = a.name || a.id || 'authorization';
          const node = new AppLinkNode(label, 'authorization', vscode.TreeItemCollapsibleState.None);
          node.description = a.org ? `org: ${a.org}` : undefined;
          node.contextValue = 'authorization';
          node.iconPath = new vscode.ThemeIcon('key');
          node.command = {
            title: 'Open Authorization Info',
            command: 'heroku-applink-vscode.explorer.openInfo',
            arguments: [node, a],
          };
          node.id = a.id || a.name;
          return node;
        });
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

    const cmd = isConn ? `heroku applink:connections:info ${id} --json` : `heroku applink:authorizations:info ${id} --json`;
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
