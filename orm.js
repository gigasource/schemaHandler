const EventEmitter = require('events');
const NodeCache = require('node-cache');
const Kareem = require('kareem');
const MongoClient = require('mongodb').MongoClient;
const _ = require('lodash');
const cache = new NodeCache({useClones: false/*, checkperiod: 2*/});
const orm = {
  setTtl(ttl) {
    this.cache.options.stdTTL = ttl;
  },
  cache,
  pluralize: true,
  connecting: false,
  connected: false,
  closed: false,
  mode: 'single',
  setSingleDbMode() {
    this.mode = 'single';
  },
  setMultiDbMode() {
    this.mode = 'multi';
  },
  getCollection,
  _getCollection,
  connect,
  close() {
    this.client.close();
  },
  //mock
  registerSchema(collectionName, dbName, schema) {
  },
  //mock
  getSchema(collectionName, dbName) {
  },
  //mock
  registerCollectionOptions(collectionName, dbName, options) {
  },
  //mock
  getOptions(collectionName, dbName) {
  },
  plugin(plugin) {
    plugin(orm);
  },
  waitForConnected() {
    return new Promise((resolve, reject) => {
      if (!orm.connecting && this.connected && this.closed) {
        this.connect(this.connectionInfo, orm.connectCb);
      }

      if (this._posts.get('connected')) this._posts.get('connected').length = 0;
      this.post('connected', (err) => {
        if (err) return reject(err);
        resolve();
      })
    });
  }
}


_.extend(orm, new Kareem());
const mquery = require('mquery');
const pluralize = require("mongoose-legacy-pluralize");

function builder(resolver) {
  return new Proxy({}, {
    get(target, key) {
      return new Proxy({modelName: key}, {
        get(target, key) {
          if (['modelName'].includes(key)) {
            return target[key];
          }
          return function () {
            return new Proxy({modelName: this.modelName, chain: [{fn: key, args: [...arguments]}]}, {
              get(target, key) {
                if (['chain', 'modelName'].includes(key)) {
                  return target[key];
                }
                if (key === 'then') {
                  return resolver;
                }
                return function () {
                  target.chain = target.chain || [];
                  target.chain.push({fn: key, args: [...arguments]});
                  return this;
                };
              }
            });
          };
        }
      });
    }
  });
}

let models = builder(async function (resolve, reject) {
  const query = {name: this.modelName, chain: this.chain};
  const useNative = query.chain.reduce((result, {fn}) => {
    if (!result) {
      if (fn.includes('insert') || fn.includes('create')/* || fn === 'findById'*/) result = true;
    }
    return result;
  }, false);
  if (!orm.cache.get('client')) {
    if (!orm.connected || orm.closed || orm.connecting) {
      await orm.waitForConnected();
    }
  }

  let cursor = createCollectionQuery(query.name, useNative);
  for (const {fn, args} of query.chain) {
    cursor = cursor[fn](...args);
  }
  cursor.then(resolve, reject);
});

function createCollectionQuery(collectionName, useNative) {
  //const _mongoCollection = orm.db.collection(collectionName)
  //const _collection = mquery().collection(orm.collection1);

  let _nativeCollection = _getCollection(...collectionName.split('@'));
  const _collection = useNative ? _nativeCollection : mquery().collection(_nativeCollection);
  const mongoCollection = new Proxy({
    collection: _collection,
    collectionName: collectionName.split('@')[0],
    dbName: collectionName.split('@')[1],
    isCreateCmd: false,
    lean: false,
    useNative
  }, {
    get(target, key, proxy) {
      //target here is mongo db collection
      if (!target.cursor) target.cursor = target.collection;
      if (key === 'collectionName') {
        return target.collectionName;
      }

      if (key === 'lean') {
        return function () {
          target.lean = true;
          //console.log('lean: ignored')
          return proxy;
        }
      }

      if (key === 'then') {
        return async (resolve, reject) => {
          try {
            const returnResult = {ok: false, value: null};
            orm.execPostSync('proxyPostQueryHandler', null, [{target, proxy}, returnResult]);

            const result = await target.cursor;
            const returnValue = await resultPostProcess(result, target);
            resolve(returnValue);
          } catch (e) {
            reject(e);
          }
        }
      }

      let defaultFn = function () {
        //console.log('fn : ', key);
        //console.log(arguments);
        target.cursor = target.cursor[key](...arguments);
        return proxy;
      }

      if (key === 'create') {
        target.isCreateCmd = true;
        defaultFn = function (obj) {
          // console.log('fn : ', key);
          // console.log(arguments);
          target.cursor = target.cursor['insertOne'](obj);
          return proxy;
        }
      }

      const result = {ok: false, value: null};
      orm.execPostSync('preQueryHandler', null, [{target, key, proxy, defaultFn}, result]);
      orm.execPostSync('proxyQueryHandler', null, [{target, key, proxy, defaultFn}, result]);
      if (result.ok) return result.value;

      return defaultFn;
    }
  })

  return mongoCollection;
}

