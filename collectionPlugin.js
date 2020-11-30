const ObjectID = require('bson').ObjectID;
const _ = require('lodash');
const traverse = require("traverse");
const {convertNameToTestFunction} = require("./utils");

module.exports = function (orm) {
  orm.collectionOptions = orm.collectionOptions || [];

  orm.registerCollectionOptions = function (collectionName, dbName, options) {
    if (orm.mode === 'single') {
      options = dbName;
      dbName = null;
    } else if (!options && orm.dbName) {
      [dbName, options] = [orm.dbName, dbName]
    }

    orm.collectionOptions.push({
      testCollection: convertNameToTestFunction(collectionName),
      options,
      ...(orm.mode !== 'single' && {
        testDb: convertNameToTestFunction(dbName)
      })
    })
  }

  orm.getOptions = function (collectionName, dbName) {
    let matches = orm.collectionOptions.filter(match => {
      if (orm.mode === 'single') {
        if (match.testCollection(collectionName)) return true
      } else {
        if (!dbName) {
          dbName = orm.dbName;
        }
        if (match.testCollection(collectionName) && match.testDb(dbName)) return true;
      }
    }).map(m => m.options);
    return _.merge({}, ...matches)
  }

  /*const _idIndexArr = [];
  orm.on('pre:execChain', async (query) => {
    if (_idIndexArr.includes(query.name)) return;
    _idIndexArr.push(query.name);
    let cursor = orm._getCollection(...query.name.split('@'));
    await cursor.createIndex('_id', {unique: true});
  })*/
}
