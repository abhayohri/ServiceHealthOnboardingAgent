// Tree Data Provider
// ------------------
// Presents a hierarchical view:
//   ResourceType -> PolicyFile(s) -> EventIds
// Heuristic association: a policy is shown under a resource type if ANY resource config
// for that resource type references the policy file.
// Future improvements:
//   * Lazy loading / virtualization for very large sets
//   * Context menu actions (open policy, add event, validate subset)
//   * Event detail hovers
import * as vscode from 'vscode';
import { getIndex } from './index';

export class RHCTreeProvider implements vscode.TreeDataProvider<RHCTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RHCTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Forces a UI refresh (used after re-index or validation). */
  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: RHCTreeItem): vscode.TreeItem { return element; }

  /**
   * Resolve children for a given tree node. Root: resource types aggregated from resource configs.
   */
  getChildren(element?: RHCTreeItem): Thenable<RHCTreeItem[]> {
    const index = getIndex();
    if (!element) {
  // Top-level: distinct resource types aggregated from resource configs
      const byResource = new Map<string, number>();
      for (const rc of index.resourceConfigs) {
        if (rc.resourceType) {
          byResource.set(rc.resourceType, (byResource.get(rc.resourceType) || 0) + 1);
        }
      }
      return Promise.resolve(Array.from(byResource.entries()).sort().map(([rt, count]) => new RHCTreeItem(rt, vscode.TreeItemCollapsibleState.Collapsed, `${count} configs`)));
  } else if (element.contextValue === 'resourceType') {
  // Child level (resourceType): list policy files associated via resource configs
      const items: RHCTreeItem[] = [];
      const indexPolicies = getIndex().policies;
      for (const p of indexPolicies) {
        // Heuristic: if any resource config with this resourceType references the policy
        const interested = getIndex().resourceConfigs.some(rc => rc.resourceType === element.label && rc.policyFile === p.file);
        if (interested) {
          const policyNode = new RHCTreeItem(p.file, vscode.TreeItemCollapsibleState.Collapsed, `${p.events.length} events`);
          policyNode.contextValue = 'policyFile';
          items.push(policyNode);
        }
      }
      return Promise.resolve(items);
  } else if (element.contextValue === 'policyFile') {
  const policy = getIndex().policies.find(p => p.file === element.label);
      if (!policy) return Promise.resolve([]);
      return Promise.resolve(policy.events.map(ev => {
        const leaf = new RHCTreeItem(`${ev.eventId}`, vscode.TreeItemCollapsibleState.None, ev.title || '');
        leaf.contextValue = 'event';
        return leaf;
      }));
    }
    return Promise.resolve([]);
  }
}

class RHCTreeItem extends vscode.TreeItem {
  constructor(public readonly label: string, collapsible: vscode.TreeItemCollapsibleState, description?: string) {
    super(label, collapsible);
    if (description) { this.description = description; }
    this.contextValue = 'resourceType';
  }
  contextValue: string;
  description?: string;
}