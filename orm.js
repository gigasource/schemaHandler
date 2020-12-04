const EventEmitter = require('./hooks/hooks');
const NodeCache = require('node-cache');
const Kareem = require('kareem');
const MongoClient = require('mongodb').MongoClient;
const _ = require('lodash');
const cache = new NodeCache({useClones: false/*, checkperiod: 2*/});
const ObjectID = require('bson').ObjectID;
const uuid = require("uuid").v1;
const error = require('combine-errors');

class Orm extends EventEmitter {
  constructor() {
    super();
    const {models, models2} = factory(this);
    this.models = models;
    this.models2 = models2

    this.plugin(require('./plugins/collectionPlugin'));
    this.plugin(require('./plugins/schemaPlugin'));
    this.plugin(require('./plugins/commitPlugin'));
    this.plugin(require('./plugins/transporter'));
    this.plugin(require('./plugins/fakeDocumentsPlugin'));
  }

  setTtl(ttl) {
    this.cache.options.stdTTL = ttl;
  }

  get readyState() {
    if (this.connected && !this.closed) return 1;
  }

  get client() {
    return this.cache.get('client');
  }

  get connection() {
    return this.cache.get('client');
  }

  useProxyForResult() {
    this._useProxyForResult = true;
  }

  async setDefaultDb(dbName) {
    this.dbName = dbName;
    await this.waitForConnected();
    this.db = this.client.db(dbName);
  }

  ObjectId = ObjectID
  cache = new NodeCache({useClones: false/*, checkperiod: 2*/})
  pluralize = true
  connecting = false
  connected = false
  closed = false
  mode = 'single'

  setSingleDbMode() {
    this.mode = 'single';
  }

  setMultiDbMode() {
    this.mode = 'multi';
  }

  getCollection = getCollection

  _getCollection = _getCollection

  connect = connect

  close() {
    this.client.close();
  }

  //mock
  registerSchema(collectionName, dbName, schema) {
  }

  //mock
  getSchema(collectionName, dbName) {
  }

  //mock
  registerCollectionOptions(collectionName, dbName, options) {
  }

  //mock
  getOptions(collectionName, dbName) {
  }

  plugin(plugin) {
    plugin(this);
  }

  use(module) {
    module(this);
  }

  waitForConnected() {
    if (!this.cache.get('client')) {
      if (!this.connected || this.closed || this.connecting) {
        return new Promise((resolve, reject) => {
          if (!this.connecting && this.connected && this.closed) {
            this.connect(this.connectionInfo, this.connectCb);
          }

          this.once('open', (err) => {
            if (err) return reject(err);
            resolve();
          })
        });
      }
    }
    return Promise.resolve();
  }

  execChain = execChain
  createCollectionQuery = createCollectionQuery
  resultPostProcess = resultPostProcess
}

/*function orm() {
  if (arguments.length === 0) {
    return orm;
  } else {
    return orm.getCollection(...arguments);
  }
}

for (const key of Object.keys(_orm)) {
  orm[key] = _orm[key];
}*/
//_.extend(orm, _orm);
const __orm = new Orm()
__orm.Orm = Orm;
//_.extend(__orm, new EventEmitter());

const _orm = new Proxy(Orm, {
  construct(target, args) {
    const orm = new target(...args);
    const orm2 = new Proxy(function () {
      },
      {
        apply(target, thisArg, argArray) {
          if (argArray.length === 0) {
            return orm;
          } else {
            return orm.getCollection(...argArray);
          }
        },
        get(target, p, receiver) {
          return Reflect.get(orm, p);
        },
        set(target, p, value, receiver) {
          return Reflect.set(orm, p, value);
        }
      })
    return orm2;
  },
  apply(target, thisArg, argArray) {
    if (argArray.length === 0) {
      return __orm;
    } else {
      return __orm.getCollection(...argArray);
    }
  },
  get(target, p, receiver) {
    return Reflect.get(__orm, p);
  },
  set(target, p, value, receiver) {
    return Reflect.set(__orm, p, value);
  }
});

const mquery = require('mquery');
const pluralize = require("mongoose-legacy-pluralize");

