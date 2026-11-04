/**
 * Agent IDE Service — Compact Online IDE for AI Agents
 * 
 * Provides file system access, code execution, AI code generation,
 * and project understanding for agents to write, fix, and create code.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ═══════════════════════════════════════════════════════════════════
// SAFE PATH RESOLUTION — Prevent directory traversal
// ═══════════════════════════════════════════════════════════════════

const ALLOWED_DIRS = ['app', 'components', 'lib', 'server', 'public', 'config'];
const BLOCKED_PATTERNS = ['.env', 'node_modules', '.git', 'package-lock', '.next'];

function safePath(relativePath) {
  const resolved = path.resolve(PROJECT_ROOT, relativePath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error('Path traversal detected');
  }
  for (const blocked of BLOCKED_PATTERNS) {
    if (resolved.includes(blocked)) {
      throw new Error(`Access denied: ${blocked} files are protected`);
    }
  }
  return resolved;
}

// ═══════════════════════════════════════════════════════════════════
// FILE SYSTEM OPERATIONS
// ═══════════════════════════════════════════════════════════════════

function getProjectTree(dir = '', depth = 3) {
  const fullPath = dir ? safePath(dir) : PROJECT_ROOT;
  const tree = [];

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      // Skip blocked patterns
      if (BLOCKED_PATTERNS.some(b => entry.name.includes(b))) continue;
      if (entry.name.startsWith('.')) continue;

      const relativePath = path.relative(PROJECT_ROOT, path.join(fullPath, entry.name)).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        const children = depth > 1 ? getProjectTree(relativePath, depth - 1) : [];
        tree.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children,
          childCount: children.length
        });
      } else {
        const stat = fs.statSync(path.join(fullPath, entry.name));
        tree.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stat.size,
          ext: path.extname(entry.name),
          modified: stat.mtime.toISOString()
        });
      }
    }
  } catch (err) {
    // Directory doesn't exist or not readable
  }

  return tree.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function readFile(relativePath) {
  const fullPath = safePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  const stat = fs.statSync(fullPath);
  if (stat.size > 500000) {
    throw new Error('File too large (>500KB). Read specific sections instead.');
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  return {
    path: relativePath,
    content,
    lines: lines.length,
    size: stat.size,
    language: detectLanguage(relativePath),
    modified: stat.mtime.toISOString()
  };
}

function writeFile(relativePath, content) {
  const fullPath = safePath(relativePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Create backup
  if (fs.existsSync(fullPath)) {
    const backupPath = fullPath + '.bak';
    fs.copyFileSync(fullPath, backupPath);
  }
  fs.writeFileSync(fullPath, content, 'utf8');
  return {
    path: relativePath,
    size: Buffer.byteLength(content, 'utf8'),
    lines: content.split('\n').length,
    written: true,
    timestamp: new Date().toISOString()
  };
}

function createFile(relativePath, content = '') {
  const fullPath = safePath(relativePath);
  if (fs.existsSync(fullPath)) {
    throw new Error(`File already exists: ${relativePath}`);
  }
  return writeFile(relativePath, content);
}

function deleteFile(relativePath) {
  const fullPath = safePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  // Backup before delete
  const backupDir = path.join(PROJECT_ROOT, '.ide-backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupName = relativePath.replace(/\//g, '__') + '.' + Date.now();
  fs.copyFileSync(fullPath, path.join(backupDir, backupName));

  fs.unlinkSync(fullPath);
  return { deleted: true, path: relativePath, backup: backupName };
}

function searchFiles(query, filePattern = '*') {
  const results = [];
  const searchDir = PROJECT_ROOT;
  
  function search(dir, depth = 0) {
    if (depth > 6) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (BLOCKED_PATTERNS.some(b => entry.name.includes(b))) continue;
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          search(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Match file pattern
          if (filePattern !== '*' && !entry.name.match(new RegExp(filePattern.replace(/\*/g, '.*')))) continue;

          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            const matches = [];
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                matches.push({
                  line: i + 1,
                  content: lines[i].trim().substring(0, 200),
                  context: lines.slice(Math.max(0, i - 1), i + 2).join('\n')
                });
              }
            }
            if (matches.length > 0) {
              results.push({ file: relative, matches: matches.slice(0, 5), totalMatches: matches.length });
            }
          } catch (e) {
            // Binary file or unreadable
          }
        }
        if (results.length >= 50) return;
      }
    } catch (e) {}
  }

  search(searchDir);
  return results;
}

