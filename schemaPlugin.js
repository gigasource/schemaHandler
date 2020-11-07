const ObjectID = require('bson').ObjectID;

const {parseCondition, parseSchema, convertSchemaToPaths} = require("../schemaHandler")

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
    if (key === 'remove') key = 'deleteMany'

    if (key.includes('delete')) {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        const condition = args.shift();
        let schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const _parseCondition = parseCondition(schema, condition);
        args.unshift(_parseCondition);
        target.cursor = target.cursor[key](...args);
        return proxy;
      }
    } else if (key === 'findById') {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        let objId = args.shift();
        if (typeof objId === 'string') {
          objId = new ObjectID(objId)
        }
        target.cursor = target.cursor['findOne']({_id: objId});
        return proxy;
      }
    } else if (key.includes('find') || key.includes('delete')) {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        const condition = args.shift();
        let schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const _parseCondition = parseCondition(schema, condition);
        if (key.includes('Update') || key.includes('Modify')) {
          let updateValue = args.shift();
          updateValue = parseCondition(schema, updateValue);
          args.unshift(updateValue);
        }
        args.unshift(_parseCondition);
        return defaultFn(...args)
      }
    } else if (key === 'create') {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        const obj = args.shift();
        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        args.unshift(parseSchema(schema, obj));
        return defaultFn(...args)
      }
    }
  })
}
