/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

this.workbox = this.workbox || {};
this.workbox.googleAnalytics = (function () {
'use strict';

/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

var constants = {
  CACHE_NAME: 'offline-google-analytics',
  IDB: {
    NAME: 'offline-google-analytics',
    STORE: 'urls',
    VERSION: 1,
  },
  MAX_ANALYTICS_BATCH_SIZE: 20,
  STOP_RETRYING_AFTER: 1000 * 60 * 60 * 48, // Two days, in milliseconds.
  URL: {
    ANALYTICS_JS_PATH: '/analytics.js',
    COLLECT_PATH: '/collect',
    HOST: 'www.google-analytics.com',
  },
};

function createCommonjsModule(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}

var idb = createCommonjsModule(function (module) {
'use strict';

(function() {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result);
      };

      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function(resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }

  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function(value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function(prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function() {
          return this[targetProp][prop];
        },
        set: function(val) {
          this[targetProp][prop] = val;
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', [
    'name',
    'keyPath',
    'multiEntry',
    'unique'
  ]);

  proxyRequestMethods(Index, '_index', IDBIndex, [
    'get',
    'getKey',
    'getAll',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, [
    'openCursor',
    'openKeyCursor'
  ]);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', [
    'direction',
    'key',
    'primaryKey',
    'value'
  ]);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
    'update',
    'delete'
  ]);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function() {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function() {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function(value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function() {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function() {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', [
    'name',
    'keyPath',
    'indexNames',
    'autoIncrement'
  ]);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'put',
    'add',
    'delete',
    'clear',
    'get',
    'getAll',
    'getKey',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'openCursor',
    'openKeyCursor'
  ]);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, [
    'deleteIndex'
  ]);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function(resolve, reject) {
      idbTransaction.oncomplete = function() {
        resolve();
      };
      idbTransaction.onerror = function() {
        reject(idbTransaction.error);
      };
      idbTransaction.onabort = function() {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function() {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', [
    'objectStoreNames',
    'mode'
  ]);

  proxyMethods(Transaction, '_tx', IDBTransaction, [
    'abort'
  ]);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function() {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, [
    'deleteObjectStore',
    'close'
  ]);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function() {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(DB, '_db', IDBDatabase, [
    'close'
  ]);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function(funcName) {
    [ObjectStore, Index].forEach(function(Constructor) {
      Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function() {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function(Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function(query, count) {
      var instance = this;
      var items = [];

      return new Promise(function(resolve) {
        instance.iterateCursor(query, function(cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      request.onupgradeneeded = function(event) {
        if (upgradeCallback) {
          upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
        }
      };

      return p.then(function(db) {
        return new DB(db);
      });
    },
    delete: function(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  {
    module.exports = exp;
  }
}());
});

/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

/* eslint-disable require-jsdoc */

/**
 * A wrapper to store for an IDB connection to a particular ObjectStore.
 *
 * @private
 */
class IDBHelper {
  constructor(name, version, storeName) {
    if (name == undefined || version == undefined || storeName == undefined) {
      throw Error('name, version, storeName must be passed to the ' +
        'constructor.');
    }

    this._name = name;
    this._version = version;
    this._storeName = storeName;
  }

  /**
   * Returns a promise that resolves with an open connection to IndexedDB,
   * either existing or newly opened.
   *
   * @private
   * @return {Promise<DB>}
   */
  _getDb() {
    if (this._dbPromise) {
      return this._dbPromise;
    }

    this._dbPromise = idb.open(this._name, this._version, (upgradeDB) => {
      upgradeDB.createObjectStore(this._storeName);
    })
    .then((db) => {
      return db;
    });

    return this._dbPromise;
  }

  close() {
    if (!this._dbPromise) {
      return;
    }

    return this._dbPromise
    .then((db) => {
      db.close();
      this._dbPromise = null;
    });
  }

  /**
   * Wrapper on top of the idb wrapper, which simplifies saving the key/value
   * pair to the object store.
   * Returns a Promise that fulfills when the transaction completes.
   *
   * @private
   * @param {String} key
   * @param {Object} value
   * @return {Promise<T>}
   */
  put(key, value) {
    return this._getDb().then((db) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const objectStore = tx.objectStore(this._storeName);
      objectStore.put(value, key);
      return tx.complete;
    });
  }

  /**
   * Wrapper on top of the idb wrapper, which simplifies deleting an entry
   * from the object store.
   * Returns a Promise that fulfills when the transaction completes.
   *
   * @private
   * @param {String} key
   * @return {Promise<T>}
   */
  delete(key) {
    return this._getDb().then((db) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const objectStore = tx.objectStore(this._storeName);
      objectStore.delete(key);
      return tx.complete;
    });
  }

  /**
   * Wrapper on top of the idb wrapper, which simplifies getting a key's value
   * from the object store.
   * Returns a promise that fulfills with the value.
   *
   * @private
   * @param {String} key
   * @return {Promise<Object>}
   */
  get(key) {
    return this._getDb().then((db) => {
      return db.transaction(this._storeName)
        .objectStore(this._storeName)
        .get(key);
    });
  }

  /**
   * Wrapper on top of the idb wrapper, which simplifies getting all the values
   * in an object store.
   * Returns a promise that fulfills with all the values.
   *
   * @private
   * @return {Promise<Array<Object>>}
   */
  getAllValues() {
    return this._getDb().then((db) => {
      return db.transaction(this._storeName)
        .objectStore(this._storeName)
        .getAll();
    });
  }

  /**
   * Wrapper on top of the idb wrapper, which simplifies getting all the keys
   * in an object store.
   * Returns a promise that fulfills with all the keys.
   *
   * @private
   * @param {String} storeName
   * @return {Promise<Array<Object>>}
   */
  getAllKeys() {
    return this._getDb().then((db) => {
      return db.transaction(this._storeName)
        .objectStore(this._storeName)
        .getAllKeys();
    });
  }
}

/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

/* eslint-env worker, serviceworker */

const idbHelper = new IDBHelper(constants.IDB.NAME, constants.IDB.VERSION,
  constants.IDB.STORE);

/**
 * Adds a URL to IndexedDB, along with the current timestamp.
 *
 * If the request has a body, that body will be used as the URL's search
 * parameters when saving the URL to IndexedDB.
 *
 * If no `time` parameter is provided, Date.now() will be used.
 *
 * @private
 * @param {Request} request
*  @param {Number} [time]
 * @return {Promise.<T>} A promise that resolves when IndexedDB is updated.
 */
var enqueueRequest = (request, time) => {
  const url = new URL(request.url);
  return request.text().then((body) => {
    // If there's a request body, then use it as the URL's search value.
    // This is most likely because the original request was an HTTP POST
    // that uses the beacon transport.
    if (body) {
      url.search = body;
    }

    return idbHelper.put(url.toString(), time || Date.now());
  });
};

/* eslint-disable no-console */

/**
 * A simple helper to manage the print of a set of logs
 */
class LogGroup {
  /**
   * @param {object} input
   * @param {string} input.title
   * @param {boolean} input.isPrimary
   */
  constructor({title, isPrimary} = {}) {
    this._isPrimary = isPrimary || false;
    this._groupTitle = title || '';
    this._logs = [];
    this._childGroups = [];

    this._isFirefox = false;
    if (/Firefox\/\d*\.\d*/.exec(navigator.userAgent)) {
      this._isFirefox = true;
    }

    this._isEdge = false;
    if (/Edge\/\d*\.\d*/.exec(navigator.userAgent)) {
      this._isEdge = true;
    }
  }

  /**
   *@param {object} logDetails
   */
  addLog(logDetails) {
    this._logs.push(logDetails);
  }

  /**
   * @param {object} group
   */
  addChildGroup(group) {
    if (group._logs.length === 0) {
      return;
    }

    this._childGroups.push(group);
  }

  /**
   * prints out this log group to the console.
   */
  print() {
    if (this._isEdge) {
      this._printEdgeFriendly();
      return;
    }

    this._openGroup();

    this._logs.forEach((logDetails) => {
      this._printLogDetails(logDetails);
    });

    this._childGroups.forEach((group) => {
      group.print();
    });

    this._closeGroup();
  }

  /**
   * This prints a simpler log for Edge which has poor group support.
   * For more details see:
   * https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/11363242/
   */
  _printEdgeFriendly() {
    // Edge has no support for colors at all and poor support for groups.
    this._logs.forEach((logDetails, index) => {
      // Message can be an object - i.e. an error.
      let message = logDetails.message;
      if (typeof message === 'string') {
        // Replace the %c value with an empty string.
        message = message.replace(/%c/g, '');
      }
      const logArgs = [message];
      if (logDetails.error) {
        logArgs.push(logDetails.error);
      }
      if (logDetails.args) {
        logArgs.push(logDetails.args);
      }
      const logFunc = logDetails.logFunc || console.log;
      logFunc(...logArgs);
    });

    this._childGroups.forEach((group, index) => {
       group.print();
    });
  }

  /**
   * Prints the specific logDetails object.
   * @param {object} logDetails
   */
  _printLogDetails(logDetails) {
    const logFunc = logDetails.logFunc ? logDetails.logFunc : console.log;
    let message = logDetails.message;
    let allArguments = [message];
    if (logDetails.colors && !this._isEdge) {
      allArguments = allArguments.concat(logDetails.colors);
    }
    if (logDetails.args) {
      allArguments = allArguments.concat(logDetails.args);
    }
    logFunc(...allArguments);
  }

  /**
   * Opens a console group - managing differences in Firefox.
   */
  _openGroup() {
    if (this._isPrimary) {
      // Only start a group is there are child groups
      if (this._childGroups.length === 0) {
        return;
      }

      const logDetails = this._logs.shift();
      if (this._isFirefox) {
        // Firefox doesn't support colors logs in console.group.
        this._printLogDetails(logDetails);
        return;
      }

      // Print the colored message with console.group
      logDetails.logFunc = console.group;
      this._printLogDetails(logDetails);
    } else {
      console.groupCollapsed(this._groupTitle);
    }
  }

  /**
   * Closes a console group
   */
  _closeGroup() {
    // Only close a group if there was a child group opened
    if (this._isPrimary && this._childGroups.length === 0) {
      return;
    }

    console.groupEnd();
  }
}

/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

/**
 * @private
 * @return {boolean} True, if we're running in the service worker global scope.
 * False otherwise.
 */
function isServiceWorkerGlobalScope() {
  return ('ServiceWorkerGlobalScope' in self &&
          self instanceof ServiceWorkerGlobalScope);
}

/**
 * @private
 * @return {boolean} True, if we're running a development bundle.
 * False otherwise.
 */
function isDevBuild() {
  // `dev` is replaced during the build process.
  return `dev` === `dev`;
}

/**
 * @private
 * @return {boolean} True, if we're running on localhost or the equivalent IP
 * address. False otherwise.
 */
function isLocalhost() {
  return Boolean(
    location.hostname === 'localhost' ||
    // [::1] is the IPv6 localhost address.
    location.hostname === '[::1]' ||
    // 127.0.0.1/8 is considered localhost for IPv4.
    location.hostname.match(
      /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
    )
  );
}

var environment = {
  isDevBuild,
  isLocalhost,
  isServiceWorkerGlobalScope,
};

/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

/* eslint-disable no-console */

self.workbox = self.workbox || {};
self.workbox.LOG_LEVEL = self.workbox.LOG_LEVEL || {
  none: -1,
  verbose: 0,
  debug: 1,
  warn: 2,
  error: 3,
};

const LIGHT_GREY = `#bdc3c7`;
const DARK_GREY = `#7f8c8d`;
const LIGHT_GREEN = `#2ecc71`;
const LIGHT_YELLOW = `#f1c40f`;
const LIGHT_RED = `#e74c3c`;
const LIGHT_BLUE = `#3498db`;

/**
 * A class that will only log given the current log level
 * defined by the developer.
 *
 * Define custom log level by setting `self.workbox.logLevel`.
 *
 * @example
 *
 * self.workbox.logLevel = self.workbox.LOG_LEVEL.verbose;
 *
 * @private
 */
class LogHelper {
  /**
   * LogHelper constructor.
   */
  constructor() {
    this._defaultLogLevel = environment.isDevBuild() ?
      self.workbox.LOG_LEVEL.debug :
      self.workbox.LOG_LEVEL.warn;
  }

  /**
   * The most verbose log level.
   *
   * @param {Object} options The options of the log.
   */
  log(options) {
    this._printMessage(self.workbox.LOG_LEVEL.verbose, options);
  }

  /**
   * Useful for logs that are more exceptional that log()
   * but not severe.
   *
   * @param {Object} options The options of the log.
   */
  debug(options) {
    this._printMessage(self.workbox.LOG_LEVEL.debug, options);
  }

  /**
   * Warning messages.
   *
   * @param {Object} options The options of the log.
   */
  warn(options) {
    this._printMessage(self.workbox.LOG_LEVEL.warn, options);
  }

  /**
   * Error logs.
   *
   * @param {Object} options The options of the log.
   */
  error(options) {
    this._printMessage(self.workbox.LOG_LEVEL.error, options);
  }

  /**
   * Method to print to the console.
   * @param {number} logLevel
   * @param {Object} logOptions
   */
  _printMessage(logLevel, logOptions) {
    if (!this._shouldLogMessage(logLevel, logOptions)) {
      return;
    }

    const logGroups = this._getAllLogGroups(logLevel, logOptions);
    logGroups.print();
  }

  /**
   * Print a user friendly log to the console.
   * @param  {numer} logLevel A number from self.workbox.LOG_LEVEL
   * @param  {Object} logOptions Arguments to print to the console
   * @return {LogGroup} Returns a log group to print to the console.
   */
  _getAllLogGroups(logLevel, logOptions) {
    const topLogGroup = new LogGroup({
      isPrimary: true,
      title: 'workbox log.',
    });

    const primaryMessage = this._getPrimaryMessageDetails(logLevel, logOptions);
    topLogGroup.addLog(primaryMessage);

    if (logOptions.error) {
      const errorMessage = {
        message: logOptions.error,
        logFunc: console.error,
      };
      topLogGroup.addLog(errorMessage);
    }

    const extraInfoGroup = new LogGroup({title: 'Extra Information.'});
    if (logOptions.that && logOptions.that.constructor &&
      logOptions.that.constructor.name) {
      const className = logOptions.that.constructor.name;
      extraInfoGroup.addLog(
        this._getKeyValueDetails('class', className)
      );
    }

    if (logOptions.data) {
      if (typeof logOptions.data === 'object' &&
        !(logOptions.data instanceof Array)) {
        Object.keys(logOptions.data).forEach((keyName) => {
          extraInfoGroup.addLog(
            this._getKeyValueDetails(keyName, logOptions.data[keyName])
          );
        });
      } else {
        extraInfoGroup.addLog(
          this._getKeyValueDetails('additionalData', logOptions.data)
        );
      }
    }

    topLogGroup.addChildGroup(extraInfoGroup);

    return topLogGroup;
  }

  /**
   * This is a helper function to wrap key value pairss to a colored key
   * value string.
   * @param  {string} key
   * @param  {string} value
   * @return {Object} The object containing a message, color and Arguments
   * for the console.
   */
  _getKeyValueDetails(key, value) {
    return {
      message: `%c${key}: `,
      colors: [`color: ${LIGHT_BLUE}`],
      args: value,
    };
  }

  /**
   * Helper method to color the primary message for the log
   * @param  {number} logLevel   One of self.workbox.LOG_LEVEL
   * @param  {Object} logOptions Arguments to print to the console
   * @return {Object} Object containing the message and color info to print.
   */
  _getPrimaryMessageDetails(logLevel, logOptions) {
    let logLevelName;
    let logLevelColor;
    switch (logLevel) {
      case self.workbox.LOG_LEVEL.verbose:
        logLevelName = 'Info';
        logLevelColor = LIGHT_GREY;
        break;
      case self.workbox.LOG_LEVEL.debug:
        logLevelName = 'Debug';
        logLevelColor = LIGHT_GREEN;
        break;
      case self.workbox.LOG_LEVEL.warn:
        logLevelName = 'Warn';
        logLevelColor = LIGHT_YELLOW;
        break;
      case self.workbox.LOG_LEVEL.error:
        logLevelName = 'Error';
        logLevelColor = LIGHT_RED;
        break;
    }

    let primaryLogMessage = `%c🔧 %c[${logLevelName}]`;
    const primaryLogColors = [
      `color: ${LIGHT_GREY}`,
      `color: ${logLevelColor}`,
    ];

    let message;
    if(typeof logOptions === 'string') {
      message = logOptions;
    } else if (logOptions.message) {
      message = logOptions.message;
    }

    if (message) {
      message = message.replace(/\s+/g, ' ');
      primaryLogMessage += `%c ${message}`;
      primaryLogColors.push(`color: ${DARK_GREY}; font-weight: normal`);
    }

    return {
      message: primaryLogMessage,
      colors: primaryLogColors,
    };
  }

  /**
   * Test if the message should actually be logged.
   * @param {number} logLevel The level of the current log to be printed.
   * @param {Object|String} logOptions The options to log.
   * @return {boolean} Returns true of the message should be printed.
   */
  _shouldLogMessage(logLevel, logOptions) {
    if (!logOptions) {
      return false;
    }

    let minValidLogLevel = this._defaultLogLevel;
    if (self && self.workbox && typeof self.workbox.logLevel === 'number') {
      minValidLogLevel = self.workbox.logLevel;
    }

    if (minValidLogLevel === self.workbox.LOG_LEVEL.none ||
      logLevel < minValidLogLevel) {
      return false;
    }

    return true;
  }
}

var logHelper = new LogHelper();

/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

/* eslint-env worker, serviceworker */

const idbHelper$1 = new IDBHelper(constants.IDB.NAME, constants.IDB.VERSION,
  constants.IDB.STORE);

/**
 * Replays all the queued requests found in IndexedDB, by calling fetch()
 * with an additional parameter indicating the offset from the original time.
 *
 * Returns a promise that resolves when the replaying is complete.
 *
 * @private
 * @param {Object=}   config Optional configuration arguments.
 * @param {Object=}   config.parameterOverrides Optional
 *                    [Measurement Protocol parameters](https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters),
 *                    expressed as key/value pairs, to be added to replayed
 *                    Google Analytics requests. This can be used to, e.g., set
 *                    a custom dimension indicating that the request was
 *                    replayed.
 * @param {Function=} config.hitFilter Optional
 *                    A function that allows you to modify the hit parameters
 *                    prior to replaying the hit. The function is invoked with
 *                    the original hit's URLSearchParams object as its only
 *                    argument. To abort the hit and prevent it from being
 *                    replayed, throw an error.
 * @return {Promise.<T>}
 */
 var replayQueuedRequests = (config) => {
  config = config || {};

  return idbHelper$1.getAllKeys().then((urls) => {
    return Promise.all(urls.map((url) => {
      return idbHelper$1.get(url).then((hitTime) => {
        const queueTime = Date.now() - hitTime;
        const newUrl = new URL(url);

        // Do not attempt to replay hits that are too old.
        if (queueTime > constants.STOP_RETRYING_AFTER) {
          return;
        }

        // Do not attempt to replay hits in browsers without
        // URLSearchParams support.
        if (!('searchParams' in newUrl)) {
          return;
        }

        let parameterOverrides = config.parameterOverrides || {};
        parameterOverrides.qt = queueTime;

        // Call sort() on the keys so that there's a reliable order of calls
        // to searchParams.set(). This isn't important in terms of
        // functionality, but it will make testing easier, since the
        // URL serialization depends on the order in which .set() is called.
        Object.keys(parameterOverrides).sort().forEach((parameter) => {
          newUrl.searchParams.set(parameter, parameterOverrides[parameter]);
        });

        // If the hitFilter config option was passed and is a function,
        // invoke it with searchParams as its argument allowing the function
        // to modify the hit prior to sending it. The function can also
        // throw an error to abort the hit if needed.
        let hitFilter = config.hitFilter;
        if (typeof hitFilter === 'function') {
          try {
            hitFilter(newUrl.searchParams);
          } catch (err) {
            return;
          }
        }

        return fetch(newUrl.toString());
      }).then(() => idbHelper$1.delete(url));
    }));
  });
};

/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

/* eslint-env worker, serviceworker */

/**
 * In order to use the library, call
 * `workbox.googleAnalytics.initialize()`.
 * It will take care of setting up service worker `fetch` handlers to ensure
 * that the Google Analytics JavaScript is available offline, and that any
 * Google Analytics requests made while offline are saved (using `IndexedDB`)
 * and retried the next time the service worker starts up.
 *
 * @example
 * // This code should live inside your service worker JavaScript, ideally
 * // before any other 'fetch' event handlers are defined:
 *
 * // First, import the library into the service worker global scope:
 * importScripts('path/to/offline-google-analytics-import.js');
 *
 * // Then, call workbox.googleAnalytics.initialize():
 * workbox.googleAnalytics.initialize();
 *
 * // At this point, implement any other service worker caching strategies
 * // appropriate for your web app.
 *
 * @example
 * // If you need to specify parameters to be sent with each hit, you can use
 * // the `parameterOverrides` configuration option. This is useful in cases
 * // where you want to set a custom dimension on all hits sent by the service
 * // worker to differentiate them in your reports later.
 * workbox.googleAnalytics.initialize({
 *   parameterOverrides: {
 *     cd1: 'replay'
 *   }
 * });
 *
 * @example
 * // In situations where you need to programmatically modify a hit's
 * // parameters you can use the `hitFilter` option. One example of when this
 * // might be useful is if you wanted to track the amount of time that elapsed
 * // between when the hit was attempted and when it was successfully replayed.
 * workbox.googleAnalytics.initialize({
 *   hitFilter: searchParams =>
 *     // Sets the `qt` param as a custom metric.
 *     const qt = searchParams.get('qt');
 *     searchParams.set('cm1', qt);
 *   }
 * });
 *
 * @module workbox-google-analytics
 */

/**
 * @alias workbox.googleAnalytics.initialize
 * @param {Object=}   config
 * @param {Object=}   config.parameterOverrides
 *                    [Measurement Protocol parameters](https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters),
 *                    expressed as key/value pairs, to be added to replayed
 *                    Google Analytics requests. This can be used to, e.g., set
 *                    a custom dimension indicating that the request was
 *                    replayed.
 * @param {Function=} config.hitFilter
 *                    A function that allows you to modify the hit parameters
 *                    prior to replaying the hit. The function is invoked with
 *                    the original hit's URLSearchParams object as its only
 *                    argument. To abort the hit and prevent it from being
 *                    replayed, throw an error.
 * @memberof module:workbox-google-analytics
 */
const initialize = (config) => {
  config = config || {};

  // Stores whether or not the previous /collect request failed.
  let previousHitFailed = false;

  self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const request = event.request;

    if (url.hostname === constants.URL.HOST) {
      if (url.pathname === constants.URL.COLLECT_PATH) {
        // If this is a /collect request, then use a network-first strategy,
        // falling back to queueing the request in IndexedDB.

        // Make a clone of the request before we use it, in case we need
        // to read the request body later on.
        const clonedRequest = request.clone();

        event.respondWith(
          fetch(request).then((response) => {
            if (previousHitFailed) {
              replayQueuedRequests(config);
            }
            previousHitFailed = false;
            return response;
          }, (error) => {
            logHelper.log('Enqueuing failed request...');
            previousHitFailed = true;
            return enqueueRequest(clonedRequest).then(() => Response.error());
          })
        );
      } else if (url.pathname === constants.URL.ANALYTICS_JS_PATH) {
        // If this is a request for the Google Analytics JavaScript library,
        // use the network first, falling back to the previously cached copy.
        event.respondWith(
          caches.open(constants.CACHE_NAME).then((cache) => {
            return fetch(request).then((response) => {
              return cache.put(request, response.clone()).then(() => response);
            }).catch((error) => {
              logHelper.error(error);
              return cache.match(request);
            });
          })
        );
      }
    }
  });

  replayQueuedRequests(config);
};

var index = {initialize};

return index;

}());
//# sourceMappingURL=workbox-google-analytics.dev.v1.0.0.js.map
