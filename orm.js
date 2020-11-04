const EventEmitter = require('events');
const orm = {}
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
  let cursor = createCollection(query.name);
  for (const {fn, args} of query.chain) {
    cursor = cursor[fn](...args);
  }
  cursor.then(resolve, reject);
});

function createCollection(collectionName) {
  //const _mongoCollection = orm.db.collection(collectionName)
  const _collection = mquery().collection(orm.collection1);
  const mongoCollection = new Proxy({collection: _collection}, {
    get(target, key, _proxy) {
      //target here is mongo db collection
      if (!target.cursor) target.cursor = target.collection;
      if (key === 'collectionName') {
        return target.collection._collection.collectionName;
      }

      if (key === 'lean') {
        return function () {
          console.log('lean: ignored')
          return _proxy;
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

      return function () {
        console.log('fn : ', key);
        console.log(arguments);
        target.cursor = target.cursor[key](...arguments);
        return _proxy;
      }
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


async function init() {
  const MongoClient = require('mongodb').MongoClient;

// Connection URL
  const url = 'mongodb://localhost:27017';

// Database Name
  const dbName = 'myproject';

// Use connect method to connect to the server
  MongoClient.connect(url, async function (err, client) {
    console.log("Connected successfully to server");
    const db = client.db(dbName);
    orm.client = client;
    orm.db = db;
    orm.collection1 = db.collection('model');
    await orm.collection1.deleteMany();
    await orm.collection1.insertMany([
      {a: 2, b: {c: 2, d: 4}}, {a: 3}, {a: 1}, {a: 4}
    ]);

    const Model = models['Model'];

    //const result = await Model.findOneAndUpdate({a: 1}, {$set: {b: 1}}, {new: true});
    const _model = await Model.findOne({$or: [{a: 1}, {a: 3}]}).sort({a: 1}).lean();
    //const _model2 = await Model.findOne({_id: _model._id});
    //console.log(result);
    console.log(_model)
    //console.log(_model2)
    client.close();
  });

}

init();
