const { useState, useMemo, useEffect } = React;
const { ApifyClient } = window.Apify || {};

const rootEl = document.getElementById('root');
ReactDOM.createRoot(rootEl).render(<App />);

function App() {
  // Core inputs
  const [token, setToken] = useState(() => localStorage.getItem('apifyToken') || '');
  const [actorId, setActorId] = useState('apify/hello-world');
  const [outputKey, setOutputKey] = useState('OUTPUT');

  // Actor details and dynamic input schema/values
  const [actorDetails, setActorDetails] = useState(null);
  const [exampleInputBody, setExampleInputBody] = useState('');
  const [inputSchema, setInputSchema] = useState({}); // { key: 'string'|'number'|'boolean'|'json' }
  const [inputValues, setInputValues] = useState({}); // { key: value|stringified }

  // Run and outputs
  const [clientInfo, setClientInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState(null);
  const [kvRecord, setKvRecord] = useState(null);
  const [datasetItems, setDatasetItems] = useState([]);
  const [logs, setLogs] = useState([]);
  const addLog = (msg) => setLogs((l) => [...l, typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)]);

  const client = useMemo(() => {
    if (!token || !ApifyClient) return null;
    try { return new ApifyClient({ token }); } catch (_) { return null; }
  }, [token]);

  useEffect(() => {
    // Persist token for convenience
    try { if (token) localStorage.setItem('apifyToken', token); } catch (_) {}
  }, [token]);

  async function handleLoadActor(e) {
    e?.preventDefault?.();
    setActorDetails(null);
    setRun(null);
    setKvRecord(null);
    setDatasetItems([]);
    setLogs([]);
    if (!client) {
      addLog('Error: ApifyClient not initialized.');
      return;
    }

    try {
      setLoading(true);
      addLog('Fetching user...');
      const user = await client.user().get();
      setClientInfo(user);
      addLog(`Authenticated as: ${user?.username || user?.id}`);

      addLog(`Fetching actor details for: ${actorId}`);
      const a = await client.actor(actorId).get();
      if (!a) throw new Error('Actor not found');
      setActorDetails(a);

      const body = a?.exampleRunInput?.body || '';
      setExampleInputBody(body);

      // Build dynamic schema/values from example input
      let example = {};
      try {
        example = body ? JSON.parse(body) : {};
      } catch (err) {
        addLog('Warning: exampleRunInput.body is not valid JSON. Showing raw string.');
      }

      const newSchema = {};
      const newValues = {};
      if (example && typeof example === 'object') {
        for (const [key, defVal] of Object.entries(example)) {
          const t = typeof defVal;
          if (t === 'string' || t === 'number' || t === 'boolean') {
            newSchema[key] = t;
            newValues[key] = defVal;
          } else {
            newSchema[key] = 'json';
            try { newValues[key] = JSON.stringify(defVal, null, 2); } catch { newValues[key] = String(defVal); }
          }
        }
      }
      setInputSchema(newSchema);
      setInputValues(newValues);

      addLog('Actor loaded. Configure inputs below, then run.');
    } catch (err) {
      console.error(err);
      addLog(`Error: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  function updateInputValue(key, rawVal, type) {
    setInputValues((prev) => ({ ...prev, [key]: type === 'number' ? (rawVal === '' ? '' : Number(rawVal)) : type === 'boolean' ? Boolean(rawVal) : rawVal }));
  }

  async function handleRunActor(e) {
    e?.preventDefault?.();
    if (!client) { addLog('Error: ApifyClient not initialized.'); return; }
    if (!actorId) { addLog('Error: Missing actor ID.'); return; }

    // Build input object based on schema
    const input = {};
    try {
      for (const [key, type] of Object.entries(inputSchema)) {
        const v = inputValues[key];
        if (type === 'json') {
          if (typeof v === 'string') {
            try { input[key] = JSON.parse(v); }
            catch (err) { throw new Error(`Field "${key}" contains invalid JSON.`); }
          } else {
            input[key] = v; // already object/array
          }
        } else if (type === 'number') {
          if (v === '' || Number.isNaN(Number(v))) throw new Error(`Field "${key}" must be a number.`);
          input[key] = Number(v);
        } else if (type === 'boolean') {
          input[key] = Boolean(v);
        } else {
          input[key] = v;
        }
      }
    } catch (err) {
      addLog(err.message);
      return;
    }

    setRun(null);
    setKvRecord(null);
    setDatasetItems([]);

    try {
      setLoading(true);
      addLog('Starting actor run...');
      const r = await client.actor(actorId).call(input);
      setRun(r);
      addLog(`Run status: ${r.status}`);
      addLog(`Run cost (USD): ${r.usageTotalUsd}`);
      addLog(`Store ID: ${r.defaultKeyValueStoreId}`);
      addLog(`Dataset ID: ${r.defaultDatasetId}`);

      if (r.status !== 'SUCCEEDED') {
        addLog('Actor run did not succeed.');
        return;
      }

      // Fetch KV record
      if (r.defaultKeyValueStoreId && outputKey) {
        try {
          addLog('Fetching KV store output...');
          const rec = await client.keyValueStore(r.defaultKeyValueStoreId).getRecord(outputKey);
          const display = rec && typeof rec === 'object' && 'value' in rec ? rec.value : rec;
          setKvRecord({ meta: rec && rec.contentType ? { contentType: rec.contentType } : null, value: display });
        } catch (err) {
          addLog(`KV fetch warning: ${err?.message || err}`);
        }
      }

      // Fetch dataset items
      if (r.defaultDatasetId) {
        try {
          addLog('Fetching dataset items...');
          const { items } = await client.dataset(r.defaultDatasetId).listItems({ clean: true });
          setDatasetItems(items || []);
          addLog(`Fetched ${items?.length || 0} dataset items.`);
        } catch (err) {
          addLog(`Dataset fetch warning: ${err?.message || err}`);
        }
      }
    } catch (err) {
      console.error(err);
      addLog(`Run error: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  const directUrl = useMemo(() => {
    const storeId = run?.defaultKeyValueStoreId;
    if (!storeId || !outputKey) return null;
    return `https://api.apify.com/v2/key-value-stores/${storeId}/records/${encodeURIComponent(outputKey)}?disableRedirect=1`;
  }, [run, outputKey]);

  const statusClass = run?.status === 'SUCCEEDED' ? 'statusBadge status-succeeded' : run?.status === 'RUNNING' ? 'statusBadge status-running' : run?.status ? 'statusBadge status-failed' : 'statusBadge';

  return (
    <div>
      <form onSubmit={handleLoadActor}>
        <fieldset>
          <legend>Apify Connection</legend>
          <div className="row">
            <label>
              <p>API Token</p>
              <input
                type="password"
                placeholder="apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </label>
            <label>
              <p>Actor ID</p>
              <input
                type="text"
                placeholder="apify/hello-world"
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                required
              />
            </label>
          </div>
          <button type="submit" className="action" disabled={!token || !actorId || !ApifyClient || loading}>
            {loading ? 'Loading…' : 'Load actor'}
          </button>
        </fieldset>

        {actorDetails && (
          <fieldset>
            <legend>Actor Details</legend>
            <div className="actorHeader">
              <strong>{actorDetails.username}/{actorDetails.name}</strong>
              <span className="muted"> &nbsp;ID: {actorDetails.id}</span>
            </div>
            {actorDetails.description && <p className="small">{actorDetails.description}</p>}
            <div className="small muted">
              Stats: users {actorDetails.stats?.totalUsers} (30d {actorDetails.stats?.totalUsers30Days}) · runs {actorDetails.stats?.totalRuns} (30d {actorDetails.stats?.publicActorRunStats30Days?.SUCCEEDED}/{actorDetails.stats?.publicActorRunStats30Days?.TOTAL})
            </div>
            {exampleInputBody && (
              <details style={{ marginTop: '.5rem' }}>
                <summary className="small">Example input JSON</summary>
                <pre className="outputLog"><code>{exampleInputBody}</code></pre>
              </details>
            )}
          </fieldset>
        )}

        {actorDetails && (
          <fieldset>
            <legend>Actor Input</legend>
            <div className="layoutTwo">
              <div className="col">
                {Object.keys(inputSchema).length === 0 && (
                  <p className="muted small">This actor doesn't define an example input. You can still run it without additional parameters.</p>
                )}
                {Object.entries(inputSchema).map(([key, type]) => (
                  <label key={key}>
                    <p>{key} <span className="muted">({type})</span></p>
                    {type === 'boolean' ? (
                      <select value={inputValues[key] ? 'true' : 'false'} onChange={(e) => updateInputValue(key, e.target.value === 'true', 'boolean')}>
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    ) : type === 'number' ? (
                      <input type="number" value={inputValues[key]} onChange={(e) => updateInputValue(key, e.target.value, 'number')} />
                    ) : type === 'json' ? (
                      <textarea value={inputValues[key]} onChange={(e) => updateInputValue(key, e.target.value, 'json')} />
                    ) : (
                      <input type="text" value={inputValues[key]} onChange={(e) => updateInputValue(key, e.target.value, 'string')} />
                    )}
                  </label>
                ))}
              </div>

              <div className="col">
                <label>
                  <p>Output Key (KV Store)</p>
                  <input type="text" value={outputKey} onChange={(e) => setOutputKey(e.target.value)} />
                </label>
                <button type="button" className="action" onClick={handleRunActor} disabled={loading}>
                  {loading ? 'Running…' : 'Run actor'}
                </button>

                {run && (
                  <div className="panel" style={{ marginTop: '.75rem' }}>
                    <div className={statusClass}>{run.status}</div>
                    <div className="small">Cost: ${run.usageTotalUsd} · Store: {run.defaultKeyValueStoreId || '—'} · Dataset: {run.defaultDatasetId || '—'}</div>
                    {directUrl && (
                      <div className="small" style={{ marginTop: '.4rem' }}>
                        Direct output link: <a href={directUrl} target="_blank" rel="noreferrer">{directUrl}</a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>Logs</legend>
          {logs.length === 0 ? (
            <p className="muted small">No logs yet.</p>
          ) : (
            <div className="outputLog">
              {logs.map((l, i) => (
                <pre key={i}>{String(l)}</pre>
              ))}
            </div>
          )}
        </fieldset>

        {(kvRecord || (datasetItems && datasetItems.length)) && (
          <fieldset>
            <legend>Outputs</legend>
            {kvRecord && (
              <div className="panel">
                <strong>Key-Value Store Record</strong>
                {kvRecord.meta?.contentType && (
                  <div className="small muted">contentType: {kvRecord.meta.contentType}</div>
                )}
                <pre className="outputLog" style={{ marginTop: '.5rem' }}>
                  <code>{safeStringify(kvRecord.value)}</code>
                </pre>
              </div>
            )}
            {datasetItems && datasetItems.length > 0 && (
              <div className="panel">
                <strong>Dataset Items ({datasetItems.length})</strong>
                <ul className="itemsList">
                  {datasetItems.slice(0, 50).map((item, i) => (
                    <li key={i}><code>{safeStringify(item)}</code></li>
                  ))}
                </ul>
                {datasetItems.length > 50 && <div className="small muted">Showing first 50 items…</div>}
              </div>
            )}
          </fieldset>
        )}
      </form>
    </div>
  );
}

function safeStringify(val) {
  try {
    if (typeof val === 'string') return val;
    return JSON.stringify(val, null, 2);
  } catch (_) {
    return String(val);
  }
}
