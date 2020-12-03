const ObjectID = require('bson').ObjectID;
const _ = require('lodash');
const traverse = require("traverse");
const {convertNameToTestFunction} = require("../utils");

const {parseCondition, parseSchema, convertSchemaToPaths, checkEqual} = require("../schemaHandler")

module.exports = function (orm) {
  const defaultSchema = convertSchemaToPaths({});
  orm.schemas = orm.schemas || [];

  orm.registerSchema = function (collectionName, dbName, schema) {
    if (orm.mode === 'single') {
      schema = dbName;
      dbName = null;
    } else {
      if (!schema && orm.dbName) {
        schema = dbName;
        dbName = orm.dbName;
      }
    }

    schema = convertSchemaToPaths(schema, collectionName);

    orm.schemas.push({
      testCollection: convertNameToTestFunction(collectionName),
      schema,
      ...(orm.mode !== 'single' && {
        testDb: convertNameToTestFunction(dbName)
      })
    })
    return orm.getCollection(collectionName, dbName);
  }
  orm.getSchema = function (collectionName, dbName) {
    let match = orm.schemas.find(match => {
      if (orm.mode === 'single') {
        if (match.testCollection(collectionName)) return true
      } else {
        if (!dbName && orm.dbName) {
          dbName = orm.dbName;
        }
        if (match.testCollection(collectionName) && match.testDb(dbName)) return true;
      }
    });
    if (match) return match.schema;
  }

  //parse condition
  orm.on('proxyQueryHandler', function ({target, key, proxy, defaultFn}) {
    const returnResult = this;
    if (returnResult.ok) return;
    if (key === 'remove') key = 'deleteMany'

    if (key.includes('One') || key === 'create' || key === 'findById' || key === 'count') target.returnSingleDocument = true;

    if (key === 'insertMany') {
      target.isInsertManyCmd = true;
      //todo: parseSchema
    }
    if (key === 'updateOne') key = 'findOneAndUpdate';
    if (key === 'countDocuments') key = 'count';

    if (key === 'findOneAndUpdate') {
      target.new = true;
    }

    if (key.includes('Update') || key.includes('Modify') || key.includes('create')
      || key.includes('update') || key.includes('insert') || key.includes('delete')
      || key.includes('remove')) {
      target.isMutateCmd = true;
    }

    if (key.includes('delete') || key === 'count') {
      if (key.includes('delete')) {
        target.isDeleteCmd = true;
      }
      if (key === 'count') {
        target.returnSingleDocument = true;
      }
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        const condition = args.shift();
        let schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const _parseCondition = parseCondition(schema, condition);
        target.condition = _parseCondition;
        args.unshift(_parseCondition);
        target.cursor = target.cursor[key](...args);
        return proxy;
      }
    } else if (key === 'findById') {
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        let objId = args.shift();
        if (typeof objId === 'string') {
          objId = new ObjectID(objId)
        }
        target.condition = {_id: objId};
        target.cursor = target.cursor['findOne']({_id: objId});
        return proxy;
      }
    } else if (key.includes('find') || key.includes('delete') || key === 'updateMany') {
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        const condition = args.shift();
        let schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const _parseCondition = parseCondition(schema, condition);
        target.condition = _parseCondition;
        if (key.includes('Update') || key.includes('Modify') || key === 'updateMany') {
          let updateValue = args.shift();
          let arrayFilters;
          if (args.length > 0 && args[0].arrayFilters) {
            arrayFilters = args[0].arrayFilters;
          }
          try {
            updateValue = parseCondition(schema, updateValue, {arrayFilters});
          } catch (e) {
            console.warn(e);
          }
          args.unshift(updateValue);
        }
        args.unshift(_parseCondition);
        try {
          target.cursor = target.cursor[key](...args);
        } catch (e) {
          console.error(e);
        }
        return proxy;
      }
    } else if (key === 'create') {
      target.isCreateCmd = true;
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const obj = args.shift();
        if (Array.isArray(obj)) {
          let objs = obj;
          objs = objs.map(obj => parseSchema(schema, obj));
          if (objs.length !== 0) {
            args.unshift(objs);
            target.cursor = target.cursor['insertMany'](...args);
          } else {
            target.ignore = true;
            target.returnValueWhenIgnore = [];
          }
        } else {
          args.unshift(parseSchema(schema, obj));
          target.cursor = target.cursor['insertOne'](...args);
        }
        return proxy;
      }
    } else if (key === 'insertOne') {
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        const obj = args.shift();
        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        args.unshift(parseSchema(schema, obj));
        return defaultFn(...args)
      }
    } else if (key === 'insertMany') {
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        let objs = args.shift();
        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        objs = objs.map(obj => parseSchema(schema, obj));
        if (objs.length !== 0) {
          args.unshift(objs);
          return defaultFn(...args)
        } else {
          target.ignore = true;
          target.returnValueWhenIgnore = [];
          return proxy;
        }
      }
    }
  })


  function checkMainCmd(key) {
    if (key.includes('find') || key.includes('create') || key.includes('update')
      || key.includes('insert') || key.includes('delete') || key.includes('remove')
      || key.includes('count') || key.includes('aggregate')
      || key.includes('indexes') || key.includes('Index')) return true;

    return false;
  }

  orm.on('proxyQueryHandler', function ({target, key, proxy, defaultFn}) {
    if (checkMainCmd(key)) {
      target.cmd = key;
    }
  })

  //populate
  orm.on('proxyQueryHandler', function ({target, key, proxy, defaultFn}, result) {
    if (this.ok) return;

    if (key === 'populate') {
      this.ok = true;
      this.value = function () {
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
  orm.on('proxyResultPostProcess', async function ({target, result}) {
    const returnResult = this;
    if (!result) return;
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
          let cursor = refCollection['findById'](_.get(result, _path));
          if (select !== true) {
            cursor = cursor.select(select)
          }
          const refDoc = await cursor.lean();
          _.set(result, _path, refDoc);
        }
        if (paths.length > 1) {
          let arrPath = [...path.split('.')]
          arrPath.pop();
          arrPath = arrPath.join('.');
          const arr = _.get(result, arrPath);
          _.set(result, arrPath, arr.filter(a => a !== null));
        }
      }

      returnResult.ok = true;
      returnResult.value = result;
    }
  })

  orm.on('proxyResultPostProcess', async function ({target, result}, returnResult) {
    let cmd = target.cmd;
    if ((!cmd.includes('find') || cmd.includes('Update')) && !cmd.includes('delete') && !cmd.includes('remove')) {
      await orm.emit(`update:${target.collectionName}${orm.mode === 'multi' ? '@' + target.dbName : ''}`, result, target);
      const type = cmd.includes('insert') || cmd.includes('create') ? 'c' : 'u';
      await orm.emit(`update:${target.collectionName}${orm.mode === 'multi' ? '@' + target.dbName : ''}:${type}`, result, target);
    } else if (cmd.includes('find')) {
      await orm.emit(`find:${target.collectionName}${orm.mode === 'multi' ? '@' + target.dbName : ''}`, result, target);
    } else {
      await orm.emit(`delete:${target.collectionName}${orm.mode === 'multi' ? '@' + target.dbName : ''}`, result, target);
    }
  })

  orm.on('proxyPostQueryHandler', function ({target, proxy}, result) {
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
  orm.on('proxyPostQueryHandler', function ({target, proxy}) {
    if (target.new) {
      proxy.setOptions({new: true});
    }
  })

  orm.on('construct', function ({target, args}) {
    let [collectionName, dbName] = target.modelName.split('@');
    const schema = orm.getSchema(collectionName, dbName);
    this.value = parseSchema(schema, args[0]);
  })
}