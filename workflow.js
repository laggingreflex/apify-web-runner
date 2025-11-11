(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./apifyCore'));
  } else {
    root.ApifyWorkflow = factory(root.ApifyCore);
  }
})(typeof self !== 'undefined' ? self : this, function (ApifyCore) {
  'use strict';
  if (!ApifyCore) throw new Error('ApifyCore not found');

  /**
   * uiAdapter contract (any environment):
   *  - async getConnectionInfo(initial): returns { token, actorId, outputKey }
   *  - async show(msg, data?)
   *  - async confirm(msg): boolean
   *  - async getInput(schemaProps, defaults): returns input object
   */
  async function runWorkflow(opts) {
    const { uiAdapter, initial } = opts;
    if (!uiAdapter) throw new Error('uiAdapter is required');

    const connection = await uiAdapter.getConnectionInfo(initial || {});
    const { token, actorId, outputKey = 'OUTPUT' } = connection;
    if (!token) throw new Error('Missing token');
    if (!actorId) throw new Error('Missing actorId');

    await uiAdapter.show(`Loading actor: ${actorId}`);
    const { client, actorDetails } = await ApifyCore.loadActor(token, actorId);
    await uiAdapter.show('Actor loaded', { id: actorDetails.id, name: actorDetails.name });

    const { schemaProps, requiredList, defaultInput, source, exampleObj } = await ApifyCore.getSchemaAndDefaults(client, actorDetails);
    await uiAdapter.show(`Schema source: ${source || 'none'}`);
    await uiAdapter.show('Default input prepared', defaultInput);

    const input = await uiAdapter.getInput(schemaProps, defaultInput, { required: requiredList, actorDetails, example: exampleObj });
    await uiAdapter.show('Running actor...', input);
    const run = await ApifyCore.runActor(client, actorId, input);
    await uiAdapter.show(`Run status: ${run.status}`, { costUsd: run.usageTotalUsd });
    if (run.status !== 'SUCCEEDED') {
      await uiAdapter.show('Run did not succeed. Aborting output fetch.', { status: run.status });
      return { run, input };
    }

    await uiAdapter.show('Fetching outputs...');
    const outputs = await ApifyCore.fetchOutputs(client, run, outputKey);
    await uiAdapter.show('Outputs fetched.', outputs);
    return { run, input, outputs };
  }

  return { runWorkflow };
});
