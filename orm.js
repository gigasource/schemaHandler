const EventEmitter = require('events');
const NodeCache = require('node-cache');
const Kareem = require('kareem');
const MongoClient = require('mongodb').MongoClient;
const _ = require('lodash');
const cache = new NodeCache({useClones: false, stdTTL: 20 * 60});
const orm = {
  cache,
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
  plugin(plugin) {
    plugin(orm);
  }
}
_.extend(orm, new Kareem());
const mquery = require('mquery');

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

let models = builder(function (resolve, reject) {
  const query = {name: this.modelName, chain: this.chain};
  const useNative = query.chain.reduce((result, {fn}) => {
    if (!result) {
      if (fn.includes('insert') || fn.includes('create')) result = true;
    }
    return result;
  }, false);
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
  const mongoCollection = new Proxy({collection: _collection, dbName: collectionName.split('@')[1]}, {
    get(target, key, proxy) {
      //target here is mongo db collection
      if (!target.cursor) target.cursor = target.collection;
      if (key === 'collectionName') {
        return target.collection._collection.collectionName;
      }

      if (key === 'lean') {
        return function () {
          console.log('lean: ignored')
          return proxy;
        }
      }

      if (key === 'then') {
        return async (resolve, reject) => {
          try {
            const result = await target.cursor;
            resolve(resultPostProcess(result));
          } catch (e) {
            reject(e);
          }
        }
      }

      const defaultFn = function () {
        console.log('fn : ', key);
        console.log(arguments);
        target.cursor = target.cursor[key](...arguments);
        return proxy;
      }

      const result = {ok: false, value: null};
      orm.execPostSync('proxyQueryHandler', null, [{target, key, proxy, defaultFn}, result]);
      if (result.ok) return result.value;

      return defaultFn;
    }
  })

  return mongoCollection;
}

function resultPostProcess(result) {
  if (result && result.ok === 1 && result.value) {
    return result.value;
  }
  return result;
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
  //todo: wait for client
  if (!orm.client) return;

  let db, collection;
  if (orm.mode === 'single') {
    db = orm.db;
    dbName = db.databaseName;
  } else {
    db = orm.cache.get(`db:${dbName}`);
    if (!db) {
      db = orm.client.db(dbName);
      orm.cache.set(`db:${dbName}`, db);
    }
  }

  collection = orm.cache.get(`collection:${collectionName}@${dbName}`)
  if (!collection) {
    collection = db.collection(collectionName);
    orm.cache.set(`collection:${collectionName}@${dbName}`, collection);
  }

  return collection
}

function connect(url) {
  let dbName, cb;
  if (arguments.length === 3) {
    dbName = arguments[1];
    cb = arguments[2];
  } else {
    cb = arguments[1];
  }
  MongoClient.connect(url, (err, client) => {
    orm.client = client;
    if (dbName) {
      orm.db = client.db(dbName);
    }
    cb();
  });
}

orm.plugin(require('./schemaPlugin'));
module.exports = orm;

