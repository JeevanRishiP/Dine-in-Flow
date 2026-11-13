#!/usr/bin/env node
/**
 * Zero-dependency AST + Security Policy Linter for Dineflow packages.
 * Uses the workspace's installed `typescript` compiler API and inspects
 * source/test files across each package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const pkgFlagIdx = args.indexOf('--package');
const packageDir = path.resolve(pkgFlagIdx >= 0 && args[pkgFlagIdx + 1] ? args[pkgFlagIdx + 1] : process.cwd());

const req = createRequire(path.join(packageDir, 'package.json'));
let ts;
try {
  ts = req('typescript');
} catch {
  // Fallback lookup if running from a subpackage without direct TS dependency
  const rootReq = createRequire(path.resolve(packageDir, '../../package.json'));
  ts = rootReq('typescript');
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.next-dev', '.turbo', 'coverage']);

function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

const targetDirs = ['src', 'app']
  .map((sub) => path.join(packageDir, sub))
  .filter((d) => fs.existsSync(d));

const files = targetDirs.flatMap((d) => collectFiles(d));
if (files.length === 0) {
  console.log(`[lint] No source files in ${path.basename(packageDir)}`);
  process.exit(0);
}

const errors = [];
const isFrontend = packageDir.endsWith('console-web') || packageDir.endsWith('customer-web');
const isApi = packageDir.endsWith(`${path.sep}api`);

for (const filePath of files) {
  const relPath = path.relative(packageDir, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const isTest = /\.(spec|test)\.tsx?$|__tests__/.test(relPath);

  // 1. TypeScript parse / syntax verification (covers spec files excluded from tsconfig.json)
  if (/\.tsx?$/.test(filePath)) {
    const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2022, true, scriptKind);
    if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
      for (const diag of sourceFile.parseDiagnostics) {
        const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
        const { line } = sourceFile.getLineAndCharacterOfPosition(diag.start ?? 0);
        errors.push(`${relPath}:${line + 1} [syntax] ${msg}`);
      }
    }
  }

  // 2. Policy & Security checks line-by-line
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    // @ts-ignore / @ts-nocheck requires explicit justification comment
    if (/@ts-(ignore|nocheck)/.test(line)) {
      const prevLine = idx > 0 ? lines[idx - 1] : '';
      const hasReason = /\/\/.*:\s*\S+/.test(line) || /\/\/.*\S{10,}/.test(prevLine);
      if (!hasReason) {
        errors.push(`${relPath}:${lineNo} [ts-suppression] @ts-ignore/@ts-nocheck without justification comment`);
      }
    }

    // Disallowed runtime code execution & XSS sinks
    if (!isTest && /\b(eval|new Function)\s*\(/.test(line)) {
      errors.push(`${relPath}:${lineNo} [security] Dynamic code execution (${RegExp.$1}) is prohibited`);
    }
    if (/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(line)) {
      errors.push(`${relPath}:${lineNo} [security] Unescaped HTML sink is prohibited`);
    }

    // Disallowed unofficial WhatsApp adapters / libraries (AGENTS §2 rule 11)
    if (/(whatsapp-web\.js|@whiskeysockets\/baileys|evolution\.adapter)/i.test(line)) {
      errors.push(`${relPath}:${lineNo} [policy] Unofficial WhatsApp integrations are prohibited`);
    }

    // Frontend security regressions (SECs 01-08)
    if (isFrontend) {
      const bannedFrontendTokens = [
        'StaffPass@2026',
        'PilotLaunch2026!',
        'ExecutiveSecure2026!',
        'royalspicebistro@icici',
        '/orders/feed',
        '/status/public',
        'simulate-success',
        'simulate-order-success',
        'trycloudflare.com',
      ];
      for (const token of bannedFrontendTokens) {
        if (line.includes(token)) {
          errors.push(`${relPath}:${lineNo} [frontend-sec] Forbidden legacy token/endpoint '${token}'`);
        }
      }

      if (!isTest && /localStorage\.getItem\(['"](dineflow_customer_token|dineflow_logged_in_user|dineflow_owner_password)['"]\)/.test(line)) {
        errors.push(`${relPath}:${lineNo} [frontend-sec] Do not read sensitive auth tokens/passwords from localStorage`);
      }
    }

    // Backend non-test regressions (skip comments mentioning "no BYPASSRLS")
    const codeOnlyLine = line.replace(/^\s*(\/\/|\*).*$/, '');
    if (isApi && !isTest && codeOnlyLine) {
      if (/\b(?:ALTER|CREATE)\s+(?:ROLE|USER)\b[\s\S]*\bBYPASSRLS\b/i.test(codeOnlyLine) || (codeOnlyLine.includes('BYPASSRLS') && !/no\s+bypassrls/i.test(codeOnlyLine))) {
        errors.push(`${relPath}:${lineNo} [rls] BYPASSRLS must never appear in backend SQL/code`);
      }
      if (/SELECT\s+id\s+FROM\s+organizations\s+LIMIT\s+1/i.test(codeOnlyLine)) {
        errors.push(`${relPath}:${lineNo} [tenancy] Default first-organization SQL fallback is prohibited`);
      }
    }
  });
}

if (errors.length > 0) {
  console.error(`[lint] FAILED in ${path.basename(packageDir)} (${errors.length} issue(s)):`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`[lint] OK: ${path.basename(packageDir)} (${files.length} files verified)`);
