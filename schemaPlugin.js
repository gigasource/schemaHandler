const ObjectID = require('bson').ObjectID;
const _ = require('lodash');
const traverse = require('traverse');
const {convertNameToTestFunction, clearUndefined} = require('./utils');

const {parseCondition, parseSchema, convertSchemaToPaths, checkEqual} = require('./schemaHandler')

module.exports = function (orm) {
  const defaultSchema = convertSchemaToPaths({});
  orm.schemas = orm.schemas || [];
  orm.defaultSchema = defaultSchema;

  orm.registerSchema = function (collectionName, dbName, schema, isSchemaConverted = false) {
    if (orm.mode === 'single') {
      isSchemaConverted = schema
      schema = dbName;
      dbName = null;
    } else {
      if (!schema && orm.dbName) {
        schema = dbName;
        dbName = orm.dbName;
      }
    }

    if (!isSchemaConverted) {
      schema = convertSchemaToPaths(schema, collectionName);
    }

    orm.schemas.push({
      testCollection: convertNameToTestFunction(collectionName),
      schema,
      ...(orm.mode !== 'single' && {
        testDb: convertNameToTestFunction(dbName)
      })
    })
    orm.emit('schemaRegistered', collectionName, dbName, schema)
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
    if (match) return match.schema || defaultSchema;
  }

  //parse condition
  orm.on('proxyQueryHandler', function ({target, key, proxy, defaultFn}) {
    const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
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
      || key.includes('remove') || key.includes('replace')) {
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
        const _parseCondition = parseCondition(schema, condition);
        target.condition = _parseCondition;
        if (key.includes('Update') || key.includes('Modify') || key === 'updateMany') {
          let updateValue = args.shift();
          let arrayFilters = [];
          if (args.length > 0 && args[0].arrayFilters) {
            arrayFilters = args[0].arrayFilters;
          }
          try {
            updateValue = parseCondition(schema, updateValue, {arrayFilters});
          } catch (e) {
            console.warn(e);
          }
          updateValue = clearUndefined(updateValue);
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
        const obj = args.shift();
        if (Array.isArray(obj)) {
          target.returnSingleDocument = false;
          let objs = obj;
          objs = objs.map(obj => parseSchema(schema, obj)).map(clearUndefined);
          if (objs.length !== 0) {
            args.unshift(objs);
            target.cursor = target.cursor['insertMany'](...args);
          } else {
            target.ignore = true;
            target.returnValueWhenIgnore = [];
          }
        } else {
          let _obj = parseSchema(schema, obj);
          _obj = clearUndefined(_obj);
          args.unshift(_obj);
          target.cursor = target.cursor['insertOne'](...args);
        }
        return proxy;
      }
    } else if (key === 'insertOne') {
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        const obj = args.shift();
        args.unshift(clearUndefined(parseSchema(schema, obj)));
        return defaultFn(...args)
      }
    } else if (key === 'replaceOne') {
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        let condition = parseCondition(schema, args.shift());
        let obj = clearUndefined(parseSchema(schema, args.shift()))
        args.unshift(condition, obj);
        return defaultFn(...args)
      }
    } else if (key === 'insertMany') {
      returnResult.ok = true;
      returnResult.value = function () {
        const args = [...arguments];
        let objs = args.shift();
        objs = objs.map(obj => parseSchema(schema, obj)).map(clearUndefined);
        if (objs.length !== 0) {
          args.unshift(objs);
          return defaultFn(...args)
        } else {
          target.ignore = true;
          target.returnValueWhenIgnore = [];
          return proxy;
        }
      }
    } else if (key === 'bulkWrite') {
      returnResult.ok = true;
      //todo:
      returnResult.value = function () {
        const args = [...arguments];
        let commands = args[0];
        for (const command of commands) {
          if (command.hasOwnProperty('insertOne')) {
            const {document} = command['insertOne'];
            command['insertOne'].document = parseSchema(schema, document);
            //parse here
          } else if (command.hasOwnProperty('updateOne')) {
            const {filter, update, arrayFilters = []} = command['updateOne'];
            command['updateOne'].filter = parseCondition(schema, filter);
            command['updateOne'].update = parseCondition(schema, update, {arrayFilters});
          } else if (command.hasOwnProperty('updateMany')) {
            const {filter, update, arrayFilters = []} = command['updateMany'];
            command['updateMany'].filter = parseCondition(schema, filter);
            command['updateMany'].update = parseCondition(schema, update, {arrayFilters});
          } else if (command.hasOwnProperty('deleteOne')) {
            const {document} = command['deleteOne'];
            command['deleteOne'].document = parseCondition(schema, document);
          } else if (command.hasOwnProperty('deleteMany')) {
            const {filter} = command['deleteMany'];
            command['deleteMany'].filter = parseCondition(schema, filter);
          } else if (command.hasOwnProperty('replaceOne')) {
            const {filter, replacement} = command['replaceOne'];
            command['replaceOne'].filter = parseCondition(schema, filter);
            command['replaceOne'].replacement = parseSchema(schema, replacement);
          }
        }
        return defaultFn(...args);
      }
    }
  })


  function checkMainCmd(key) {
    if (key.includes('find') || key.includes('create') || key.includes('update')
      || key.includes('insert') || key.includes('delete') || key.includes('remove')
      || key.includes('count') || key.includes('aggregate') || key.includes('replace')
      || key.includes('indexes') || key.includes('Index') || key.includes('bulk')) return true;

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

  function isContiguousIntegers(a) {
    for (const x of a) if (isNaN(x)) return false
    a.sort((x, y) => (Number(x) - Number(y)))
    for (let i = 0; i < a.length; i++) {
      if (i !== Number(a[i])) return false
    }
    return true
  }

  //todo: optimize this function
  function genPaths(_path, obj) {
    _path = _path.split('.');
    const paths = [];
    traverse(obj).forEach(function (node) {
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
      if ((node instanceof ObjectID) || (node instanceof Buffer)) {
        return this.block();
      }
    })
    return paths;
  }

  //populate

  async function doPopulate(target, result) {
    if (target.populates) {
      for (const populate of target.populates) {

        const [arg1] = populate;
        let path, select;
        if (typeof arg1 === 'string') {
          [path, select] = populate;
        } else {
          ({path, select} = arg1);
        }

        const schema = orm.getSchema(target.collectionName, target.dbName) || defaultSchema;
        const refCollectionName = schema[path].$options.ref;
        const refCollection = orm.getCollection(refCollectionName, target.dbName);
        const ids = []
        const map = new Map()
        for (const doc of result) {
          const paths = genPaths(path, doc);
          for (const _path of paths) {
            if (ObjectID.isValid(_.get(doc, _path))) ids.push(_.get(doc, _path))
            else {
              //set null if not instance of ObjectID / can't populate
              _.set(doc, _path, null)
            }
          }
        }
        const cursor = refCollection['find']({_id: {$in: ids}})
        const docs = await cursor.lean()
        for (const doc of docs) {
          map.set(doc._id.toString(), doc)
        }
        for (const doc of result) {
          const paths = genPaths(path, doc);
          const pathsContainNullElementsInArray = new Set()
          for (const _path of paths) {
            if (ObjectID.isValid(_.get(doc, _path))) {
              let populatedValue = map.get(_.get(doc, _path).toString()) || null
              if (populatedValue && _.isString(select)) {
                const selectList = select.split(' ').filter(s => !s.startsWith('-'))
                const deselectList = select.split(' ').filter(s => s.startsWith('-')).map(s => s.slice(1))
                if (selectList.length) populatedValue = _.pick(populatedValue,  selectList)
                if (deselectList.length) populatedValue = _.omit(populatedValue, deselectList)
              }
              _.set(doc, _path, populatedValue)
            } else {
              const subPath = _path.split('.').slice(0, -1)
              if (_.isArray(_.get(doc, subPath.join('.')))) {
                pathsContainNullElementsInArray.add(subPath.join('.'))
              }
            }
          }
          for (const _path of pathsContainNullElementsInArray) {
            _.set(doc, _path, _.get(doc, _path).filter(a => a !== null))
          }
        }
      }
    }

    return result
  }

  orm.on('proxyResultPostProcess', async function ({target, result}) {
    const returnResult = this;
    if (returnResult.ok) return;
    if (target.returnSingleDocument) {
      if (!result) return
      if (result.ok && result.n) return
      returnResult.ok = true
      returnResult.value = (await doPopulate(target, [result]))[0]
    } else {
      if (result.length >= 1) {
        const firstResult = result[0]
        if (!firstResult) return
        if (firstResult.ok) return
      }
      returnResult.ok = true
      returnResult.value = await doPopulate(target, result)
    }
  })

  orm.on('proxyResultPostProcess', async function ({target, result}) {
    let cmd = target.cmd;
    for (const _result of (target.returnSingleDocument ? [result] : result)) {
      if ((!cmd.includes('find') || cmd.includes('Update')) && !cmd.includes('delete') && !cmd.includes('remove')) {
        await orm.emit(`update:${target.collectionName}`, _result, target);
        if (orm.mode === 'multi') await orm.emit(`update:${target.collectionName}@${target.dbName}`, _result, target);
        const type = cmd.includes('insert') || cmd.includes('create') ? 'c' : 'u';
        await orm.emit(`update:${target.collectionName}:${type}`, _result, target);
        if (orm.mode === 'multi') await orm.emit(`update:${target.collectionName}@${target.dbName}:${type}`, _result, target);
      } else if (cmd.includes('find')) {
        await orm.emit(`find:${target.collectionName}`, _result, target);
        if (orm.mode === 'multi') await orm.emit(`find:${target.collectionName}@${target.dbName}`, _result, target);
      } else {
        await orm.emit(`delete:${target.collectionName}`, _result, target);
        if (orm.mode === 'multi') await orm.emit(`delete:${target.collectionName}@${target.dbName}`, _result, target);
      }
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
    this.value._id = new ObjectID();
  })
}
