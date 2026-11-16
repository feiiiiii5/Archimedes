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
  const helpers = { ...await import('../src/task-selection.ts'), ...await import('../src/composer-session.ts') };
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

test('attachment and pending request updates are isolated by session, including delayed adds', async () => {
  const { getComposerSession, updateComposerSession } = await import('../src/composer-session.ts');
  let sessions = {};
  const addToA = () => { sessions = updateComposerSession(sessions, 'a', current => ({ ...current, items: [...current.items, { id: 'a-file' }] })); };
  sessions = updateComposerSession(sessions, 'b', current => ({ ...current, items: [{ id: 'b-file' }], request: { id: 'b-draft', text: 'Keep B' } }));
  addToA();
  assert.equal(getComposerSession(sessions, 'a').items[0].id, 'a-file');
  assert.equal(getComposerSession(sessions, 'b').items[0].id, 'b-file');
  assert.equal(getComposerSession(sessions, 'b').request.text, 'Keep B');
});

test('a failed run after switching sessions reports only to the original composer', async () => {
  const pending = deferred();
  const h = await callbacks(['submitPrompt'], { desktopBridge: { runAgent: () => pending.promise } });
  const running = h.submitPrompt('A question');
  h.scope.taskSelectionRef.current = owner('b'); h.scope.activeThreadIdRef.current = 'b';
  h.state.messages = [{ id: 'b-message', text: 'B transcript' }];
  pending.reject(new Error('offline'));
  assert.equal(await running, false);
  assert.deepEqual(h.state.messages, [{ id: 'b-message', text: 'B transcript' }]);
  assert.match(h.state.sessions[h.key('a')].error, /offline/);
  assert.equal(h.state.sessions[h.key('b')], undefined);
});

test('a delayed successful run clears only submitted attachment objects in its owner', async () => {
  const pending = deferred(), submitted = { id: 'same-id', name: 'A old file' }, replacement = { id: 'same-id', name: 'A new file' };
  let input;
  const h = await callbacks(['submitPrompt'], { contextItems: [submitted], desktopBridge: { runAgent: value => { input = value; return pending.promise; } } });
  h.scope.updateComposer(h.key('a'), current => ({ ...current, items: [submitted] }));
  const running = h.submitPrompt('A question');
  h.scope.taskSelectionRef.current = owner('b'); h.scope.activeThreadIdRef.current = 'b';
  h.scope.updateComposer(h.key('a'), current => ({ ...current, items: [replacement] }));
  h.scope.updateComposer(h.key('b'), current => ({ ...current, items: [{ id: 'same-id', name: 'B file' }] }));
  pending.resolve({ threadId: 'a', thread: thread('a'), actions: [] });
  assert.equal(await running, true);
  assert.match(input.clientRunId, /^research-chat:/);
  assert.equal(input.workspace, '/physical/a');
  assert.equal(input.workspaceId, 'ws-a');
  assert.equal(h.state.sessions[h.key('a')].items[0], replacement);
  assert.equal(h.state.sessions[h.key('b')].items[0].name, 'B file');
  assert.deepEqual(h.state.displayed, []);
});

test('a newly created session receives later text, attachments and queued follow-ups from its original draft only', async () => {
  const { taskDraftKey } = await import('../src/task-selection.ts');
  const sourceKey = taskDraftKey({ ...owner('a'), threadId: null });
  const stored = new Map([[sourceKey, { text: 'Later A typing', selectionStart: 14, selectionEnd: 14 }], ['b', { text: 'Keep B typing' }]]);
  const composerSessionsRef = { current: {} }, queuedPromptScopesRef = { current: { [sourceKey]: [{ draft: 'A queued' }], b: [{ draft: 'B queued' }] } };
  const h = await callbacks(['queueComposerText', 'moveNewTaskComposer'], {
    composerSessionsRef, queuedPromptScopesRef,
    readComposerDraft: key => stored.get(key) ?? null,
    writeComposerDraft: (key, value) => value ? stored.set(key, value) : stored.delete(key),
    updateQueuedPrompts(key, update) { queuedPromptScopesRef.current[key] = typeof update === 'function' ? update(queuedPromptScopesRef.current[key] ?? []) : update; },
  });
  const originalUpdate = h.scope.updateComposer;
  h.scope.updateComposer = (key, update) => { originalUpdate(key, update); composerSessionsRef.current = h.state.sessions; };
  h.scope.taskSelectionRef.current = owner('b');
  h.scope.updateComposer(sourceKey, current => ({ ...current, items: [{ id: 'later-a-file' }] }));
  h.scope.updateComposer(h.key('b'), current => ({ ...current, items: [{ id: 'b-file' }] }));
  h.moveNewTaskComposer(sourceKey, h.threadKey('created-a', 'a'));
  assert.equal(stored.get(h.threadKey('created-a', 'a')).text, 'Later A typing');
  assert.equal(stored.has(sourceKey), false);
  assert.equal(stored.get('b').text, 'Keep B typing');
  assert.equal(h.state.sessions[h.threadKey('created-a', 'a')].items[0].id, 'later-a-file');
  assert.equal(h.state.sessions[h.key('b')].items[0].id, 'b-file');
  assert.equal(queuedPromptScopesRef.current[h.threadKey('created-a', 'a')][0].draft, 'A queued');
  assert.equal(queuedPromptScopesRef.current.b[0].draft, 'B queued');
});

