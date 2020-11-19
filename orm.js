const EventEmitter = require('events');
const NodeCache = require('node-cache');
const Kareem = require('kareem');
const MongoClient = require('mongodb').MongoClient;
const _ = require('lodash');
const cache = new NodeCache({useClones: false/*, checkperiod: 2*/});
const ObjectID = require('bson').ObjectID;
const orm = {
  setTtl(ttl) {
    this.cache.options.stdTTL = ttl;
  },
  get readyState() {
    if (this.connected && !this.closed) return 1;
  },
  get client() {
    return orm.cache.get('client');
  },
  get connection() {
    return orm.cache.get('client');
  },
  useProxyForResult() {
    this._useProxyForResult = true;
  },
  ObjectId: ObjectID,
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

      this.once('open', (err) => {
        if (err) return reject(err);
        resolve();
      })
    });
  },
  execChain
}

_.extend(orm, new Kareem());
_.extend(orm, new EventEmitter());

const mquery = require('mquery');
const pluralize = require("mongoose-legacy-pluralize");

function builder(resolver) {
  return new Proxy({}, {
    get(target, key) {
      const construct = class Anonymous {
      }
      construct.modelName = key;
      return new Proxy(construct, {
        construct(target, args) {
          const returnResult = {ok: false, value: null};
          orm.execPostSync('construct', null, [{target, args}, returnResult]);
          return returnResult.value;
        },
        get(targetLayer1, key) {
          if (['modelName'].includes(key)) {
            return targetLayer1[key];
          }
          return function () {
            return new Proxy({
              modelName: construct.modelName,
              chain: [{fn: key, args: [...arguments]}]
            }, {
              get(targetLayer2, key, queryProxy) {
                if (['chain', 'modelName'].includes(key)) {
                  return targetLayer2[key];
                }
                if (key === 'then') {
                  const promise = new Promise(resolver(targetLayer2));
                  return promise.then.bind(promise);
                }
                return function () {
                  targetLayer2.chain = targetLayer2.chain || [];
                  targetLayer2.chain.push({fn: key, args: [...arguments]});
                  return queryProxy;
                };
              }
            });
          };
        }
      });
    }
  });
}

let models = builder(function (_this) {
  return async function (resolve, reject) {
    const query = {name: _this.modelName, chain: _this.chain};
    if (!orm.cache.get('client')) {
      if (!orm.connected || orm.closed || orm.connecting) {
        await orm.waitForConnected();
      }
    }

    let returnResult = {ok: false, value: null};
    await orm.execPostAsync('debug', null, [query, returnResult]);
    if (returnResult.ok) return resolve(returnResult.value);

    let cursor = execChain(query);
    cursor.then(resolve, reject);
  };
});

function execChain(query) {
  let cursor = createCollectionQuery(query.name, query.chain);
  for (const {fn, args} of query.chain) {
    cursor = cursor[fn](...args);
  }
  return cursor;
}

function createCollectionQuery(collectionName, chain) {
  //const _mongoCollection = orm.db.collection(collectionName)
  //const _collection = mquery().collection(orm.collection1);

  const useNative = chain.reduce((result, {fn}) => {
    if (!result) {
      if (fn.includes('insert') || fn.includes('create')/* || fn === 'findById'*/
        || fn.includes('countDocuments') || fn.includes('aggregate')) result = true;
    }
    return result;
  }, false);

  let _nativeCollection = _getCollection(...collectionName.split('@'));
  const _collection = useNative ? _nativeCollection : mquery().collection(_nativeCollection);
  const mongoCollection = new Proxy({
    collection: _collection,
    collectionName: collectionName.split('@')[0],
    dbName: collectionName.split('@')[1],
    isCreateCmd: false,
    lean: false,
    useNative,
    chain
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
        const e0 = new Error();
        const promise = new Promise(async (resolve, reject) => {
          try {
            if (target.ignore) {
              return resolve(target.returnValueWhenIgnore);
            }

            let returnResult = {ok: false, value: null};
            orm.execPostSync('proxyPostQueryHandler', null, [{target, proxy}, returnResult]);

            const result = await target.cursor;
            const returnValue = await resultPostProcess(result, target);
            resolve(returnValue);
          } catch (e) {
            console.error(e0);
            reject(e);
          }
        })
        return promise.then.bind(promise);
      }

      let defaultFn = function () {
        //console.log('fn : ', key);
        //console.log(arguments);
        try {
          target.cursor = target.cursor[key](...arguments);
        } catch (e) {
          console.warn(e);
        }
        return proxy;
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
  if (target.ignore) return target.returnValueWhenIgnore;
  let _result;
  if (global.USE_MONGO_EMBEDDED) {
    _result = result;
    if (target.isDeleteCmd) {
      if (target.returnSingleDocument) {
        _result = result.result.message.documents[0];
      } else {
        _result = result.result.message.documents;
      }
    } else if (target.cmd === 'insertMany') {
      _result = result.ops;
    } else if (target.cmd === 'insertOne') {
      _result = result.ops[0];
    } else if (result && result.ok === 1 && result.value) {
      _result = result.value;
    } else if (_.get(result, 'result.message.documents')) {
      _result = _.get(result, 'result.message.documents');
    }
  } else {
    _result = result;
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

    if (target.cmd === 'insertOne') {
      _result = result.ops[0];
    }

    if (_result === null) {
      return null;
    }

    if (result.result && result === _result) {
      return result.result;
    }

    if (result.toArray) {
      _result = await _result.toArray();
    }
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
    let docs = []

    try {
      for (const doc of _result) {
        const returnResult = {ok: false, value: null}
        await orm.execPostAsync('proxyResultPostProcess', null, [{target, result: doc}, returnResult]);
        if (returnResult.ok) {
          docs.push(returnResult.value);
        } else {
          docs.push(doc);
        }
      }
    } catch (e) {
      console.warn(e);
    }

    _result = docs;
  }

  if (!orm._useProxyForResult || target.lean) return _result;

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
      orm.emit('open');
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