async function resultPostProcess(result, target) {
  let _result = result;
  if (target.isCreateCmd) {
    _result = result.ops[0];
  }

  if (result && result.ok === 1 && result.value) {
    _result = result.value;
  }

  if (target.isDeleteCmd) {
    if (target.returnSingleDocument) {
      _result = result.message.documents[0];
    } else {
      _result = result.message.documents;
    }
  }
  if (target.isInsertManyCmd) {
    _result = result.ops;
  }

  if (_result === null) {
    return null;
  }

  if (result.result && result === _result) {
    return result.result;
  }

  /*if (_result === result) {
    debugger
    return _result;
  }*/

  if (target.returnSingleDocument) {
    const returnResult = {ok: false, value: null}

    await orm.execPostAsync('proxyResultPostProcess', null, [{target, result: _result}, returnResult]);
    if (returnResult.ok) {
      _result = returnResult.value;
    }
  } else {
    const returnResult = {ok: false, value: null}
    let docs = []
    for (const doc of _result) {
      await orm.execPostAsync('proxyResultPostProcess', null, [{target, result: doc}, returnResult]);
      if (returnResult.ok) {
        docs.push(returnResult.value);
      } else {
        docs.push(doc);
      }
    }
    _result = docs;
  }

  if (target.lean) return _result;

  function convertProxy(doc) {
    return new Proxy(doc, {
      get(target, key) {
        if (key === 'toJSON' || key === 'toObject') {
          return function () {
            return target;
          }
        }
        if (key === '_doc') {
          return target;
        }
        return target[key];
      }
    });
  }

  if (target.returnSingleDocument) {
    return convertProxy(_result);
  } else {
    return _result.map(doc => convertProxy(doc))
  }
}

function getCollection(collectionName, dbName) {
  if (orm.mode === 'single') {
    return models[collectionName];
  } else {
    let collection;
    collection = orm.cache.get(`model:${collectionName}@${dbName}`);
    if (!collection) {
      collection = models[`${collectionName}@${dbName}`]
    }
    return collection;
  }
}

function _getCollection(collectionName, dbName) {
  if (!orm.cache.get('client')) return;

  let db, collection;
  if (orm.mode === 'single') {
    db = orm.db;
    dbName = db.databaseName;
  } else {
    db = orm.cache.get(`db:${dbName}`);
    if (!db) {
      const client = orm.cache.get('client');
      db = client.db(dbName);
      orm.cache.set(`db:${dbName}`, db);
    }
  }

  collection = orm.cache.get(`collection:${collectionName}@${dbName}`)
  if (!collection) {
    collection = db.collection(pluralize(collectionName));
    orm.cache.set(`collection:${collectionName}@${dbName}`, collection);
  }

  return collection
}

/**
 * @param connectionInfo: {options, uri} || uri
 * example: connect('localhost:27017') || connect({uri: 'localhost:27017'})
 */
function connect(connectionInfo) {
  orm.connectionInfo = connectionInfo;
  let firstArgs = [];
  if (typeof connectionInfo === 'object') {
    firstArgs.push(connectionInfo.uri, connectionInfo.options);
  } else {
    firstArgs.push(connectionInfo)
  }
  let dbName, cb;
  if (arguments.length === 3) {
    dbName = arguments[1];
    cb = arguments[2];
  } else {
    cb = arguments[1];
  }
  orm.connectCb = cb;
  orm.connecting = true;
  MongoClient.connect(...firstArgs, async (err, client) => {
    if (!err) {
      orm.connecting = false;
      console.log('db connected');
      orm.cache.set('client', client);
      orm.cache.on("expired", function (key, value) {
        if (key === 'client') {
          orm.closed = true;
          client.close();
          console.log('db disconnected');
        }
      });
      if (dbName) {
        orm.db = client.db(dbName);
      }
      orm.connected = true;
      await orm.execPostAsync('connected', err);
    }
    if (cb) cb(err);
  });
}
orm.plugin(require('./collectionPlugin'));
orm.plugin(require('./schemaPlugin'));
module.exports = orm;

orm.execPostAsync = async function (name, context, args) {
  const posts = this._posts.get(name) || [];
  const numPosts = posts.length;

  for (let i = 0; i < numPosts; ++i) {
    await posts[i].fn.bind(context)(...(args || []));
  }
};
