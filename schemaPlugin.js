const {parseCondition} = require("../schemaHandler");
const {convertSchemaToPaths} = require("../schemaHandler");

module.exports = function (orm) {
  const defaultSchema = convertSchemaToPaths({});
  orm.schemas = orm.schemas || {};
  orm.registerSchema = function (collectionName, dbName, schema) {
    if (orm.mode === 'single') {
      schema = dbName;
      orm.schemas[`schema:${collectionName}`] = convertSchemaToPaths(schema);
    } else {
      orm.schemas[`schema:${collectionName}@${dbName}`] = convertSchemaToPaths(schema);
    }
  }
  orm.getSchema = function (collectionName, dbName) {
    if (orm.mode === 'single') {
      return orm.schemas[`schema:${collectionName}`];
    } else {
      return orm.schemas[`schema:${collectionName}@${dbName}`];
    }
  }

  //parse condition
  orm.post('proxyQueryHandler', null, function ({target, key, proxy, defaultFn}, result) {
    if (result.ok) return;
    if (key.includes('find')) {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        const condition = args.shift();
        const schema = orm.getSchema(target.collection._collection.collectionName, target.dbName) || defaultSchema;
        args.unshift(parseCondition(schema, condition));
        return defaultFn(...args)
      }
    }
  })
}
