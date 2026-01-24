export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  expanded?: boolean;
  gitStatus?: string;
  agentModified?: boolean;
  lineCount?: number;
  diffStats?: DiffStats;
  hasChangedChildren?: boolean; // For directories
  // Aggregated stats for directories
  totalLines?: number;
  totalAdditions?: number;
  totalDeletions?: number;
}

export interface FlatNode {
  node: FileNode;
  depth: number;
}