function factory(orm) {
  function builder(resolver) {
    return new Proxy({}, {
      get(target, key) {
        const construct = class Anonymous {
        }
        construct.modelName = key;
        return new Proxy(construct, {
          construct(target, args) {
            const returnResult = orm.emit('construct', {target, args});
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
      const query = {name: _this.modelName, chain: _this.chain, uuid: uuid()};
      await orm.waitForConnected();

      {
        let returnResult = await orm.emit('pre:execChain', query);
        if (returnResult.ok) return resolve(returnResult.value);
      }

      let returnResult = await orm.emit('debug', query);
      if (returnResult.ok) return resolve(returnResult.value);

      let cursor = orm.execChain(query);
      cursor.then(resolve, reject);
    };
  });

  let models2 = builder(function (_this) {
    return async function (resolve, reject) {
      const query = {name: _this.modelName, chain: _this.chain};
      resolve(query);
    };
  });

  return {models, models2};
}

function execChain(query) {
  let cursor = this.createCollectionQuery(query);
  for (const {fn, args} of query.chain) {
    cursor = cursor[fn](...args);
  }
  return cursor;
}

function createCollectionQuery(query) {
  const orm = this;
  const {name: collectionName, chain} = query;
  //const _mongoCollection = orm.db.collection(collectionName)
  //const _collection = mquery().collection(orm.collection1);

  const useNative = chain.reduce((result, {fn}) => {
    if (!result) {
      if (fn.includes('insert') || fn.includes('create')/* || fn === 'findById'*/
        || fn.includes('countDocuments') || fn.includes('aggregate')
        || fn.includes('Index') || fn.includes('indexes')
        || fn.includes('findAndModify') || fn.includes('drop')) result = true;
    }
    return result;
  }, false);

  let _collection;
  if (query.mockCollection) {
    _collection = this.models2[collectionName];
  } else {
    let _nativeCollection = orm._getCollection(...collectionName.split('@'));
    _collection = useNative ? _nativeCollection : mquery().collection(_nativeCollection);
  }
  const mongoCollection = new Proxy({
    collection: _collection,
    collectionName: collectionName.split('@')[0],
    dbName: collectionName.split('@')[1],
    isCreateCmd: false,
    lean: false,
    useNative,
    chain,
    query
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

            orm.emit('proxyPostQueryHandler', {target, proxy});

            const result = await target.cursor;
            if (query.mockCollection) {
              const exec = async function () {
                let _nativeCollection = orm._getCollection(...collectionName.split('@'));
                let cursor = useNative ? _nativeCollection : mquery().collection(_nativeCollection);
                const chain = result.chain;
                for (const {fn, args} of chain) {
                  cursor = cursor[fn](...args);
                }
                return (await orm.resultPostProcess((await cursor), target));

              }
              const r = await orm.emit(`proxyPreReturnValue:${query.uuid}`, result, target, exec);
              return resolve(r.value);
            }
            const returnValue = await orm.resultPostProcess(result, target);
            resolve(returnValue);
          } catch (e) {
            reject(error([e0, e]));
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

      orm.emit('preQueryHandler', {target, key, proxy, defaultFn});
      const result = orm.emit('proxyQueryHandler', {target, key, proxy, defaultFn});
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
    } else if (target.cmd === 'insertMany' || (target.cmd === 'create' && !target.returnSingleDocument)) {
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
    if (target.cmd === 'insertMany' || (target.cmd === 'create' && !target.returnSingleDocument)) {
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
    const returnResult = await this.emit('proxyResultPostProcess', {target, result: _result});
    if (returnResult.ok) {
      _result = returnResult.value;
    }
  } else {
    let docs = []

    try {
      for (const doc of _result) {
        const returnResult = await this.emit('proxyResultPostProcess', {target, result: doc});
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

  if (!this._useProxyForResult || target.lean) return _result;

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
  if (this.mode === 'single') {
    return this.models[collectionName];
  } else {
    if (!dbName && this.dbName) {
      dbName = this.dbName;
    }
    let collection;
    collection = this.cache.get(`model:${collectionName}@${dbName}`);
    if (!collection) {
      collection = this.models[`${collectionName}@${dbName}`]
    }
    return collection;
  }
}

function _getCollection(collectionName, dbName) {
  if (!this.cache.get('client')) return;

  let db, collection;
  if (this.mode === 'single') {
    db = this.db;
    dbName = db.databaseName;
  } else {
    if (!dbName && this.dbName) {
      dbName = this.dbName;
    }
    db = this.cache.get(`db:${dbName}`);
    if (!db) {
      const client = this.cache.get('client');
      db = client.db(dbName);
      this.cache.set(`db:${dbName}`, db);
    }
  }

  collection = this.cache.get(`collection:${collectionName}@${dbName}`)
  if (!collection) {
    collection = db.collection(pluralize(collectionName));
    this.cache.set(`collection:${collectionName}@${dbName}`, collection);
  }

  return collection
}

/**
 * @param connectionInfo: {options, uri} || uri
 * example: connect('localhost:27017') || connect({uri: 'localhost:27017'})
 */
function connect(connectionInfo) {
  const orm = this;
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
  } else if (typeof arguments[1] === 'function') {
    cb = arguments[1];
  } else if (typeof arguments[1] === 'string') {
    dbName = arguments[1]
  }
  orm.connectCb = cb;
  orm.connecting = true;
  if (dbName) {
    orm.dbName = dbName;
  }
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

module.exports = _orm;
