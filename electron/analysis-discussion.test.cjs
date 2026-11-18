const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function extract(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/^  (?:async )?function /m);
  assert.ok(end >= 0, `next function after ${name}`);
  return source.slice(start, start + 1 + end);
}
const owner = project => ({ dataRoot: '/data', projectId: project, workspaceId: `ws-${project}`, threadId: project, executionRoot: `/physical/${project}` });
const thread = (id, project = id) => ({ id, project_id: project, workspace_id: `ws-${project}`, workspace_path: `/physical/${project}`, messages: [], events: [], turns: [], changeSets: [] });
async function callbacks(names, overrides = {}) {
  const helpers = { ...await import('../src/task-selection.ts'), ...await import('../src/composer-session.ts'), ...await import('../src/project-results.ts') };
  const state = { sessions: {}, displayed: [], messages: [], events: [], threads: [], busy: false };
  const scope = {
    ...helpers, crypto: global.crypto, t: text => text,
    taskSelectionRef: { current: owner('a') }, dataFolderLoadingRef: { current: false }, activeThreadIdRef: { current: 'a' }, activeRunRef: { current: null }, commandLockRef: { current: false }, threadOpenRequestRef: { current: 0 },
    analysisSessionsRef: { current: new Map() }, analysisHandoffsRef: { current: new Map() }, workspaces: [],
    researchMode: 'free-chat', reasoningEffort: 'medium', contextLength: 'standard', contextItems: [], activeThreadId: 'a',
    threadVisibility: 'project', selectedHarness: 'api', selectedNativeBackend: null, agentBusy: false,
    clearPendingAssistantDeltas() {}, setResearchMode() {}, setInterrupting() {}, setRunningOwnerKey() {}, setRunningThreadId() {}, setBoundHarness() {},
    setAgentBusy(value) { state.busy = value; }, setNativeStream() {}, setNativeQuestions() {}, setMainSection() {}, setPendingAction() {}, setTrajectoryEvents() {}, setChangeSets() {},
    setEvents(value) { state.events = typeof value === 'function' ? value(state.events) : value; },
    setMessages(value) { state.messages = typeof value === 'function' ? value(state.messages) : value; },
    setThreads(update) { state.threads = update(state.threads); },
    updateComposer(key, update) { state.sessions = helpers.updateComposerSession(state.sessions, key, update); },
    setContextItems(update, key) { scope.updateComposer(key, session => ({ ...session, items: update(session.items) })); },
    applyTaskSelection(value) { state.displayed.push(value); scope.taskSelectionRef.current = value; },
    displayThread(value) { state.displayed.push(value); },
    desktopBridge: {}, ...overrides,
  };
  const { transformWithOxc } = await import('vite');
  const { code } = await transformWithOxc(names.map(extract).join('\n'), 'composer-callbacks.ts');
  const actual = new Function('scope', `with(scope) { ${code}; return { ${names.join(', ')} }; }`)(scope);
  return { ...actual, state, scope, key: project => helpers.taskDraftKey(owner(project)), threadKey: (id, project = id) => helpers.taskDraftKey(helpers.threadTaskSelection("/data", thread(id, project), [])) };
}

