export type CategoryId =
  | "security"
  | "permissions"
  | "token"
  | "footprint"
  | "maintainability"
  | "reliability"
  | "compatibility";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  maxScore: number;
}

export interface Finding {
  id: string;
  category: CategoryId;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  scoreImpact: number;
  file?: string;
  line?: number;
}

export interface SuppressedFinding {
  finding: Finding;
  reason: string;
}

export interface TextFile {
  path: string;
  absolutePath: string;
  bytes: number;
  content: string;
  lines: string[];
}

export interface ScannedFile {
  path: string;
  absolutePath: string;
  bytes: number;
  isText: boolean;
  readError?: string;
}

export interface ScanMetrics {
  totalFiles: number;
  totalBytes: number;
  textFiles: number;
  scriptFiles: number;
  dependencyFiles: number;
  referenceFiles: number;
  assetFiles: number;
  skillMdBytes: number;
  skillMdLines: number;
  estimatedActivationTokens: number;
  hasSkillMd: boolean;
  hasReadme: boolean;
  hasLicense: boolean;
  hasExamples: boolean;
  hasTests: boolean;
}

export interface SkillContext {
  rootPath: string;
  skillName: string;
  files: ScannedFile[];
  textFiles: TextFile[];
  skillFile?: TextFile;
  metrics: ScanMetrics;
}

export interface CategoryScore {
  id: CategoryId;
  label: string;
  maxScore: number;
  score: number;
}

export interface SkillReport {
  target: string;
  rootPath: string;
  displayPath?: string;
  skillName: string;
  score: number;
  grade: string;
  recommendation: string;
  categories: CategoryScore[];
  findings: Finding[];
  suppressedFindings: SuppressedFinding[];
  metrics: ScanMetrics;
}

export interface ScanReport {
  generatedAt: string;
  target: string;
  reports: SkillReport[];
  summary: {
    count: number;
    averageScore: number;
    minScore: number;
    highRiskCount: number;
    suppressedCount: number;
  };
  policy: {
    exclude: string[];
    ignoreRules: string[];
  };
}

export interface ScanOptions {
  target?: string;
  installed?: boolean;
  keepTemp?: boolean;
  exclude?: string[];
  ignoreRules?: string[];
}

export interface Rule {
  id: string;
  run(context: SkillContext): Finding[];
}

export interface ResolvedTarget {
  displayTarget: string;
  localPath: string;
  cleanup?: () => Promise<void>;
}