test('the same imported cloud thread in different data folders cannot share text, attachments or pending handoffs', async () => {
  const { taskDraftKey, threadTaskSelection } = await import('../src/task-selection.ts');
  const { getComposerSession, updateComposerSession } = await import('../src/composer-session.ts');
  const a = taskDraftKey(threadTaskSelection('/data-a', thread('same-cloud-thread', 'a'), []));
  const b = taskDraftKey(threadTaskSelection('/data-b', thread('same-cloud-thread', 'a'), []));
  assert.notEqual(a, b);
  let sessions = updateComposerSession({}, a, current => ({ ...current, items: [{ id: 'a-file' }], request: { id: 'a-request', text: 'A handoff' } }));
  sessions = updateComposerSession(sessions, b, current => ({ ...current, items: [{ id: 'b-file' }] }));
  assert.equal(getComposerSession(sessions, a).request.text, 'A handoff');
  assert.equal(getComposerSession(sessions, b).request, null);
  assert.equal(getComposerSession(sessions, b).items[0].id, 'b-file');

  // Execute the real localStorage reader, including its legacy draft migration.
  const prefix = source.match(/const COMPOSER_DRAFT_STORAGE_PREFIX = ("[^"]+");/)[1];
  const start = source.indexOf('function readComposerDraft('), end = source.indexOf('\nfunction writeComposerDraft(', start);
  const stored = new Map([[JSON.parse(prefix) + 'same-cloud-thread', JSON.stringify({ text: 'Legacy unsent text' })]]);
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  const { transformWithOxc } = await import('vite');
  const { code } = await transformWithOxc(`const COMPOSER_DRAFT_STORAGE_PREFIX = ${prefix};\n${source.slice(start, end)}`, 'composer-reader.ts');
  const read = new Function('window', `${code}; return readComposerDraft;`)({ localStorage });
  assert.equal(read(a).text, 'Legacy unsent text');
  assert.equal(read(b), null, 'the legacy unscoped draft is claimed once, not cloned into another data folder');
  stored.set(JSON.parse(prefix) + b, JSON.stringify({ text: 'Independent B text' }));
  assert.equal(read(a).text, 'Legacy unsent text');
  assert.equal(read(b).text, 'Independent B text');
});

test('failed send restoration keeps the failed prompt and later typing in the original stored scope', async () => {
  const { appendComposerText } = await import('../src/composer-session.ts');
  const start = source.indexOf('    if (!sent) {\n      const laterText = composerRef.current?.value');
  const end = source.indexOf('\n    requestAnimationFrame(', start);
  assert.ok(start > 0 && end > start);
  const { transformWithOxc } = await import('vite');
  const { code } = await transformWithOxc(source.slice(start, end), 'restore-failed-draft.ts');
  for (const mounted of [true, false]) {
    const saved = new Map([['owner-a', { text: 'Later A typing' }], ['owner-b', { text: 'Keep B typing' }]]);
    let prompt;
    const scope = { sent: false, draft: 'Failed A question', draftKey: 'owner-a', newChatMode: 'standard', appendComposerText,
      composerRef: { current: mounted ? { value: 'Later A typing' } : null },
      readComposerDraft: key => saved.get(key), writeComposerDraft: (key, value) => saved.set(key, value), setPrompt: value => { prompt = value; } };
    new Function('scope', `with(scope) { ${code} }`)(scope);
    assert.equal(saved.get('owner-a').text, 'Failed A question\n\nLater A typing');
    assert.equal(prompt, saved.get('owner-a').text);
    assert.equal(saved.get('owner-b').text, 'Keep B typing');
  }
});