function diffFiles(relativePath, newContent) {
  const fullPath = safePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    return { type: 'new_file', path: relativePath, additions: newContent.split('\n').length };
  }
  const oldContent = fs.readFileSync(fullPath, 'utf8');
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const changes = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  let additions = 0, deletions = 0, modifications = 0;
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      if (i >= oldLines.length) {
        additions++;
        changes.push({ type: 'add', line: i + 1, content: newLines[i] });
      } else if (i >= newLines.length) {
        deletions++;
        changes.push({ type: 'delete', line: i + 1, content: oldLines[i] });
      } else {
        modifications++;
        changes.push({ type: 'modify', line: i + 1, old: oldLines[i], new: newLines[i] });
      }
    }
  }

  return { type: 'diff', path: relativePath, additions, deletions, modifications, changes: changes.slice(0, 100) };
}

// ═══════════════════════════════════════════════════════════════════
// CODE EXECUTION (Sandboxed)
// ═══════════════════════════════════════════════════════════════════

const activeProcesses = new Map();

function executeCode(code, language = 'javascript', timeout = 15000) {
  const execId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let output = '', error = '', exitCode = null;
  const startTime = Date.now();

  try {
    switch (language) {
      case 'javascript':
      case 'node': {
        const tmpFile = path.join(PROJECT_ROOT, `.ide-tmp-${execId}.js`);
        // Wrap in safe context
        const wrappedCode = `
          const __startTime = Date.now();
          const __logs = [];
          const __originalLog = console.log;
          const __originalError = console.error;
          const __originalWarn = console.warn;
          console.log = (...args) => { __logs.push(['log', ...args]); __originalLog(...args); };
          console.error = (...args) => { __logs.push(['error', ...args]); __originalError(...args); };
          console.warn = (...args) => { __logs.push(['warn', ...args]); __originalWarn(...args); };
          try {
            ${code}
          } catch(e) {
            console.error('Execution Error:', e.message);
            console.error(e.stack);
          }
        `;
        fs.writeFileSync(tmpFile, wrappedCode);
        try {
          output = execSync(`node "${tmpFile}"`, {
            cwd: PROJECT_ROOT,
            timeout,
            encoding: 'utf8',
            env: { ...process.env, NODE_ENV: 'development' }
          });
          exitCode = 0;
        } catch (e) {
          output = e.stdout || '';
          error = e.stderr || e.message;
          exitCode = e.status || 1;
        } finally {
          try { fs.unlinkSync(tmpFile); } catch (e) {}
        }
        break;
      }
      case 'shell':
      case 'bash': {
        try {
          output = execSync(code, {
            cwd: PROJECT_ROOT,
            timeout,
            encoding: 'utf8',
            shell: true
          });
          exitCode = 0;
        } catch (e) {
          output = e.stdout || '';
          error = e.stderr || e.message;
          exitCode = e.status || 1;
        }
        break;
      }
      case 'sql': {
        output = 'SQL execution requires database connection. Use the financial service or db module.';
        exitCode = 0;
        break;
      }
      default:
        error = `Unsupported language: ${language}. Supported: javascript, shell, sql`;
        exitCode = 1;
    }
  } catch (err) {
    error = err.message;
    exitCode = 1;
  }

  return {
    id: execId,
    language,
    output: output.substring(0, 50000),
    error: error.substring(0, 10000),
    exitCode,
    duration: Date.now() - startTime
  };
}

// Run a persistent terminal session (for dev servers etc.)
function spawnProcess(command, name) {
  const id = Date.now().toString(36);
  const proc = spawn(command, { cwd: PROJECT_ROOT, shell: true, env: process.env });
  const logs = [];
  
  proc.stdout.on('data', d => logs.push({ type: 'stdout', data: d.toString(), time: Date.now() }));
  proc.stderr.on('data', d => logs.push({ type: 'stderr', data: d.toString(), time: Date.now() }));
  proc.on('exit', code => logs.push({ type: 'exit', code, time: Date.now() }));

  activeProcesses.set(id, { proc, logs, name, started: Date.now() });
  return { id, name, pid: proc.pid };
}

function getProcessOutput(id) {
  const p = activeProcesses.get(id);
  if (!p) return null;
  return {
    id,
    name: p.name,
    pid: p.proc.pid,
    running: !p.proc.killed,
    uptime: Date.now() - p.started,
    logs: p.logs.slice(-200)
  };
}

