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
        if (match.testCollection(collectionName) && match.testDb(dbName)) return true;
      }
    }).map(m => m.options);
    return _.merge({}, ...matches)
  }
}
