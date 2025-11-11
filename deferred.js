(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeferredUtil = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function deferred() {
    let resolve, reject;
    const p = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise: p, resolve, reject };
  }
  return { deferred };
});
