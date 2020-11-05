const {parseCondition} = require("../schemaHandler");
const {convertSchemaToPaths} = require("../schemaHandler");

module.exports = function (orm) {
  orm.schemas = orm.schemas || {};
  orm.registerSchema = function (collectionName, dbName, schema) {
    if (orm.mode === 'single') {
      schema = dbName;
      orm.schemas[`schema:${collectionName}`] = schema;
    } else {
      orm.schemas[`schema:${collectionName}@${dbName}`] = schema;
    }
  }
  orm.getSchema = function (collectionName, dbName) {
    if (orm.mode === 'single') {
      return orm.schemas[`schema:${collectionName}`];
    } else {
      return orm.schemas[`schema:${collectionName}@${dbName}`];
    }
  }

  orm.post('proxyQueryHandler', null, function ({target, key, proxy}, result) {
    if (key.includes('find')) {

    }
  })
}
