const ObjectID = require('bson').ObjectID;
const _ = require('lodash');
const traverse = require("traverse");

const {parseCondition, parseSchema, convertSchemaToPaths, checkEqual} = require("../schemaHandler")

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

    if (key.includes('One') || key === 'create' || key === 'findById') target.returnSingleDocument = true;

    if (key === 'insertMany') {
      target.isInsertManyCmd = true;
      //todo: parseSchema
    }
    if (key === 'updateOne') key = 'findOneAndUpdate';

    if (key === 'findOneAndUpdate') {
      target.new = true;
    }

    if (key.includes('delete')) {
      target.isDeleteCmd = true;
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
    } else if (key.includes('find') || key.includes('delete') || key === 'updateMany') {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        const condition = args.shift();
        let schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const _parseCondition = parseCondition(schema, condition);
        if (key.includes('Update') || key.includes('Modify') || key === 'updateMany') {
          let updateValue = args.shift();
          updateValue = parseCondition(schema, updateValue);
          args.unshift(updateValue);
        }
        args.unshift(_parseCondition);
        target.cursor = target.cursor[key](...args);
        return proxy;
      }
    } else if (key === 'create' || key === 'insertOne') {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        const obj = args.shift();
        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        args.unshift(parseSchema(schema, obj));
        return defaultFn(...args)
      }
    } else if (key === 'insertMany') {
      result.ok = true;
      result.value = function () {
        const args = [...arguments];
        let objs = args.shift();
        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        objs = objs.map(obj => parseSchema(schema, obj));
        args.unshift(objs);
        return defaultFn(...args)
      }
    }
  })

  //populate
  orm.post('proxyQueryHandler', null, function ({target, key, proxy, defaultFn}, result) {
    if (result.ok) return;

    if (key === 'populate') {
      result.ok = true;
      result.value = function () {
        target.populates = target.populates || [];
        target.populates.push([...arguments]);
        return proxy;
      }
    }
  })

  function genPaths(_path, obj) {
    _path = _path.split('.');
    const paths = [];
    traverse(obj).map(function (node) {
      const {key, path, isRoot, parent, isLeaf} = this;
      if (checkEqual(_path, path)) {
        paths.push(path.join('.'));
      }
      if (_path.length > path.length) {
        const __path = _.take(_path, path.length);
        if (!checkEqual(__path, path)) {
          return this.block();
        }
      }
      if (node instanceof ObjectID) {
        return this.block();
      }
    })
    return paths;
  }

  //populate
  orm.post('proxyResultPostProcess', null, async function ({target, result}, returnResult) {
    if (returnResult.ok) return;
    if (result.n && result.ok) return;

    if (target.populates) {
      for (const populate of target.populates) {
        const [arg1] = populate;
        let path, select, deselect;
        if (typeof arg1 === 'string') {
          [path, select] = populate;
        } else {
          ({path, select} = arg1);
        }

        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const refCollectionName = schema[path].$options.ref;
        const refCollection = orm.getCollection(refCollectionName, target.dbName);
        const paths = genPaths(path, result);
        for (const _path of paths) {
          const refDoc = await refCollection['findById'](_.get(result, _path)).select(select).lean();
          if (refDoc) _.set(result, _path, refDoc);
        }
      }

      returnResult.ok = true;
      returnResult.value = result;
    }
  })

  orm.post('proxyPostQueryHandler', null, function ({target, proxy}, result) {
    const schema = orm.getSchema(target.collectionName, target.dbName);
    if (schema) {
      for (const path of Object.keys(schema)) {
        const {$options, $type} = schema[path];
        if ($options && $options.autopopulate) {
          proxy.populate(path, $options.autopopulate);
        }
      }
    }
  })

  //add new: true ??
  orm.post('proxyPostQueryHandler', null, function ({target, proxy}, result) {
    if (target.new) {
      proxy.setOptions({new: true});
    }
  })

}