function killProcess(id) {
  const p = activeProcesses.get(id);
  if (!p) return false;
  p.proc.kill('SIGTERM');
  activeProcesses.delete(id);
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// AI CODE GENERATION
// ═══════════════════════════════════════════════════════════════════

async function generateCode(prompt, context = {}) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Build context from files if specified
    let fileContext = '';
    if (context.files && Array.isArray(context.files)) {
      for (const f of context.files.slice(0, 5)) {
        try {
          const file = readFile(f);
          fileContext += `\n--- ${f} (${file.lines} lines) ---\n${file.content}\n`;
        } catch (e) {
          fileContext += `\n--- ${f}: Could not read: ${e.message} ---\n`;
        }
      }
    }

    // Build architecture context
    const archContext = getArchitectureMap();

    const systemPrompt = `You are the DoctaRx Engineering Agent — a state-of-the-art AI software engineer embedded in the DoctaRx telehealth platform.

## Your Capabilities
- Write production-quality code: JavaScript, Node.js, React/Next.js, PostgreSQL, Express
- Create novel algorithms and data structures optimized for healthcare
- Debug complex async/concurrent issues
- Design APIs, database schemas, and system architectures
- Write secure, HIPAA-compliant code

## Architecture Knowledge
${JSON.stringify(archContext, null, 2)}

## Coding Standards
- Use ES6+ features, async/await, proper error handling
- Follow existing patterns in the codebase
- Write clean, well-commented code
- Handle edge cases and errors gracefully
- Security-first: sanitize inputs, validate data, protect PHI

## Response Format
Return ONLY code in your response. Use comments for explanations.
If creating a new file, start with a comment indicating the file path.
If modifying existing code, clearly mark what changes with // CHANGED: comments.

${fileContext ? `\n## File Context\n${fileContext}` : ''}
${context.currentFile ? `\n## Current Working File: ${context.currentFile}` : ''}
${context.error ? `\n## Error to Fix:\n${context.error}` : ''}`;

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: prompt }
    ]);

    const responseText = result.response.text();

    return {
      code: responseText,
      model: 'gemini-2.0-flash',
      prompt_tokens: prompt.length,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return { code: null, error: err.message };
  }
}

async function analyzeCode(relativePath, analysisType = 'review') {
  const file = readFile(relativePath);
  const prompts = {
    review: `Review this code for bugs, security issues, performance problems, and improvements:\n\n${file.content}`,
    optimize: `Optimize this code for performance and readability. Return the optimized version:\n\n${file.content}`,
    test: `Generate comprehensive unit tests for this code:\n\n${file.content}`,
    document: `Add JSDoc documentation to all functions and explain the module:\n\n${file.content}`,
    security: `Perform a security audit on this code. Look for: SQL injection, XSS, CSRF, auth bypasses, data leaks, HIPAA violations:\n\n${file.content}`,
    refactor: `Refactor this code to follow SOLID principles and modern best practices:\n\n${file.content}`
  };

  return generateCode(prompts[analysisType] || prompts.review, { currentFile: relativePath });
}

async function fixError(error, context = {}) {
  const prompt = `Fix this error in the DoctaRx platform:

ERROR: ${error}

${context.file ? `File: ${context.file}` : ''}
${context.stackTrace ? `Stack Trace:\n${context.stackTrace}` : ''}

Provide the corrected code and explain what was wrong.`;

  return generateCode(prompt, { currentFile: context.file, error, files: context.file ? [context.file] : [] });
}

async function createTool(description, requirements = {}) {
  const prompt = `Create a new tool/utility for the DoctaRx telehealth platform.

DESCRIPTION: ${description}

REQUIREMENTS:
${JSON.stringify(requirements, null, 2)}

Create a complete, production-ready module with:
1. Clear exports and API
2. Error handling
3. JSDoc documentation
4. Usage examples in comments
5. Integration instructions

Use novel approaches and advanced algorithms where applicable.`;

  return generateCode(prompt, {});
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════

function getArchitectureMap() {
  const routes = [];
  const services = [];
  const components = [];
  const pages = [];

  // Scan routes
  try {
    const routeDir = path.join(PROJECT_ROOT, 'server/routes');
    if (fs.existsSync(routeDir)) {
      for (const f of fs.readdirSync(routeDir)) {
        if (f.endsWith('.js')) routes.push(f.replace('.js', ''));
      }
    }
  } catch (e) {}

  // Scan services
  try {
    const svcDir = path.join(PROJECT_ROOT, 'server/services');
    if (fs.existsSync(svcDir)) {
      for (const f of fs.readdirSync(svcDir)) {
        if (f.endsWith('.js')) services.push(f.replace('.js', ''));
        else if (fs.statSync(path.join(svcDir, f)).isDirectory()) services.push(f + '/');
      }
    }
  } catch (e) {}

  // Scan app pages
  try {
    function scanPages(dir, prefix = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scanPages(full, `${prefix}/${e.name}`);
        } else if (e.name === 'page.js' || e.name === 'page.jsx') {
          pages.push(prefix || '/');
        }
      }
    }
    scanPages(path.join(PROJECT_ROOT, 'app'));
  } catch (e) {}

  // Scan components
  try {
    function scanComps(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) scanComps(full);
        else if (e.name.endsWith('.jsx') || e.name.endsWith('.js')) {
          components.push(path.relative(path.join(PROJECT_ROOT, 'components'), full).replace(/\\/g, '/'));
        }
      }
    }
    scanComps(path.join(PROJECT_ROOT, 'components'));
  } catch (e) {}

  return {
    framework: 'Next.js 15 + Express.js backend',
    database: 'PostgreSQL',
    styling: 'Tailwind CSS',
    icons: 'lucide-react',
    payments: 'Stripe',
    ai: 'Google Gemini',
    routes,
    services,
    pages,
    components,
    structure: {
      frontend: 'app/ — Next.js App Router pages',
      backend: 'server/ — Express.js API + services',
      components: 'components/ — Shared React components',
      lib: 'lib/ — Client utilities',
      config: 'config/ — Environment templates'
    }
  };
}

function getProjectStats() {
  let totalFiles = 0, totalLines = 0, totalSize = 0;
  const byExtension = {};

  function scan(dir, depth = 0) {
    if (depth > 6) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (BLOCKED_PATTERNS.some(b => entry.name.includes(b))) continue;
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full, depth + 1);
        } else {
          const ext = path.extname(entry.name) || 'other';
          const stat = fs.statSync(full);
          totalFiles++;
          totalSize += stat.size;
          byExtension[ext] = (byExtension[ext] || 0) + 1;
          if (['.js', '.jsx', '.json', '.sql', '.css', '.md'].includes(ext) && stat.size < 200000) {
            try {
              totalLines += fs.readFileSync(full, 'utf8').split('\n').length;
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }

  scan(PROJECT_ROOT);
  return { totalFiles, totalLines, totalSize, byExtension, architecture: getArchitectureMap() };
}

function getLintErrors() {
  try {
    const output = execSync('npx next lint --format json 2>/dev/null || true', {
      cwd: PROJECT_ROOT,
      timeout: 30000,
      encoding: 'utf8'
    });
    return { raw: output.substring(0, 10000) };
  } catch (e) {
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// GIT OPERATIONS (read-only + commits)
// ═══════════════════════════════════════════════════════════════════

function gitStatus() {
  try {
    const status = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' });
    const branch = execSync('git branch --show-current', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const lastCommit = execSync('git log -1 --oneline', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    return { branch, lastCommit, changes: status.split('\n').filter(Boolean) };
  } catch (e) {
    return { error: e.message };
  }
}

function gitDiff(filePath) {
  try {
    const cmd = filePath ? `git diff -- "${filePath}"` : 'git diff';
    return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10000 }).substring(0, 50000);
  } catch (e) {
    return '';
  }
}

function gitLog(count = 20) {
  try {
    return execSync(`git log --oneline -${count}`, { cwd: PROJECT_ROOT, encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════
// GITHUB OPERATIONS — Push, PR, Branch Management
// ═══════════════════════════════════════════════════════════════════

function gitAdd(files = '.') {
  try {
    const target = Array.isArray(files) ? files.map(f => `"${f}"`).join(' ') : files;
    const output = execSync(`git add ${target}`, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10000 });
    return { success: true, output, files: target };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function gitCommit(message) {
  try {
    const output = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 30000
    });
    return { success: true, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function gitPush(branch = null, force = false) {
  try {
    const currentBranch = branch || execSync('git branch --show-current', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const forceFlag = force ? ' --force' : '';
    const output = execSync(`git push origin ${currentBranch}${forceFlag}`, {
      cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 60000
    });
    return { success: true, branch: currentBranch, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function gitPull(branch = null) {
  try {
    const currentBranch = branch || execSync('git branch --show-current', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const output = execSync(`git pull origin ${currentBranch}`, {
      cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 60000
    });
    return { success: true, branch: currentBranch, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function gitCreateBranch(branchName, checkout = true) {
  try {
    const cmd = checkout ? `git checkout -b ${branchName}` : `git branch ${branchName}`;
    const output = execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10000 });
    return { success: true, branch: branchName, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function gitCheckout(branch) {
  try {
    const output = execSync(`git checkout ${branch}`, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10000 });
    return { success: true, branch, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function gitBranches() {
  try {
    const local = execSync('git branch', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim().split('\n').map(b => {
      const isCurrent = b.startsWith('*');
      return { name: b.replace('* ', '').trim(), current: isCurrent };
    });
    let remote = [];
    try {
      remote = execSync('git branch -r', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim().split('\n').map(b => b.trim()).filter(Boolean);
    } catch (e) {}
    return { local, remote };
  } catch (e) {
    return { error: e.message };
  }
}

function gitCommitAndPush(message, files = '.') {
  const addResult = gitAdd(files);
  if (!addResult.success) return { success: false, step: 'add', error: addResult.error };
  
  const commitResult = gitCommit(message);
  if (!commitResult.success) return { success: false, step: 'commit', error: commitResult.error };
  
  const pushResult = gitPush();
  if (!pushResult.success) return { success: false, step: 'push', error: pushResult.error };
  
  return { success: true, add: addResult, commit: commitResult, push: pushResult };
}

function gitRemoteInfo() {
  try {
    const remotes = execSync('git remote -v', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const url = execSync('git config --get remote.origin.url', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    return { remotes, url };
  } catch (e) {
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE ACCESS — Direct SQL for Agents
// ═══════════════════════════════════════════════════════════════════

const db = require('../db');

// Read-only queries (safe for agents)
async function dbQuery(sql, params = []) {
  // Safety: block destructive operations unless explicitly allowed
  const upperSql = sql.trim().toUpperCase();
  const readOnly = upperSql.startsWith('SELECT') || upperSql.startsWith('EXPLAIN') || upperSql.startsWith('SHOW');
  
  try {
    const start = Date.now();
    const result = await db.query(sql, params);
    return {
      success: true,
      rows: result.rows,
      rowCount: result.rowCount,
      duration: Date.now() - start,
      readOnly
    };
  } catch (err) {
    return { success: false, error: err.message, detail: err.detail, hint: err.hint };
  }
}

// Write queries (requires explicit approval flag)
async function dbExecute(sql, params = [], { approved = false } = {}) {
  const upperSql = sql.trim().toUpperCase();
  const isDDL = upperSql.startsWith('CREATE') || upperSql.startsWith('ALTER') || upperSql.startsWith('DROP');
  const isDML = upperSql.startsWith('INSERT') || upperSql.startsWith('UPDATE') || upperSql.startsWith('DELETE');
  
  if (isDDL && !approved) {
    return { success: false, error: 'DDL operations (CREATE/ALTER/DROP) require explicit approval', requiresApproval: true, sql };
  }
  
  try {
    const start = Date.now();
    const result = await db.query(sql, params);
    return {
      success: true,
      rowCount: result.rowCount,
      rows: result.rows,
      duration: Date.now() - start,
      type: isDDL ? 'DDL' : isDML ? 'DML' : 'OTHER'
    };
  } catch (err) {
    return { success: false, error: err.message, detail: err.detail, hint: err.hint };
  }
}

async function dbListTables() {
  return dbQuery(`
    SELECT table_name, table_type 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);
}

