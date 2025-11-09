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
  // schema map: key -> { type, itemsType, enum, description, required, placeholder, raw }
  const [inputSchema, setInputSchema] = useState({});
  const [inputValues, setInputValues] = useState({});
  const [schemaSource, setSchemaSource] = useState(null); // 'build' | 'example' | null

  // Run and outputs
  const [clientInfo, setClientInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState(null);
  const [kvRecord, setKvRecord] = useState(null);
  const [datasetItems, setDatasetItems] = useState([]);
  const [logs, setLogs] = useState([]);
  const addLog = msg => setLogs(l => [...l, typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)]);

  const client = useMemo(() => {
    if (!token || !ApifyClient) return null;
    try {
      return new ApifyClient({ token });
    } catch (_) {
      return null;
    }
  }, [token]);

  useEffect(() => {
    try {
      if (token) localStorage.setItem('apifyToken', token);
    } catch (_) {}
  }, [token]);

  async function handleLoadActor(e) {
    e?.preventDefault?.();
    setActorDetails(null);
    setRun(null);
    setKvRecord(null);
    setDatasetItems([]);
    setLogs([]);
    setInputSchema({});
    setInputValues({});
    setSchemaSource(null);
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

      // Attempt to fetch build input schema
      let schemaProps = null;
      let requiredList = [];
      try {
        addLog('Getting input schema from latest build...');
        const latestBuildId = a?.taggedBuilds?.latest?.buildId;
        console.debug(`latestBuildId:`, latestBuildId);
        if (latestBuildId) {
          const build = await client.build(latestBuildId).get();
          console.debug(`build:`, build);
          // prefer actorDefinition path
          schemaProps = build?.actorDefinition?.input?.properties || build?.inputSchema || build?.inputSchema?.properties || null;
          requiredList = build?.actorDefinition?.input?.required || build?.inputSchema?.required || [];
        } else {
          addLog('No latest tagged build ID found.');
        }
      } catch (error) {
        console.error(error);
        addLog(`Couldn't get latest tagged build: ${error?.message || error}`);
      }

      const requiredSet = new Set(Array.isArray(requiredList) ? requiredList : []);
      const schemaMap = {};
      const valuesMap = {};

      if (schemaProps && typeof schemaProps === 'object') {
        setSchemaSource('build');
        addLog('Using input schema from latest build.');
        for (const [key, prop] of Object.entries(schemaProps)) {
          const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
          const entry = {
            type: type || 'string',
            itemsType: prop?.items ? (Array.isArray(prop.items.type) ? prop.items.type[0] : prop.items.type) : undefined,
            enum: prop?.enum,
            description: prop?.description,
            required: requiredSet.has(key),
            placeholder: prop?.placeholderValue ?? prop?.prefill,
            raw: prop,
          };
          schemaMap[key] = entry;
          const _default = prop?.default ?? prop?.placeholderValue ?? prop?.prefill;
          let v = _default;
          if (entry.type === 'object') {
            try {
              valuesMap[key] = v != null ? JSON.stringify(v, null, 2) : '';
            } catch {
              valuesMap[key] = String(v);
            }
          } else if (entry.type === 'array') {
            if (Array.isArray(v)) valuesMap[key] = v.join(', ');
            else if (typeof v === 'string') valuesMap[key] = v;
            else valuesMap[key] = '';
          } else if (entry.type === 'boolean') {
            valuesMap[key] = v == null ? false : Boolean(v);
          } else if (entry.type === 'number' || entry.type === 'integer') {
            valuesMap[key] = typeof v === 'number' ? v : v === undefined ? '' : Number(v);
          } else {
            valuesMap[key] = v ?? '';
          }
        }
      } else {
        setSchemaSource('example');
        addLog('Falling back to exampleRunInput for dynamic fields.');
        let example = {};
        try {
          example = body ? JSON.parse(body) : {};
        } catch {
          example = {};
        }
        if (example && typeof example === 'object') {
          for (const [key, defVal] of Object.entries(example)) {
            if (Array.isArray(defVal)) {
              schemaMap[key] = { type: 'array' };
              valuesMap[key] = defVal.join(', ');
            } else if (defVal && typeof defVal === 'object') {
              schemaMap[key] = { type: 'object' };
              try {
                valuesMap[key] = JSON.stringify(defVal, null, 2);
              } catch {
                valuesMap[key] = String(defVal);
              }
            } else if (typeof defVal === 'boolean') {
              schemaMap[key] = { type: 'boolean' };
              valuesMap[key] = defVal;
            } else if (typeof defVal === 'number') {
              schemaMap[key] = { type: 'number' };
              valuesMap[key] = defVal;
            } else {
              schemaMap[key] = { type: 'string' };
              valuesMap[key] = defVal ?? '';
            }
          }
        }
      }

      setInputSchema(schemaMap);
      setInputValues(valuesMap);
      addLog('Actor loaded. Configure inputs below, then run.');
    } catch (err) {
      console.error(err);
      addLog(`Error: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  function updateInputValue(key, rawVal, type) {
    if (type === 'number' || type === 'integer') {
      setInputValues(prev => ({ ...prev, [key]: rawVal === '' ? '' : Number(rawVal) }));
      return;
    }
    if (type === 'boolean') {
      setInputValues(prev => ({ ...prev, [key]: rawVal === true || rawVal === 'true' }));
      return;
    }
    setInputValues(prev => ({ ...prev, [key]: rawVal }));
  }

  async function handleRunActor(e) {
    e?.preventDefault?.();
    if (!client) {
      addLog('Error: ApifyClient not initialized.');
      return;
    }
    if (!actorId) {
      addLog('Error: Missing actor ID.');
      return;
    }

    const input = {};
    try {
      for (const [key, sch] of Object.entries(inputSchema)) {
        const type = sch.type;
        const v = inputValues[key];
        if (type === 'object') {
          if (typeof v === 'string' && v.trim() !== '') {
            try {
              input[key] = JSON.parse(v);
            } catch {
              throw new Error(`Field "${key}" contains invalid JSON.`);
            }
          } else if (v && typeof v === 'object') {
            input[key] = v;
          }
        } else if (type === 'array') {
          if (typeof v === 'string') {
            const trimmed = v.trim();
            if (trimmed === '') {
              /* skip */
            } else if (trimmed.startsWith('[')) {
              try {
                const arr = JSON.parse(trimmed);
                if (Array.isArray(arr)) input[key] = arr;
                else throw new Error();
              } catch {
                throw new Error(`Field "${key}" must be a comma-separated list or JSON array.`);
              }
            } else {
              const parts = trimmed
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
              if (sch.itemsType === 'number' || sch.itemsType === 'integer') {
                const nums = parts.map(p => Number(p));
                if (nums.some(n => Number.isNaN(n))) throw new Error(`Field "${key}" must contain only numbers.`);
                input[key] = nums;
              } else if (sch.itemsType === 'boolean') {
                const bools = parts.map(p => p.toLowerCase()).map(p => (p === 'true' ? true : p === 'false' ? false : p));
                if (bools.some(b => b !== true && b !== false)) throw new Error(`Field "${key}" must contain only booleans (true/false).`);
                input[key] = bools;
              } else {
                input[key] = parts;
              }
            }
          } else if (Array.isArray(v)) {
            input[key] = v;
          }
        } else if (type === 'number' || type === 'integer') {
          if (v === '' || Number.isNaN(Number(v))) throw new Error(`Field "${key}" must be a number.`);
          input[key] = Number(v);
        } else if (type === 'boolean') {
          input[key] = Boolean(v);
        } else {
          // string or other
          const s = typeof v === 'string' ? v.trim() : v;
          if (s !== '' && s != null) input[key] = s;
        }
      }
      const missing = Object.entries(inputSchema)
        .filter(([k, sch]) => sch.required)
        .map(([k]) => k)
        .filter(k => !(k in input));
      if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
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
    } catch (err) {
      console.error(err);
      addLog(`Run error: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchOutput() {
    if (!client) {
      addLog('Error: ApifyClient not initialized.');
      return;
    }
    if (!run) {
      addLog('Error: No run to fetch output from.');
      return;
    }
    setKvRecord(null);
    setDatasetItems([]);
    try {
      setLoading(true);
      if (run.defaultKeyValueStoreId && outputKey) {
        try {
          addLog('Fetching KV store output...');
          const rec = await client.keyValueStore(run.defaultKeyValueStoreId).getRecord(outputKey);
          const display = rec && typeof rec === 'object' && 'value' in rec ? rec.value : rec;
          setKvRecord({ meta: rec && rec.contentType ? { contentType: rec.contentType } : null, value: display });
        } catch (err) {
          addLog(`KV fetch warning: ${err?.message || err}`);
        }
      } else {
        addLog('No defaultKeyValueStoreId on run or missing Output Key.');
      }

      if (run.defaultDatasetId) {
        try {
          addLog('Fetching dataset items...');
          const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
          setDatasetItems(items || []);
          addLog(`Fetched ${items?.length || 0} dataset items.`);
        } catch (err) {
          addLog(`Dataset fetch warning: ${err?.message || err}`);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const directUrl = useMemo(() => {
    const storeId = run?.defaultKeyValueStoreId;
    if (!storeId || !outputKey) return null;
    return `https://api.apify.com/v2/key-value-stores/${storeId}/records/${encodeURIComponent(outputKey)}?disableRedirect=1`;
  }, [run, outputKey]);

  const statusClass =
    run?.status === 'SUCCEEDED' ? 'statusBadge status-succeeded' : run?.status === 'RUNNING' ? 'statusBadge status-running' : run?.status ? 'statusBadge status-failed' : 'statusBadge';

  return (
    <div>
      <form onSubmit={handleLoadActor}>
        <fieldset>
          <legend>Apify Connection</legend>
          <div className='row'>
            <label>
              <p>API Token</p>
              <input type='password' placeholder='apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' value={token} onChange={e => setToken(e.target.value)} required />
            </label>
            <label>
              <p>Actor ID</p>
              <input type='text' placeholder='apify/hello-world' value={actorId} onChange={e => setActorId(e.target.value)} required />
            </label>
          </div>
          <button type='submit' className='action' disabled={!token || !actorId || !ApifyClient || loading}>
            {loading ? 'Loading…' : 'Load actor'}
          </button>
        </fieldset>

        {actorDetails && (
          <fieldset>
            <legend>Actor Details</legend>
            <div className='actorHeader'>
              <a href={`https://apify.com/${actorDetails.username}/${actorDetails.name}`} target='_blank' rel='noreferrer'>
                <strong>
                  {actorDetails.username}/{actorDetails.name}
                </strong>
              </a>
              <span className='muted'> &nbsp;ID: {actorDetails.id}</span>
            </div>
            {actorDetails.description && <p className='small'>{actorDetails.description}</p>}
            <div className='small muted'>
              <div>
                <strong>Stats</strong>
              </div>
              <ul style={{ margin: '.25rem 0 0 .9rem' }}>
                <li>
                  Users: {actorDetails.stats?.totalUsers} (last 30 days: {actorDetails.stats?.totalUsers30Days})
                </li>
                <li>
                  Runs: {actorDetails.stats?.totalRuns} (last 30 days: {actorDetails.stats?.publicActorRunStats30Days?.SUCCEEDED}/{actorDetails.stats?.publicActorRunStats30Days?.TOTAL})
                </li>
              </ul>
            </div>
            {exampleInputBody && (
              <details style={{ marginTop: '.5rem' }}>
                <summary className='small'>Example input JSON</summary>
                <pre className='outputLog'>
                  <code>{exampleInputBody}</code>
                </pre>
              </details>
            )}
            {schemaSource && <div className='small muted'>Schema source: {schemaSource}</div>}
          </fieldset>
        )}

        {actorDetails && (
          <fieldset>
            <legend>Actor Input</legend>
            <div className='layoutTwo'>
              <div className='col'>
                {Object.keys(inputSchema).length === 0 && <p className='muted small'>This actor doesn't define an input schema or example input. You can still run it without parameters.</p>}
                {Object.entries(inputSchema).map(([key, sch]) => (
                  <label key={key}>
                    <p>
                      {key}{' '}
                      {sch.required && (
                        <span title='required' className='muted'>
                          *
                        </span>
                      )}{' '}
                      <span className='muted'>
                        ({sch.type}
                        {sch.type === 'array' && sch.itemsType ? `<${sch.itemsType}>` : ''})
                      </span>
                    </p>
                    {sch.description && (
                      <div className='small muted' style={{ marginTop: '-.25rem', marginBottom: '.25rem' }}>
                        {sch.description}
                      </div>
                    )}
                    {Array.isArray(sch.enum) && sch.enum.length ? (
                      <select value={String(inputValues[key] ?? '')} onChange={e => updateInputValue(key, e.target.value, sch.type)}>
                        <option value=''>— Select —</option>
                        {sch.enum.map((opt, i) => (
                          <option key={i} value={String(opt)}>
                            {String(opt)}
                          </option>
                        ))}
                      </select>
                    ) : sch.type === 'boolean' ? (
                      <select value={inputValues[key] ? 'true' : 'false'} onChange={e => updateInputValue(key, e.target.value === 'true', 'boolean')}>
                        <option value='false'>false</option>
                        <option value='true'>true</option>
                      </select>
                    ) : sch.type === 'number' || sch.type === 'integer' ? (
                      <input
                        type='number'
                        value={inputValues[key]}
                        onChange={e => updateInputValue(key, e.target.value, sch.type)}
                        placeholder={sch.placeholder != null ? String(sch.placeholder) : undefined}
                      />
                    ) : sch.type === 'object' ? (
                      <textarea
                        value={inputValues[key]}
                        onChange={e => updateInputValue(key, e.target.value, 'object')}
                        placeholder={sch.placeholder != null ? safeStringify(sch.placeholder) : undefined}
                      />
                    ) : sch.type === 'array' ? (
                      <input
                        type='text'
                        value={inputValues[key]}
                        onChange={e => updateInputValue(key, e.target.value, 'array')}
                        placeholder={sch.placeholder != null ? String(sch.placeholder) : 'comma, separated, values'}
                      />
                    ) : (
                      <input
                        type='text'
                        value={inputValues[key]}
                        onChange={e => updateInputValue(key, e.target.value, 'string')}
                        placeholder={sch.placeholder != null ? String(sch.placeholder) : undefined}
                      />
                    )}
                  </label>
                ))}
              </div>
              <div className='col'>
                <button type='button' className='action' onClick={handleRunActor} disabled={loading}>
                  {loading ? 'Running…' : 'Run actor'}
                </button>
                {run && (
                  <div className='panel' style={{ marginTop: '.75rem' }}>
                    <div className={statusClass}>{run.status}</div>
                    <div className='small'>
                      Cost: ${run.usageTotalUsd} · Store: {run.defaultKeyValueStoreId || '—'} · Dataset: {run.defaultDatasetId || '—'}
                    </div>
                  </div>
                )}
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
                <input type='text' value={outputKey} onChange={e => setOutputKey(e.target.value)} />
              </label>
              {directUrl && (
                <div style={{ alignSelf: 'flex-end' }}>
                  <div className='small'>Direct output link:</div>
                  <div className='small'>
                    <a href={directUrl} target='_blank' rel='noreferrer'>
                      {directUrl}
                    </a>
                  </div>
                </div>
              )}
            </div>
            <button type='button' className='action' onClick={handleFetchOutput} disabled={loading}>
              Fetch output
            </button>
            {(kvRecord || (datasetItems && datasetItems.length)) && (
              <div style={{ marginTop: '.75rem' }}>
                {kvRecord && (
                  <div className='panel'>
                    <strong>Key-Value Store Record</strong>
                    {kvRecord.meta?.contentType && <div className='small muted'>contentType: {kvRecord.meta.contentType}</div>}
                    <pre className='outputLog' style={{ marginTop: '.5rem' }}>
                      <code>{safeStringify(kvRecord.value)}</code>
                    </pre>
                  </div>
                )}
                {datasetItems && datasetItems.length > 0 && (
                  <div className='panel'>
                    <strong>Dataset Items ({datasetItems.length})</strong>
                    <ul className='itemsList'>
                      {datasetItems.slice(0, 50).map((item, i) => (
                        <li key={i}>
                          <code>{safeStringify(item)}</code>
                        </li>
                      ))}
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
          {logs.length === 0 ? (
            <p className='muted small'>No logs yet.</p>
          ) : (
            <div className='outputLog'>
              {logs.map((l, i) => (
                <pre key={i}>{String(l)}</pre>
              ))}
            </div>
          )}
        </fieldset>
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
