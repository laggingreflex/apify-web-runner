import { useState, useMemo, useEffect } from 'react';
import { ApifyClient } from 'apify-client';
import { loadActor, getSchemaAndDefaults, runActor, fetchOutputs } from './lib/apifyCore';
import './style.css';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('apifyToken') || '');
  const [actorId, setActorId] = useState(() => localStorage.getItem('apifyActorId') || 'apify/hello-world');
  const [outputKey, setOutputKey] = useState('OUTPUT');
  const [actorDetails, setActorDetails] = useState(null);
  const [exampleInputBody, setExampleInputBody] = useState('');
  const [inputSchema, setInputSchema] = useState({});
  const [inputValues, setInputValues] = useState({});
  const [schemaSource, setSchemaSource] = useState(null);
  const [inputJson, setInputJson] = useState('');
  const [clientInfo, setClientInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState(null);
  const [kvRecord, setKvRecord] = useState(null);
  const [datasetItems, setDatasetItems] = useState([]);
  const [logs, setLogs] = useState([]);
  const addLog = (msg) => setLogs((l) => [...l, typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)]);

  const client = useMemo(() => {
    if (!token) return null;
    try { return new ApifyClient({ token }); } catch { return null; }
  }, [token]);

  useEffect(() => { if (token) localStorage.setItem('apifyToken', token); }, [token]);
  useEffect(() => { if (actorId) localStorage.setItem('apifyActorId', actorId); }, [actorId]);

  async function handleLoadActor(e) {
    e?.preventDefault?.();
    setActorDetails(null); setRun(null); setKvRecord(null); setDatasetItems([]); setLogs([]); setInputSchema({}); setInputValues({}); setSchemaSource(null);
    if (!client) { addLog('Error: ApifyClient not initialized.'); return; }
    try {
      setLoading(true);
      addLog('Fetching user...');
      const user = await client.user().get();
      setClientInfo(user);
      addLog(`Authenticated as: ${user?.username || user?.id}`);
      addLog(`Fetching actor details for: ${actorId}`);
      const loaded = await loadActor(client, actorId);
      const actorDetails = loaded.actorDetails;
      if (!actorDetails) throw new Error('Actor not found');
      setActorDetails(actorDetails);
      const body = actorDetails?.exampleRunInput?.body || '';
      setExampleInputBody(body);
      addLog('Resolving input schema/defaults...');
      const { schemaProps, requiredList, defaultInput, source } = await getSchemaAndDefaults(client, actorDetails);
      if (!schemaProps) addLog('No explicit schema found; using example input if available.');
      const requiredSet = new Set(Array.isArray(requiredList) ? requiredList : []);
      const schemaMap = {}; const valuesMap = {}; let defaultInputLocal = { ...defaultInput };
      if (schemaProps && typeof schemaProps === 'object') {
        setSchemaSource(source || 'build'); addLog('Using input schema from latest build.');
        for (const [key, prop] of Object.entries(schemaProps)) {
          const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
          const entry = { type: type || 'string', itemsType: prop?.items ? (Array.isArray(prop.items.type) ? prop.items.type[0] : prop.items.type) : undefined, enum: prop?.enum, description: prop?.description, required: requiredSet.has(key), placeholder: prop?.placeholderValue ?? prop?.prefill, raw: prop };
          schemaMap[key] = entry;
          const _default = (defaultInputLocal && defaultInputLocal[key] !== undefined) ? defaultInputLocal[key] : (prop?.default ?? prop?.placeholderValue ?? prop?.prefill);
          let v = _default;
          if (entry.type === 'object') { try { valuesMap[key] = v != null ? JSON.stringify(v, null, 2) : ''; } catch { valuesMap[key] = String(v); } }
          else if (entry.type === 'array') { if (Array.isArray(v)) valuesMap[key] = v.map(x => (x == null ? '' : JSON.stringify(x))).join('\n'); else if (typeof v === 'string') valuesMap[key] = v; else valuesMap[key] = ''; }
          else if (entry.type === 'boolean') { valuesMap[key] = v == null ? false : Boolean(v); }
          else if (entry.type === 'number' || entry.type === 'integer') { valuesMap[key] = typeof v === 'number' ? v : v === undefined ? '' : Number(v); }
          else { valuesMap[key] = v ?? ''; }
          if (v !== undefined) { defaultInputLocal[key] = v; }
        }
      } else {
        setSchemaSource(source || 'example'); addLog('Falling back to exampleRunInput for dynamic fields.');
        let example = {}; try { example = body ? JSON.parse(body) : {}; } catch { example = {}; }
        if (example && typeof example === 'object') {
          defaultInputLocal = Object.keys(defaultInputLocal).length ? defaultInputLocal : example;
          for (const [key, defVal] of Object.entries(example)) {
            if (Array.isArray(defVal)) { schemaMap[key] = { type: 'array' }; valuesMap[key] = defVal.map(x => (x == null ? '' : String(x))).join('\n'); }
            else if (defVal && typeof defVal === 'object') { schemaMap[key] = { type: 'object' }; try { valuesMap[key] = JSON.stringify(defVal, null, 2); } catch { valuesMap[key] = String(defVal); } }
            else if (typeof defVal === 'boolean') { schemaMap[key] = { type: 'boolean' }; valuesMap[key] = defVal; }
            else if (typeof defVal === 'number') { schemaMap[key] = { type: 'number' }; valuesMap[key] = defVal; }
            else { schemaMap[key] = { type: 'string' }; valuesMap[key] = defVal ?? ''; }
          }
        }
      }
      setInputSchema(schemaMap); setInputValues(valuesMap);
      try { setInputJson(JSON.stringify(defaultInputLocal || {}, null, 2)); } catch { setInputJson('{}'); }
      addLog('Actor loaded. Configure inputs below, then run.');
    } catch (err) { console.error(err); addLog(`Error: ${err?.message || err}`); } finally { setLoading(false); }
  }

  async function handleRunActor(e) {
    e?.preventDefault?.();
    if (!client) { addLog('Error: ApifyClient not initialized.'); return; }
    if (!actorId) { addLog('Error: Missing actor ID.'); return; }
    let input = {};
    try {
      const parsed = inputJson ? JSON.parse(inputJson) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Input JSON must be an object (e.g., { "foo": "bar" }).');
      const missing = Object.entries(inputSchema).filter(([k, sch]) => sch.required).map(([k]) => k).filter(k => !(k in parsed));
      if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
      input = parsed;
    } catch (err) { addLog(`Input JSON error: ${err?.message || err}`); return; }
    setRun(null); setKvRecord(null); setDatasetItems([]);
    try { setLoading(true); addLog('Starting actor run...'); const r = await runActor(client, actorId, input); setRun(r); addLog(`Run status: ${r.status}`); addLog(`Run cost (USD): ${r.usageTotalUsd}`); addLog(`Store ID: ${r.defaultKeyValueStoreId}`); addLog(`Dataset ID: ${r.defaultDatasetId}`); if (r.status !== 'SUCCEEDED') { addLog('Actor run did not succeed.'); return; } }
    catch (err) { console.error(err); addLog(`Run error: ${err?.message || err}`); }
    finally { setLoading(false); }
  }

  async function handleFetchOutput() {
    if (!client) { addLog('Error: ApifyClient not initialized.'); return; }
    if (!run) { addLog('Error: No run to fetch output from.'); return; }
    setKvRecord(null); setDatasetItems([]);
    try { setLoading(true); const { kvRecord: kv, datasetItems: items } = await fetchOutputs(client, run, outputKey); if (kv) setKvRecord(kv); if (items) setDatasetItems(items); addLog(`Fetched outputs. KV: ${kv ? 'yes' : 'no'} · Dataset items: ${items ? items.length : 0}`); }
    finally { setLoading(false); }
  }

  const directUrl = useMemo(() => { const storeId = run?.defaultKeyValueStoreId; if (!storeId || !outputKey) return null; return `https://api.apify.com/v2/key-value-stores/${storeId}/records/${encodeURIComponent(outputKey)}?disableRedirect=1`; }, [run, outputKey]);
  const statusClass = run?.status === 'SUCCEEDED' ? 'statusBadge status-succeeded' : run?.status === 'RUNNING' ? 'statusBadge status-running' : run?.status ? 'statusBadge status-failed' : 'statusBadge';

  return (
    <>
      <h1>Apify Web Runner</h1>
      <p>Easily test out <a href='https://apify.com/store' target='_blank' rel='noreferrer'>Apify</a> actors</p>
      <form onSubmit={handleLoadActor}>
        <fieldset>
          <legend>Apify Connection</legend>
          <div className='row'>
            <label>
              <p>API Token</p>
              <input type='password' placeholder='apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' defaultValue={token} onChange={e => setToken(e.target.value)} required />
            </label>
            <label>
              <p>Actor ID</p>
              <input type='text' placeholder='apify/hello-world' defaultValue={actorId} onChange={e => setActorId(e.target.value)} required />
            </label>
          </div>
          <button type='submit' className='action' disabled={!token || !actorId || !ApifyClient || loading}>{loading ? 'Loading…' : 'Load actor'}</button>
        </fieldset>
        {actorDetails && (
          <fieldset>
            <legend>Actor Details</legend>
            <div className='actorHeader'>
              <a href={`https://apify.com/${actorDetails.username}/${actorDetails.name}`} target='_blank' rel='noreferrer'><strong>{actorDetails.username}/{actorDetails.name}</strong></a>
              <span className='muted'> &nbsp;ID: {actorDetails.id}</span>
            </div>
            {actorDetails.description && <p className='small'>{actorDetails.description}</p>}
            <div className='small muted'>
              <div><strong>Stats</strong></div>
              <ul style={{ margin: '.25rem 0 0 .9rem' }}>
                <li>Users: {actorDetails.stats?.totalUsers} (last 30 days: {actorDetails.stats?.totalUsers30Days})</li>
                <li>Runs: {actorDetails.stats?.totalRuns} (last 30 days: {actorDetails.stats?.publicActorRunStats30Days?.SUCCEEDED}/{actorDetails.stats?.publicActorRunStats30Days?.TOTAL})</li>
              </ul>
            </div>
            {exampleInputBody && (
              <details style={{ marginTop: '.5rem' }}>
                <summary className='small'>Example input JSON</summary>
                <pre className='outputLog'><code>{exampleInputBody}</code></pre>
              </details>
            )}
            {schemaSource && <div className='small muted'>Schema source: {schemaSource}</div>}
          </fieldset>
        )}
        {actorDetails && (
          <fieldset>
            <legend>Actor Input</legend>
            <div className='layo0utTwo'>
              <div className='c0ol'>
                <button type='button' className='action' onClick={handleRunActor} disabled={loading}>{loading ? 'Running…' : 'Run actor'}</button>
                {run && (
                  <div className='panel' style={{ marginTop: '.75rem' }}>
                    <div className={statusClass}>{run.status}</div>
                    <div className='small'>Cost: ${run.usageTotalUsd} · Store: {run.defaultKeyValueStoreId || '—'} · Dataset: {run.defaultDatasetId || '—'}</div>
                  </div>
                )}
              </div>
              <div className='c0ol'>
                {Object.keys(inputSchema).length === 0 && <p className='muted small'>This actor doesn't define an input schema or example input. Edit the JSON below or run without parameters.</p>}
                <label>
                  <p>Input JSON</p>
                  <textarea value={inputJson} onChange={e => setInputJson(e.target.value)} placeholder='{}' style={{ minHeight: '14rem' }} />
                  <div className='small muted' style={{ marginTop: '.25rem' }}>Defaults are prefilled from the actor's schema or example input. Provide a valid JSON object.</div>
                </label>
              </div>
            </div>
          </fieldset>
        )}
        {run && (
          <fieldset>
            <legend>Output</legend>
            <div className='row'>
              <label>
                <p>Output Key (KV Store)</p>
                <input type='text' defaultValue={outputKey} onChange={e => setOutputKey(e.target.value)} />
              </label>
              {directUrl && (
                <div style={{ alignSelf: 'flex-end' }}>
                  <div className='small'>Direct output link:</div>
                  <div className='small'><a href={directUrl} target='_blank' rel='noreferrer'>{directUrl}</a></div>
                </div>
              )}
            </div>
            <button type='button' className='action' onClick={handleFetchOutput} disabled={loading}>Fetch output</button>
            {(kvRecord || (datasetItems && datasetItems.length)) && (
              <div style={{ marginTop: '.75rem' }}>
                {kvRecord && (
                  <div className='panel'>
                    <strong>Key-Value Store Record</strong>
                    {kvRecord.meta?.contentType && <div className='small muted'>contentType: {kvRecord.meta.contentType}</div>}
                    <pre className='outputLog' style={{ marginTop: '.5rem' }}><code>{safeStringify(kvRecord.value)}</code></pre>
                  </div>
                )}
                {datasetItems && datasetItems.length > 0 && (
                  <div className='panel'>
                    <strong>Dataset Items ({datasetItems.length})</strong>
                    <ul className='itemsList'>
                      {datasetItems.slice(0, 50).map((item, i) => (<li key={i}><code>{safeStringify(item)}</code></li>))}
                    </ul>
                    {datasetItems.length > 50 && <div className='small muted'>Showing first 50 items…</div>}
                  </div>
                )}
              </div>
            )}
          </fieldset>
        )}
        <fieldset>
          <legend>Logs</legend>
          {logs.length === 0 ? (<p className='muted small'>No logs yet.</p>) : (
            <div className='outputLog'>
              {logs.map((l, i) => (<pre key={i}>{String(l)}</pre>))}
            </div>
          )}
        </fieldset>
      </form>
    </>
  );
}

function safeStringify(val) {
  try { if (typeof val === 'string') return val; return JSON.stringify(val, null, 2); } catch { return String(val); }
}