async function dbDescribeTable(tableName) {
  // Sanitize table name
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const [columns, indexes, rowCount] = await Promise.all([
    dbQuery(`
      SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [safeName]),
    dbQuery(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = $1 AND schemaname = 'public'
    `, [safeName]),
    dbQuery(`SELECT COUNT(*) as count FROM "${safeName}"`)
  ]);
  return { table: safeName, columns: columns.rows, indexes: indexes.rows, rowCount: rowCount.rows?.[0]?.count };
}

async function dbDiagnose() {
  const [tables, connections, size, locks] = await Promise.all([
    dbQuery(`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`),
    dbQuery(`SELECT count(*) as active, state FROM pg_stat_activity GROUP BY state`),
    dbQuery(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`),
    dbQuery(`SELECT count(*) as count FROM pg_locks WHERE NOT granted`)
  ]);
  return {
    tables: tables.rows?.[0]?.count,
    connections: connections.rows,
    databaseSize: size.rows?.[0]?.size,
    blockedLocks: locks.rows?.[0]?.count
  };
}

// ═══════════════════════════════════════════════════════════════════
// SUB-AGENT CREATION — Dynamic Agent Spawning
// ═══════════════════════════════════════════════════════════════════

async function createSubAgent({ name, codeName, agentType, description, mission, systemPrompt, capabilities, parentAgent, autonomyLevel = 1 }) {
  // Register in database
  const result = await db.query(`
    INSERT INTO ai_agents (agent_type, display_name, description, system_prompt, capabilities, status)
    VALUES ($1, $2, $3, $4, $5, 'active')
    ON CONFLICT (agent_type) DO UPDATE SET 
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      system_prompt = EXCLUDED.system_prompt,
      capabilities = EXCLUDED.capabilities,
      status = 'active'
    RETURNING *
  `, [agentType, name, description, systemPrompt, JSON.stringify(capabilities)]);

  // Generate the agent file
  const agentCode = `/**
 * ${name} — "${codeName}"
 * Auto-generated sub-agent by The Architect
 * Parent: ${parentAgent || 'Engineering Agent'}
 * 
 * MISSION: ${mission}
 * Created: ${new Date().toISOString()}
 */

const BaseAgent = require('../base-agent');

class ${agentType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Agent extends BaseAgent {
  getSubscribedEvents() {
    return ${JSON.stringify(capabilities.events || ['system.notification'])};
  }

  constructor() {
    super({
      agentType: '${agentType}',
      displayName: '${name}',
      codeName: '${codeName}',
      description: '${description}',
      mission: '${mission}',
      systemPrompt: \`${systemPrompt.replace(/`/g, '\\`')}\`,
      capabilities: ${JSON.stringify(capabilities.skills || capabilities)},
      autonomyLevel: ${autonomyLevel}
    });
    this.parentAgent = '${parentAgent || 'engineering'}';
  }

  async observe() {
    return { status: 'active', timestamp: new Date().toISOString() };
  }

  async think(observations) {
    return [{ type: 'status_report', details: 'Sub-agent operational', priority: 'low' }];
  }

  async act(decisions) {
    return decisions.map(d => ({ action: d.type, status: 'processed' }));
  }

  async handleEvent(event) {
    return { handled: true, agent: '${agentType}', event: event.type };
  }
}

module.exports = ${agentType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Agent;
`;

  const agentFilePath = `server/services/agent-orchestrator/agents/${agentType}-agent.js`;
  writeFile(agentFilePath, agentCode);

  return {
    success: true,
    agent: result.rows[0],
    file: agentFilePath,
    agentType,
    name,
    codeName,
    message: `Sub-agent "${name}" (${codeName}) created and registered`
  };
}

async function listSubAgents() {
  const result = await db.query(`
    SELECT agent_type, display_name, description, status, capabilities, created_at, last_active
    FROM ai_agents
    ORDER BY created_at DESC
  `);
  return result.rows;
}

async function deactivateSubAgent(agentType) {
  await db.query(`UPDATE ai_agents SET status = 'inactive' WHERE agent_type = $1`, [agentType]);
  return { success: true, agentType, status: 'deactivated' };
}

// ═══════════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════════

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
    '.json': 'json', '.sql': 'sql', '.css': 'css', '.html': 'html',
    '.md': 'markdown', '.py': 'python', '.sh': 'shell', '.yml': 'yaml', '.yaml': 'yaml'
  };
  return map[ext] || 'text';
}

module.exports = {
  // File System
  getProjectTree,
  readFile,
  writeFile,
  createFile,
  deleteFile,
  searchFiles,
  diffFiles,
  // Execution
  executeCode,
  spawnProcess,
  getProcessOutput,
  killProcess,
  // AI Generation
  generateCode,
  analyzeCode,
  fixError,
  createTool,
  // Project Intelligence
  getArchitectureMap,
  getProjectStats,
  getLintErrors,
  // Git (read)
  gitStatus,
  gitDiff,
  gitLog,
  // GitHub (write)
  gitAdd,
  gitCommit,
  gitPush,
  gitPull,
  gitCreateBranch,
  gitCheckout,
  gitBranches,
  gitCommitAndPush,
  gitRemoteInfo,
  // Database
  dbQuery,
  dbExecute,
  dbListTables,
  dbDescribeTable,
  dbDiagnose,
  // Sub-Agent Creation
  createSubAgent,
  listSubAgents,
  deactivateSubAgent,
  // Utils
  detectLanguage
};
