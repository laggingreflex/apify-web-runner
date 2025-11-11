// ESM version of apifyCore (converted from UMD)
import { ApifyClient } from 'apify-client';

function ensureClient(clientOrToken) {
  if (clientOrToken && typeof clientOrToken === 'object' && typeof clientOrToken.actor === 'function') {
    return clientOrToken; // already instance
  }
  const token = typeof clientOrToken === 'string' ? clientOrToken : (clientOrToken && clientOrToken.token) || process.env.APIFY_TOKEN;
  return new ApifyClient({ token });
}

async function loadActor(clientOrToken, actorId) {
  const client = ensureClient(clientOrToken);
  const details = await client.actor(actorId).get();
  return { client, actorDetails: details };
}

function pickLatestTaggedBuildId(actorDetails) {
  const tb = actorDetails && actorDetails.taggedBuilds;
  if (!tb) return null;
  return (tb.latest || tb.stable || (Object.values(tb)[0] || {})).buildId || null;
}

async function getSchemaAndDefaults(clientOrToken, actorDetails) {
  const client = ensureClient(clientOrToken);
  let schemaProps = null;
  let requiredList = [];
  let source = null;
  try {
    const latestBuildId = pickLatestTaggedBuildId(actorDetails);
    if (latestBuildId) {
      const build = await client.build(latestBuildId).get();
      const inputDef = (build && build.actorDefinition && build.actorDefinition.input) || null;
      const props = (inputDef && inputDef.properties) || build.inputSchema || (build.inputSchema && build.inputSchema.properties) || null;
      schemaProps = props && props.properties ? props.properties : props;
      requiredList = (inputDef && inputDef.required) || (build.inputSchema && build.inputSchema.required) || [];
      if (schemaProps && typeof schemaProps === 'object') source = 'build';
    }
  } catch (_) {}

  let defaultInput = {};
  let exampleObj = {};
  try {
    const body = actorDetails && actorDetails.exampleRunInput && actorDetails.exampleRunInput.body;
    exampleObj = body ? JSON.parse(body) : {};
  } catch (_) {
    exampleObj = {};
  }

  if (schemaProps && typeof schemaProps === 'object') {
    for (const [key, prop] of Object.entries(schemaProps)) {
      const v = prop && (prop.default ?? prop.placeholderValue ?? prop.prefill);
      if (v !== undefined) defaultInput[key] = v;
    }
  } else {
    source = source || 'example';
    if (exampleObj && typeof exampleObj === 'object' && !Array.isArray(exampleObj)) {
      defaultInput = exampleObj;
    } else {
      defaultInput = {};
    }
  }

  return { schemaProps: schemaProps || null, requiredList: Array.isArray(requiredList) ? requiredList : [], defaultInput, source, exampleObj };
}

async function runActor(clientOrToken, actorId, input) {
  const client = ensureClient(clientOrToken);
  return client.actor(actorId).call(input || {});
}

async function fetchOutputs(clientOrToken, run, outputKey) {
  const client = ensureClient(clientOrToken);
  const storeId = run && run.defaultKeyValueStoreId;
  const datasetId = run && run.defaultDatasetId;
  let kvRecord = null;
  let datasetItems = [];

  if (storeId && outputKey) {
    try {
      const rec = await client.keyValueStore(storeId).getRecord(outputKey);
      kvRecord = rec && typeof rec === 'object' && 'value' in rec ? { meta: rec.contentType ? { contentType: rec.contentType } : null, value: rec.value } : rec;
    } catch (_) {}
  }

  if (datasetId) {
    try {
      const list = await client.dataset(datasetId).listItems({ clean: true });
      datasetItems = (list && list.items) || [];
    } catch (_) {}
  }

  return { kvRecord, datasetItems };
}

export { ensureClient, loadActor, getSchemaAndDefaults, runActor, fetchOutputs };