test('analysis creation preserves the originating draft and reuses only its owner plus input identity', async () => {
  let creates = 0;
  const h = await callbacks(['queueComposerText', 'continueAnalysisInChat'], { desktopBridge: {
    createResearchThread: async input => { creates++; return thread(`analysis-${creates}`, input.projectId); },
    getResearchThread: async id => thread(id, 'a'),
  } });
  h.scope.updateComposer(h.key('a'), current => ({ ...current, request: { id: 'original', text: 'Keep my chat draft' } }));
  await h.continueAnalysisInChat('First analysis question', { id: 'csv-1', name: 'same.csv' }, owner('a'), () => true);
  await h.continueAnalysisInChat('Second analysis question', { id: 'csv-1', name: 'same.csv' }, owner('a'), () => true);
  assert.equal(creates, 1);
  assert.equal(h.state.sessions[h.key('a')].request.text, 'Keep my chat draft');
  assert.equal(h.state.sessions[h.threadKey('analysis-1', 'a')].request.text, 'First analysis question\n\nSecond analysis question');
  await h.continueAnalysisInChat('Different input', { id: 'csv-2', name: 'same.csv' }, owner('a'), () => true);
  await assert.rejects(h.continueAnalysisInChat('Wrong current project', { id: 'csv-1', name: 'same.csv' }, owner('b'), () => true), /Select a project/);
  h.scope.taskSelectionRef.current = owner('b');
  await h.continueAnalysisInChat('Different project', { id: 'csv-1', name: 'same.csv' }, owner('b'), () => true);
  assert.equal(creates, 3);
});

test('analysis creation failure keeps its source intact and a late success cannot hijack newer input', async () => {
  const pending = deferred();
  const h = await callbacks(['queueComposerText', 'continueAnalysisInChat'], { desktopBridge: { createResearchThread: () => pending.promise } });
  let current = true;
  const handoff = h.continueAnalysisInChat('Old input question', { id: 'csv-1', name: 'data.csv' }, owner('a'), () => current);
  current = false;
  pending.resolve(thread('analysis', 'a')); await handoff;
  assert.deepEqual(h.state.displayed, []);
  assert.equal(h.state.sessions[h.threadKey('analysis', 'a')].request.text, 'Old input question');
  h.scope.desktopBridge.createResearchThread = async () => { throw new Error('creation failed'); };
  await assert.rejects(h.continueAnalysisInChat('New input question', { id: 'csv-2', name: 'data.csv' }, owner('a'), () => true), /creation failed/);
  assert.equal(h.scope.taskSelectionRef.current.threadId, 'a');
  assert.equal(h.state.sessions[h.key('a')], undefined);
});

test('a deleted discussion can be replaced for a live draft and a saved analysis', async () => {
  const removed = new Set();
  const lookedUp = [];
  let creates = 0;
  const result = { id: 'saved-result', threadId: null, kind: 'analysis', projectId: 'a', workspaceId: 'ws-a', executionRoot: '/physical/a', fileState: 'ready' };
  const h = await callbacks(['queueComposerText', 'continueAnalysisInChat'], { desktopBridge: {
    createResearchThread: async input => thread(`analysis-${++creates}`, input.projectId),
    getResearchThread: async id => {
      lookedUp.push(id);
      if (removed.has(id)) throw new Error("Error invoking remote method 'research-thread:get': Error: Research thread not found.");
      return thread(id, 'a');
    },
    getProjectResult: async () => ({ ...result }),
  } });
  const complete = (input) => h.continueAnalysisInChat('Keep investigating', { id: 'csv', name: 'data.csv', ...input }, owner('a'), () => true);
  const original = await complete({});
  removed.add(original);
  const replacement = await complete({ threadId: original });
  assert.notEqual(original, replacement);
  assert.equal(await complete({ threadId: original }), replacement, 'the current in-memory association wins for an unsaved draft');

  const savedInput = { id: 'saved-csv', resultId: result.id };
  const savedDiscussion = await complete({ ...savedInput, threadId: original });
  assert.equal(await complete(savedInput), savedDiscussion, 'retrying before the association is saved reuses the still-existing discussion');
  result.threadId = savedDiscussion;
  removed.add(savedDiscussion);
  result.threadId = null; // The store clears the saved association when the discussion is deleted.
  const savedReplacement = await complete({ ...savedInput, threadId: savedDiscussion });
  assert.notEqual(savedReplacement, savedDiscussion);
  result.threadId = savedReplacement;
  assert.equal(await complete(savedInput), savedReplacement);
  assert.deepEqual(lookedUp, [original, replacement, savedDiscussion, savedDiscussion, savedReplacement],
    'a cleared saved result ignores the stale component ID and probes its cached discussion at most once');
});

