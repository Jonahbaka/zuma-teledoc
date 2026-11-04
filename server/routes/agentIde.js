/**
 * Agent IDE API Routes
 * Compact Online IDE for AI Agents — File ops, code execution, AI generation
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

let ideService;
try {
  ideService = require('../services/agentIdeService');
} catch (err) {
  console.warn('Agent IDE service not available:', err.message);
}

// ═══ PROJECT TREE ═══
router.get('/tree', ...adminOnly, async (req, res) => {
  try {
    const tree = ideService.getProjectTree(req.query.dir || '', parseInt(req.query.depth) || 3);
    res.json({ success: true, data: tree });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ PROJECT STATS ═══
router.get('/stats', ...adminOnly, async (req, res) => {
  try {
    const stats = ideService.getProjectStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ ARCHITECTURE MAP ═══
router.get('/architecture', ...adminOnly, async (req, res) => {
  try {
    const arch = ideService.getArchitectureMap();
    res.json({ success: true, data: arch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ FILE READ ═══
router.get('/file', ...adminOnly, async (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ success: false, error: 'path required' });
    const file = ideService.readFile(req.query.path);
    res.json({ success: true, data: file });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ FILE WRITE ═══
router.put('/file', ...adminOnly, async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ success: false, error: 'path and content required' });
    const result = ideService.writeFile(filePath, content);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ FILE CREATE ═══
router.post('/file', ...adminOnly, async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ success: false, error: 'path required' });
    const result = ideService.createFile(filePath, content || '');
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ FILE DELETE ═══
router.delete('/file', ...adminOnly, async (req, res) => {
  try {
    const filePath = req.query.path || req.body?.path;
    if (!filePath) return res.status(400).json({ success: false, error: 'path required' });
    const result = ideService.deleteFile(filePath);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ SEARCH ═══
router.get('/search', ...adminOnly, async (req, res) => {
  try {
    if (!req.query.q) return res.status(400).json({ success: false, error: 'q (query) required' });
    const results = ideService.searchFiles(req.query.q, req.query.pattern || '*');
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ DIFF PREVIEW ═══
router.post('/diff', ...adminOnly, async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || !content) return res.status(400).json({ success: false, error: 'path and content required' });
    const diff = ideService.diffFiles(filePath, content);
    res.json({ success: true, data: diff });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ CODE EXECUTION ═══
router.post('/execute', ...adminOnly, async (req, res) => {
  try {
    const { code, language, timeout } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'code required' });
    const result = ideService.executeCode(code, language || 'javascript', timeout || 15000);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ AI CODE GENERATION ═══
router.post('/ai/generate', ...adminOnly, async (req, res) => {
  try {
    const { prompt, context } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });
    const result = await ideService.generateCode(prompt, context || {});
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ AI CODE ANALYSIS ═══
router.post('/ai/analyze', ...adminOnly, async (req, res) => {
  try {
    const { path: filePath, type } = req.body;
    if (!filePath) return res.status(400).json({ success: false, error: 'path required' });
    const result = await ideService.analyzeCode(filePath, type || 'review');
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ AI FIX ERROR ═══
router.post('/ai/fix', ...adminOnly, async (req, res) => {
  try {
    const { error, file, stackTrace } = req.body;
    if (!error) return res.status(400).json({ success: false, error: 'error description required' });
    const result = await ideService.fixError(error, { file, stackTrace });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ AI CREATE TOOL ═══
router.post('/ai/create-tool', ...adminOnly, async (req, res) => {
  try {
    const { description, requirements } = req.body;
    if (!description) return res.status(400).json({ success: false, error: 'description required' });
    const result = await ideService.createTool(description, requirements || {});
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ GIT STATUS ═══
router.get('/git/status', ...adminOnly, async (req, res) => {
  try {
    const status = ideService.gitStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ GIT DIFF ═══
router.get('/git/diff', ...adminOnly, async (req, res) => {
  try {
    const diff = ideService.gitDiff(req.query.file);
    res.json({ success: true, data: diff });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ GIT LOG ═══
router.get('/git/log', ...adminOnly, async (req, res) => {
  try {
    const log = ideService.gitLog(parseInt(req.query.count) || 20);
    res.json({ success: true, data: log });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ GITHUB — Add, Commit, Push, Branch ═══

router.post('/git/add', ...adminOnly, async (req, res) => {
  try {
    const result = ideService.gitAdd(req.body.files || '.');
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/git/commit', ...adminOnly, async (req, res) => {
  try {
    if (!req.body.message) return res.status(400).json({ success: false, error: 'message required' });
    const result = ideService.gitCommit(req.body.message);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/git/push', ...adminOnly, async (req, res) => {
  try {
    const result = ideService.gitPush(req.body.branch, req.body.force);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/git/pull', ...adminOnly, async (req, res) => {
  try {
    const result = ideService.gitPull(req.body.branch);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/git/commit-push', ...adminOnly, async (req, res) => {
  try {
    if (!req.body.message) return res.status(400).json({ success: false, error: 'message required' });
    const result = ideService.gitCommitAndPush(req.body.message, req.body.files);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/git/branch', ...adminOnly, async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ success: false, error: 'branch name required' });
    const result = ideService.gitCreateBranch(req.body.name, req.body.checkout !== false);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/git/checkout', ...adminOnly, async (req, res) => {
  try {
    if (!req.body.branch) return res.status(400).json({ success: false, error: 'branch required' });
    const result = ideService.gitCheckout(req.body.branch);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/git/branches', ...adminOnly, async (req, res) => {
  try {
    const branches = ideService.gitBranches();
    res.json({ success: true, data: branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/git/remote', ...adminOnly, async (req, res) => {
  try {
    const info = ideService.gitRemoteInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ DATABASE ACCESS ═══

router.post('/db/query', ...adminOnly, async (req, res) => {
  try {
    if (!req.body.sql) return res.status(400).json({ success: false, error: 'sql required' });
    const result = await ideService.dbQuery(req.body.sql, req.body.params || []);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/db/execute', ...adminOnly, async (req, res) => {
  try {
    if (!req.body.sql) return res.status(400).json({ success: false, error: 'sql required' });
    const result = await ideService.dbExecute(req.body.sql, req.body.params || [], { approved: req.body.approved });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/db/tables', ...adminOnly, async (req, res) => {
  try {
    const result = await ideService.dbListTables();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/db/describe/:table', ...adminOnly, async (req, res) => {
  try {
    const result = await ideService.dbDescribeTable(req.params.table);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/db/diagnose', ...adminOnly, async (req, res) => {
  try {
    const result = await ideService.dbDiagnose();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ SUB-AGENT CREATION ═══

router.post('/agents/create', ...adminOnly, async (req, res) => {
  try {
    const { name, codeName, agentType, description, mission, systemPrompt, capabilities, parentAgent, autonomyLevel } = req.body;
    if (!name || !agentType) return res.status(400).json({ success: false, error: 'name and agentType required' });
    const result = await ideService.createSubAgent({
      name, codeName: codeName || name, agentType, description: description || '',
      mission: mission || '', systemPrompt: systemPrompt || '', capabilities: capabilities || [],
      parentAgent, autonomyLevel
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/agents/list', ...adminOnly, async (req, res) => {
  try {
    const agents = await ideService.listSubAgents();
    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/agents/deactivate', ...adminOnly, async (req, res) => {
  try {
    if (!req.body.agentType) return res.status(400).json({ success: false, error: 'agentType required' });
    const result = await ideService.deactivateSubAgent(req.body.agentType);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
