const _ = require('lodash');
const {parseCondition, parseSchema} = require("../schemaHandler");
const uuid = require('uuid').v1;
const jsonFn = require('json-fn');
const dayjs = require('dayjs')
const {ObjectID} = require('bson')
const bulkUtils = require('./sync-bulk-utils')
const { Query } = require('mingo')
const replaceMasterUtils = require('./sync-utils/replace-master')
const storeOldCommits = require('./sync-utils/store-old-commits')
const {handleExtraProps} = require('./sync-handle-extra-props');
const AwaitLock = require('await-lock').default
const { EVENT_CONSTANT } = require('./sync-log')

const syncPlugin = function (orm) {
  const whitelist = []
  const unwantedCol = []
  const neverFakeCol = []
  let highestCommitIdOfCollection = null
  const shorthand = {
    'createMany': 'cm',
    'create': 'c',
    'insertMany': 'im',
    'insert': 'i',
    'insertOne': 'io',
    'updateOne': 'uo',
    'update': 'u',
    'updateMany': 'um',
    'remove': 'r',
    'removeOne': 'ro',
    'deleteMany': 'dm',
    'delete': 'd',
    'deleteOne': 'do',
    'findOneAndUpdate': 'foau',
    'replaceOne': 'ro1',
    'bulkWrite': 'bw'
  }
  const createQuery = Object.keys(shorthand).filter(key => key.includes('create') || key.includes('insert')).map(key => shorthand[key])

  orm.shorthand = shorthand
  orm.createQuery = createQuery
  orm.handleFindQuery = handleFindQuery
  orm.setHighestCommitIdOfCollection = setHighestCommitIdOfCollection
  orm.registerCommitBaseCollection = registerCommitBaseCollection
  orm.getCommitData = getCommitData
  orm.getWhiteList = getWhiteList
  orm.setExpireAfterNumberOfId = setExpireAfterNumberOfId
  orm.validateCommit = validateCommit
  orm.validateCommits = validateCommits
  orm.getUnwantedCol = getUnwantedCol
  orm.addUnwantedCol = addUnwantedCol
  orm.lockSync = lockSync
  orm.releaseSync = releaseSync
  orm.updateHighestId = updateHighestId
  orm.registerNeverFakeCol = registerNeverFakeCol

  orm('Commit').createIndex({ id: 1 }).then(r => r)
  orm('Commit').createIndex({ collectionName: 1 }).then(r => r)
  orm('Commit').createIndex({ ref: 1 }).then(r => r)

  bulkUtils(orm)
  replaceMasterUtils(orm)
  storeOldCommits(orm)

  function setHighestCommitIdOfCollection(col, val) {
    highestCommitIdOfCollection[col] = val
  }
  const unsavedList = []

  function getWhiteList() {
    return whitelist
  }

  function getUnwantedCol() {
    return unwantedCol
  }

  function addUnwantedCol(cols) {
    unwantedCol.push(...cols)
  }

  function setExpireAfterNumberOfId(numberOfId) {
    orm.onQueue('commit:handler:finish', async (commit) => {
      if (orm.mode !== 'multi' && !orm.isMaster()) {
        await orm('Commit').deleteMany({id: { $lt: commit.id - numberOfId }})
      }
    })
  }

  function registerCommitBaseCollection () {
    whitelist.push(...arguments);
    orm.emit('whiteListRegistered', arguments)
    // register for bulk write (only work for client)
    for (let col of whitelist) {
      orm.on(`commit:handler:shouldNotExecCommand:${col}`, 99999, async function (commit) { // this hook is always the last to be called
        if (orm.isMaster()) {
          if (!this._value)
            this.setValue(false)
          return
        }
        if (!highestCommitIdOfCollection) {
          const commitData = await orm('CommitData').findOne()
          highestCommitIdOfCollection =
            commitData && commitData.highestCommitIdOfCollection ? commitData.highestCommitIdOfCollection : {}
        }
        if (highestCommitIdOfCollection[col] && commit.id <= highestCommitIdOfCollection[col])
          this.setValue(true)
        else
        if (!this._value)
          this._value = false
      })
    }
  }

  // delete after exec chain
  orm.registerUnsavedCollection = function () {
    unsavedList.push(...arguments);
  }

  orm.on('reset-session', async function () {
    await orm('CommitData').updateOne({}, { sessionId: uuid() }, { upsert: true })
  })

  orm.on('commit:handler:postProcess', async commit => {
    if (unsavedList.includes(commit.collectionName))
      await orm('Commit').deleteOne({ _id: commit._id })
  })

  handleExtraProps(orm);

  orm.on('pre:execChain', -2, function (query) {
    const last = _.last(query.chain);
    if (last.fn === "batch") {
      query.chain.pop();
      this.stop();
      query.mockCollection = true;
      orm.once(`proxyPreReturnValue:${query.uuid}`, -999, async function (_query, target, exec) {
        const {fn, args} = _query.chain[0];
        let value;
        if (fn === 'insertOne') {
          value = {insertOne: {document: args[0]}}
        } else if (fn === 'findOneAndUpdate' || fn === 'updateOne') {
          value = {
            updateOne: {
              "filter": args[0],
              "update": args[1],
              ... args[2] && args[2]
            }
          }
        } else if (fn === 'updateMany') {
          value = {
            updateMany: {
              "filter": args[0],
              "update": args[1],
              ... args[2] && args[2]
            }
          }
        } else if (fn === 'deleteOne') {
          value = {deleteOne: {filter: args[0]}}
        } else if (fn === 'deleteMany') {
          value = {deleteMany: {filter: args[0]}}
        } else if (fn === 'replaceOne') {
          value = {
            replaceOne: {
              "filter": args[0],
              "replacement": args[1],
              ... args[2] && args[2]
            }
          }
        }
        this.value = value;
      })
    }
  })

  orm.on('pre:execChain', -1, function (query) {
    const last = _.last(query.chain);
    if (last.fn === "raw") {
      query.chain.pop();
      this.ok = true;
      this.value = query;
    } else if (last.fn === "direct") {
      query.chain.pop();
      this.stop();
    } else if (query.chain.find(c => c.fn === 'commit')) {
      if (query.chain[0].fn.includes('update') || query.chain[0].fn.includes('Update')) {
        if (!query.chain[0].args[1].$inc) {
          query.chain[0].args[1].$inc = { __c: 1 }
        } else {
          query.chain[0].args[1].$inc.__c = 1
        }
      }
      if (query.chain[0].fn.includes('delete') || query.chain[0].fn.includes('remove')) {
        if (!query.chain[0].args || query.chain[0].args.length === 0)
          query.chain[0].args = [{}]
      }
    } else {
      if (whitelist.includes(query.name)) {
        const cmds = ['update', 'Update', 'create', 'insert', 'remove', 'delete', 'bulkWrite', 'replace', 'Replace']
        const findCmds = ['find', 'aggregate']
        let mutateCmd = false;
        let findCmd = false;
        query.chain.forEach(({fn}) => {
          for (const cmd of cmds) {
            if (fn.includes(cmd)) {
              mutateCmd = true;
              break
            }
          }
          for (const cmd of findCmds) {
            if (fn.includes(cmd)) {
              findCmd = true;
              break;
            }
          }
        })
        if (mutateCmd) {
          if (query.chain[0].fn.includes('update') || query.chain[0].fn.includes('Update')) {
            if (!query.chain[0].args[1].$inc) {
              query.chain[0].args[1].$inc = { __c: 1 }
            } else {
              query.chain[0].args[1].$inc.__c = 1
            }
          }
          if (query.chain[0].fn.includes('delete') || query.chain[0].fn.includes('remove')) {
            if (!query.chain[0].args || query.chain[0].args.length === 0)
              query.chain[0].args = [{}]
          }
          query.chain.push({fn: 'commit', args: []})
        }
        if (findCmd && !orm.isMaster()) {
          orm.once(`proxyMutateResult:${query.uuid}`, async function (_query, result) {
            await orm.handleFindQuery(_query, result)
          })
        }
      }
    }
  })

  async function handleSkipQuery(_query, query, result) {
    _.remove(_query.chain, ops => {
      return ops.fn === 'skip'
    })
    // chain includes skip
    let _r = null // result for redundant docs
    if (_query.chain.length < query.chain.length) {
      let cursor = orm(query.name)
      const numberOfFakeDocs = await orm(_query.name).count() // expect this number to be small
      for (let i = 0; i < query.chain.length; i++) {
        if (query.chain[i].fn === 'skip') {
          _r = parseInt(query.chain[i].args[0]) - (Math.max(0, parseInt(query.chain[i].args[0]) - numberOfFakeDocs))
          cursor = cursor[query.chain[i].fn](Math.max(0, parseInt(query.chain[i].args[0]) - numberOfFakeDocs))
        } else if (query.chain[i].fn === 'limit') {
          cursor = cursor[query.chain[i].fn](Math.max(0, parseInt(query.chain[i].args[0]) + numberOfFakeDocs))
        } else {
          cursor = cursor[query.chain[i].fn](...query.chain[i].args)
        }
      }
      cursor = cursor.direct()
      result.value = await cursor
    }
    return _r
  }

  async function handleFindQuery(query, result) {
    try {
      const _query = _.cloneDeep(query)
      if (_query.chain[0].fn.includes('AndUpdate')) {
        _query.chain[0].fn = _query.chain[0].fn.slice(0, -9)
      }
      _query.name = 'Recovery' + _query.name
      _query.uuid = uuid()
      const nRedundant = await handleSkipQuery(_query, query, result)
      delete _query.mockCollection
      let _result = await orm.execChain(_query)
      const ids = Array.isArray(result.value) ? result.value.map(doc => doc._id) : [result.value ? result.value._id : null]
      // this is docs in fake collection which can't be found with query's condition
      const _resultWithId = await orm(_query.name).find({ _id: { $in: ids } })
      _.remove(_resultWithId, doc => {
        return Array.isArray(_result) ? !!_result.find(_doc => _doc._id.toString() === doc._id.toString()) : (_result && _result._id.toString() === doc._id.toString())
      })
      if (Array.isArray(result.value)) {
        const listIds = {}
        for (let id in result.value) {
          listIds[result.value[id]._id] = id
        }
        const deletedDocs = []
        for (let doc of _result) {
          if (doc._deleted) {
            deletedDocs.push(doc._id.toString())
            continue
          }
          if (listIds[doc._id]) {
            Object.assign(result.value[listIds[doc._id]], doc)
          } else {
            result.value.push(doc)
          }
        }
        _.remove(result.value, doc => {
          return deletedDocs.includes(doc._id.toString()) || !!_resultWithId.find(_doc => doc._id.toString() === _doc._id.toString())
        })
        if (query.chain.length > 1) {
          const mingoQuery = new Query({})
          let cursor = mingoQuery.find(result.value)
          for (let i = 1; i < query.chain.length; i++) {
            if (query.chain[i].fn === 'skip' && nRedundant !== null) {
              cursor[query.chain[i].fn](nRedundant)
            } else {
              cursor[query.chain[i].fn](...query.chain[i].args)
            }
          }
          result.value = cursor.all()
        }
      } else {
        // case findOne
        if (_resultWithId.length) {
          // if user want to use findOne, the found doc can have different field in fake collection
          // these codes are to check whether the found doc is match with the condition or we have
          // to find a new doc which match the condition
          if (_result && _result._id.toString() !== _resultWithId[0]._id.toString()) {
            const mingoQuery = new Query(...query.chain[0].args)
            let cursor = mingoQuery.find(_resultWithId)
            const finalResultWithId = cursor.all()
            if (finalResultWithId.length)
              _result = finalResultWithId[0]
            else {
              let resultWithoutDeleted = await orm(_query.name).findOne({ _deleted: { $exists: false}, ...query.chain[0].args[0] })
              if (resultWithoutDeleted)
                _result = resultWithoutDeleted
              else
                _result = null
            }
          }
        } else {
          let resultWithoutDeleted = await orm(_query.name).findOne({ _deleted: { $exists: false}, ...query.chain[0].args[0] })
          // replace deleted result with new result
          if (resultWithoutDeleted && _result && _result._deleted) {
            _result = resultWithoutDeleted
          }
        }
        if (_result) {
          if (!result.value)
            result.value = {}
          if (_result._deleted) {
            Object.assign(result, { value: null })
          } else if (_result._id && result.value._id && result.value._id.toString() !== _result._id.toString()) {
            result.value = _result
          } else {
            Object.assign(result.value, _result)
          }
        } else if (_resultWithId.length) {
          result.value = null
        }
      }
    } catch (e) {
      console.log('Handle find error', e.message)
    }
  }

  orm.on('commit:auto-assign', function (commit, _query, target) {
    if (target.cmd === "create" || target.cmd === "insertOne") {
      const schema = orm.getSchema(target.collectionName, target.dbName) || orm.defaultSchema;
      _query.chain["0"].args["0"] = parseSchema(schema, _query.chain["0"].args["0"]);
    }
  })

  orm.on('pre:execChain', async function (query) {
    const last = _.last(query.chain);
    if (last.fn === "commit") {
      query.chain.pop();
      query.mockCollection = true;
      let _chain = [...query.chain];
      const {args} = last;
      const commit = {
        collectionName: query.name.split('@')[0],
        ...query.name.split('@')[1] && {
          dbName: query.name.split('@')[1]
        },
        tags: args.filter(arg => typeof arg === "string"),
        data: _.assign({}, ...args.filter(arg => typeof arg === "object"))
      };

      orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
        commit._id = new ObjectID()
        commit.condition = target.condition ? jsonFn.stringify(target.condition) : null;
        orm.emit(`commit:auto-assign`, commit, _query, target);
        orm.emit(`commit:auto-assign:${_query.name}`, commit, _query, target);
        commit.chain = jsonFn.stringify(_query.chain);
        if (_.get(_query, "chain[0].args[0]._id")) {
          commit.data.docId = _.get(_query, "chain[0].args[0]._id");
        }
        commit._c = shorthand[target.cmd] ? shorthand[target.cmd] : null
        // put processCommit here
        const {value: value} = await orm.emit('commit:flow:execCommit', _query, target, exec, commit);
        this.value = value;
      });
    }
  });

  function getQuery(commit) {
    const chain = jsonFn.parse(commit.chain || '[]');
    let name = commit.collectionName;
    return {name, chain}
  }

  orm.getQuery = getQuery;

  orm.on('initFakeLayer', function () {
    //todo: fake layer
    // this is only for single mode
    orm.on('whiteListRegistered', whiteList => {
      for (const col of whiteList) {
        const schema = orm.getSchema(col)
        if (schema)
          orm.registerSchema('Recovery' + col, schema, true)
      }
    })
    orm.on('schemaRegistered', (collectionName, dbName, schema) => {
      if (!whitelist.includes(collectionName)) return
      const _schema = orm.getSchema('Recovery' + collectionName)
      if (!_schema)
        orm.registerSchema('Recovery' + collectionName, schema, true)
    })

    orm.onQueue("commit:build-fake", 'fake-channel', async function (query, target, commit) {
      if (!commit.chain || neverFakeCol.includes(commit.collectionName)) return;
      orm.writeSyncLog(EVENT_CONSTANT.BUILD_FAKE, commit._id)
      const isDeleteCmd = target.cmd.includes('delete') || target.cmd.includes('remove')
      const fakeCollectionName = 'Recovery' + commit.collectionName
      const _query = orm.getQuery(commit)
      _query.name = fakeCollectionName
      const exec = async () => await orm.execChain(_query)
      const currentDate = new Date()
      if (target.condition) {
        const docs = await orm(commit.collectionName).find(target.condition).direct().noEffect()
        for (let doc of docs) {
          const _doc = await orm(fakeCollectionName).findOne({ _id: doc._id })
          if (!_doc) {
            doc._fakeDate = currentDate
            doc._fakeId = commit._fakeId
            if (isDeleteCmd) doc._deleted = true
            await orm(fakeCollectionName).create(doc)
          } else {
            await orm(fakeCollectionName).updateOne({ _id: doc._id }, {
              _fakeDate: currentDate,
              ...isDeleteCmd && {
                _deleted: true
              }
            })
          }
        }
        try {
          if (!isDeleteCmd) {
            const value = await exec()
            if (query.chain[0].args.length === 3 && query.chain[0].args[2].upsert && value._id) {
              value._fakeDate = currentDate
              value._fakeId = commit._fakeId
              await orm(fakeCollectionName).updateOne({ _id: value._id }, { $set: { _fakeDate: currentDate, _fakeId: commit._fakeId } })
            }
            this.update('value', value)
          } else {
            const fakeDocs = await orm(fakeCollectionName).find(target.condition)
            for (let doc of fakeDocs) {
              await orm(fakeCollectionName).updateOne({ _id: doc._id }, {
                _fakeDate: currentDate,
                _deleted: true
              })
            }
          }
        } catch (e) {
          await orm.emit('commit:report:errorExec', null, e.message, true)
        }
      } else {
        try {
          if (Array.isArray(query.chain[0].args[0])) {
            const _idList = query.chain[0].args[0].map(doc => doc._id).filter(_id => !!_id)
            await orm(fakeCollectionName).deleteMany({ _id: { $in: _idList }, _deleted: true })
          } else {
            const _id = query.chain[0].args[0]._id
            if (_id)
              await orm(fakeCollectionName).deleteOne({ _id, _deleted: true })
          }
          const result = await exec()
          if (Array.isArray(result)) {
            for (let doc of result) {
              await orm(fakeCollectionName).updateOne({ _id: doc._id }, { _fakeDate: currentDate, _fakeId: commit._fakeId })
            }
          } else {
            await orm(fakeCollectionName).updateOne({ _id: result._id }, { _fakeDate: currentDate, _fakeId: commit._fakeId })
          }
          if (target.cmd === 'bulkWrite')
            await orm.handleFakeBulkWrite(commit.collectionName, commit._fakeId)
          this.update('value', result)
        } catch (e) {
          if (target.cmd === 'bulkWrite')
            await orm.handleFakeBulkWrite(commit.collectionName, commit._fakeId)
          this.update('value', null)
          await orm.emit('commit:report:errorExec', null, e.message, true)
        }

      }
    });

    const mustRecoverOperation = ['$push', '$pull']

    orm.on("commit:update-fake", async function (commit) {
      try {
        const { value: commitDataId } = await orm.emit('getCommitDataId')
        if (!commit.chain && commit.fromClient && commit.fromClient.toString() === commitDataId.toString()) { // case doNo commit
          await removeFakeOfCollection(commit.collectionName, { _fakeId: { $lte: commit._fakeId } }) // remove all doc with id smaller than this commit's id
          return
        }
        const query = orm.getQuery(commit)
        const fakeCollectionName = 'Recovery' + commit.collectionName
        // return if query is create or insert
        if (query.chain && (query.chain[0].fn.includes('create') || query.chain[0].fn.includes('insert'))) {
          if (Array.isArray(query.chain[0].args[0])) {
            const _idList = query.chain[0].args[0].map(doc => doc._id).filter(_id => !!_id)
            await orm(fakeCollectionName).deleteMany({ _id: { $in: _idList }, _deleted: true })
          } else {
            const _id = query.chain[0].args[0]._id
            if (_id)
              await orm(fakeCollectionName).deleteOne({ _id, _deleted: true })
          }
          return
        }
        // check whether query is delete
        if ((!commit.condition || commit.condition === 'null') &&
          !(query.chain && (query.chain[0].fn.includes('delete') || query.chain[0].fn.includes('bulk'))))
          return
        let _parseCondition = commit.condition ? jsonFn.parse(commit.condition) : {}
        let hasMustRecoverOp = false
        for (let op of mustRecoverOperation) {
          if (commit.chain && commit.chain.includes(op)) {
            hasMustRecoverOp = true
            break
          }
        }
        if (query.chain[0].fn.includes('bulk')) {
          hasMustRecoverOp = true
          _parseCondition = orm.emit('handleBulkFake', query.chain[0].args[0])
          if (!_parseCondition) _parseCondition = {}
        }
        if (commit.fromClient && commitDataId.toString() === commit.fromClient.toString()) {
          if (query.chain[0].fn.includes('bulk')) {
            _parseCondition.$or.push({ _fakeId: commit._fakeId })
          } else {
            if (hasMustRecoverOp) {
              _parseCondition._fakeId = { $gt: commit._fakeId }
            }
            query.chain[0].args[0]._fakeId = { $gt: commit._fakeId }
          }
        }
        if (hasMustRecoverOp) {
          await removeFakeOfCollection(commit.collectionName, _parseCondition)
          return
        }
        query.name = fakeCollectionName
        if (commit.dbName) query.name += `@${commit.dbName}`
        let result = null
        try {
          result = await orm.execChain(query)
        } catch (e) {
          await removeFakeOfCollection(commit.collectionName, _parseCondition)
        }
        this.value = result
      } catch (e) {}
    });

    async function removeFakeOfCollection(col, condition) {
      await orm('Recovery' + col).deleteMany(condition)
    }

    orm.removeFakeOfCollection = removeFakeOfCollection

    let removeFakeInterval = null
    orm.setRemoveFakeInterval = function (intervalTime) {
      if (removeFakeInterval) return
      const removeFakeIntervalFn = async function () {
        if (orm.isMaster()) {
          clearInterval(removeFakeInterval)
          return
        }
        const clearDate = dayjs().subtract(3, 'hour').toDate()
        for (let col of whitelist) {
          await orm('Recovery' + col).deleteMany({
            $or: [{
              _fakeDate: {
                '$lte': clearDate
              }
            }, {
              _fakeDate: {
                $exists: false
              }
            }]
          })
        }
      }
      removeFakeInterval = setInterval(removeFakeIntervalFn, intervalTime) //3 hours
      removeFakeIntervalFn().then(r => r)
    }

    orm.on('commit:remove-all-recovery', 'fake-channel', async function () {
      for (let col of whitelist) {
        await orm('Recovery' + col).remove({})
      }
    })
  })

  //should transparent
  // orm.on(`transport:sync`, async function () {
  //   const {value: highestId} = await orm.emit('getHighestCommitId');
  //   orm.emit('transport:require-sync', highestId);
  // });
  orm.on('getHighestCommitId', async function (dbName) {
    let highestCommitId
    const commitData = await orm('CommitData', dbName).findOne({})
    if (!commitData || !commitData.highestCommitId) {
      const commitWithHighestId = await orm('Commit', dbName).find({}).sort('-id').limit(1)
      highestCommitId = (commitWithHighestId.length ? commitWithHighestId[0] : { id: 0 }).id;
    }
    else
      highestCommitId = commitData.highestCommitId
    this.value = highestCommitId;
  })

  async function getCommitData(dbName) {
    return await orm('CommitData', dbName).findOne({})
  }

  let COMMIT_BULK_WRITE_THRESHOLD = 100
  orm.on('commit:setBulkWriteThreshold', threshold => {
    COMMIT_BULK_WRITE_THRESHOLD = threshold
  })

  orm.onQueue('transport:requireSync:callback', async function (commits) {
    if (!commits || !commits.length) return
    const _idsList = commits.map(commit => commit._id)
    orm.writeSyncLog(EVENT_CONSTANT.REQUIRE_SYNC, _idsList)
    const archivedCommits = _.remove(commits, commit => commit.data && !!commit.data.__arc)
    if (commits.length > COMMIT_BULK_WRITE_THRESHOLD) {
      await validateCommits(commits)
      if (!commits.length)
        return
      await orm.doCreateBulk(commits)
    } else {
      try {
        for (const commit of commits) {
          //replace behaviour here
          await orm.emit('createCommit', commit)
        }
      } catch (err) {
        console.log('Error in hook transport:requireSync:callback')
      }
    }
    if (archivedCommits) {
      await orm.emit('commit:archive:bulk', archivedCommits)
    }
    orm.emit('commit:handler:doneAllCommits')
    console.log('Done requireSync', commits.length, archivedCommits.length, commits.length ? commits[0]._id : archivedCommits[0]._id, new Date())
  })

  function registerNeverFakeCol(cols) {
    neverFakeCol.push(...cols)
  }

  let highestIdInMemory = null
  function updateHighestId(newHighestId) {
    if (!newHighestId || isNaN(newHighestId))
      return
    if (!highestIdInMemory)
      highestIdInMemory = newHighestId
    else
      highestIdInMemory = Math.max(highestIdInMemory, newHighestId)
  }

  const VALIDATE_STATUS = {
    BEHIND_MASTER: 'behind-master',
    AHEAD_MASTER: 'ahead-master',
    EQUAL_MASTER: 'equal-master',
    NULL: null
  }
  async function validateCommits(commits) {
    let lastAhead = -1
    for (let i = 0; i < commits.length; i++) {
      const status = await validateCommit(commits[i])
      if (status === VALIDATE_STATUS.AHEAD_MASTER) {
        lastAhead = i
      } else if (status === VALIDATE_STATUS.BEHIND_MASTER) {
        break
      }
    }
    if (lastAhead !== -1) {
      _.remove(commits, (item, i) => i <= lastAhead)
    }
  }
  async function validateCommit(commit) {
    try {
      if (!commit.condition && commit._c !== 'bw') {
        return VALIDATE_STATUS.NULL
      }
      if (commit._c === 'bw') {
        // validate bulk
        await orm.validateBulkQueries(commit, orm.isMaster())
      } else {
        if (orm.isMaster()) {
          const condition = jsonFn.parse(commit.condition)
          const sumObj = (await orm(commit.collectionName).aggregate([{ $match: condition }, { $group: { _id: null, sum: { '$sum': '$__c' } } }]))
          if (sumObj && sumObj.length)
            commit.__c = sumObj[0].sum
        } else {
          const condition = jsonFn.parse(commit.condition)
          const sumObj = await orm(commit.collectionName).aggregate([{ $match: condition }, { $group: { _id: null, sum: { '$sum': '$__c' } } }]).direct()
          if ((!sumObj || !sumObj.length) && commit.__c !== undefined) {
            orm.emit('commit:report:validationFailed', commit, null)
            return VALIDATE_STATUS.BEHIND_MASTER
          } else if (sumObj.length && commit.__c !== sumObj[0].sum) {
            orm.emit('commit:report:validationFailed', commit, sumObj[0].sum)
            return commit.__c < sumObj[0].sum ? VALIDATE_STATUS.AHEAD_MASTER : VALIDATE_STATUS.BEHIND_MASTER
          }
        }
      }
      return true
    } catch (err) {
      console.log('Error while validating', err)
    }
  }

  const lock = new AwaitLock()
  function lockSync() {
    lock.tryAcquire()
  }

  function releaseSync() {
    lock.acquired && lock.release()
  }

  //customize
  orm.onQueue('createCommit', async function (commit) {
    if (lock.acquired)
      return
    orm.writeSyncLog(orm.isMaster() ? EVENT_CONSTANT.CREATE_COMMIT : EVENT_CONSTANT.CREATE_COMMIT_CLIENT, commit._id)
    if (!commit.id) {
      let { value: highestId } = await orm.emit('getHighestCommitId', commit.dbName);
      if (highestIdInMemory)
        if (highestId !== highestIdInMemory) {
          await orm.emit('commit:report:errorId', highestId, highestIdInMemory)
          highestId = Math.max(highestIdInMemory, highestId)
        }
      commit.id = highestId + 1;
    } else {
      // commit with id smaller than highestId has been already created
      const { value: highestId } = await orm.emit('getHighestCommitId', commit.dbName)
      if (commit.id <= highestId && (!commit.data || !commit.data.deletedDoc))
        return // Commit exists
    }
    await validateCommit(commit)
    try {
      if (orm.isMaster()) {
        commit.execDate = new Date()
        commit.isPending = true
        orm.writeSyncLog(EVENT_CONSTANT.PERFECT_FORM, commit)
      }
      this.value = await orm(`Commit`, commit.dbName).create(commit);
    } catch (e) {
      console.error(e)
    } finally {
      updateHighestId(commit.id)
      await orm('CommitData', commit.dbName).updateOne({}, { highestCommitId: commit.id }, { upsert: true })
    }
  })

  orm.onDefault('process:commit', async function (commit) {
    this.value = commit;
  })

  let commitsCache = []
  let CACHE_THRESHOLD = 300
  let USE_CACHE = true
  orm.on('commit:sync:master', async function (clientHighestId, archiveCondition, syncAll, dbName) {
    if (!commitsCache.length) {
      commitsCache = await orm('Commit').find({ collectionName: { $nin: orm.getUnwantedCol() } }).sort({ id: -1 }).limit(CACHE_THRESHOLD)
      commitsCache.reverse()
    }
    if (commitsCache.length &&
      clientHighestId >= commitsCache[0].id &&
      clientHighestId < _.last(commitsCache).id &&
      USE_CACHE && !syncAll) {
      this.value = commitsCache.filter(commit => {
        return commit.id > clientHighestId
      })
    } else {
      const additionalCondition = syncAll ? {} : {collectionName: { $nin: orm.getUnwantedCol() }}
      this.value = await orm('Commit', dbName).find({
        id: {$gt: clientHighestId}, isPending: { $exists: false },
        ...additionalCondition
      }).sort({ id: 1 }).limit(CACHE_THRESHOLD);
    }
    if (this.value.length < CACHE_THRESHOLD) {
      const archivedCommits = (await orm.emit('commit:getArchive', archiveCondition, CACHE_THRESHOLD - this.value.length)).value
      if (archivedCommits && Array.isArray(archivedCommits))
        this.value.push(...archivedCommits)
    }
  })
  orm.on('commit:handler:finish', 1, async commit => {
    if (commitsCache.length) {
      const highestCachedId = commitsCache.length ? _.last(commitsCache).id : 0
      const additionalData = await orm('Commit').find({
        id: {$gt: highestCachedId},
        isPending: { $exists: false },
        collectionName: { $nin: orm.getUnwantedCol() }
      }).sort({ id: 1 }).limit(CACHE_THRESHOLD)
      additionalData.reverse()
      commitsCache.push(...additionalData)
    }
    while (commitsCache.length > CACHE_THRESHOLD)
      commitsCache.shift()
  })
  orm.on('commit:setUseCacheStatus', (value) => {
    USE_CACHE = value
    if (USE_CACHE)
      commitsCache = [] //reset cache
  })
  orm.on('commit:cacheThreshold', threshold => CACHE_THRESHOLD = threshold)

  orm.onQueue('commitRequest', async function (commits) {
    try {
      orm.writeSyncLog(EVENT_CONSTANT.COMMIT_REQUEST, commits.map(commit => commit._id))
      if (!commits || !commits.length)
        return
      for (let commit of commits) {
        await orm.emit(`process:commit:${commit.collectionName}`, commit)
        if (commit.tags) {
          for (const tag of commit.tags) {
            await orm.emit(`process:commit:${tag}`, commit)
          }
        }
        await orm.emit('createCommit', commit);
      }
    } catch (err) {
      console.log('Error in commitRequest')
    }

    orm.emit('commit:handler:doneAllCommits')
    console.log('Done commitRequest', commits.length, commits[0]._id, new Date())
  })

  async function removeAll() {
    await orm('Commit').deleteMany()
    for (const collection of whitelist) {
      await orm(collection).remove().direct()
    }
  }

  // this must be called after master is set
  orm.on('setUpNewMaster', async function (isMaster) {
    if (isMaster)
      return
    await removeAll()
    const highestCommitId = 0;
    highestCommitIdOfCollection = null
    await orm('CommitData').updateOne({}, {
      highestCommitId,
      $unset: {
        highestCommitIdOfCollection: ''
      },
      fakeId: 0,
    }, { upsert: true })
    await orm.emit('transport:removeQueue')
    await orm.emit('commit:remove-all-recovery')
  })

  let commitDataId = null
  orm.on('getCommitDataId', async function () {
    if (commitDataId) {
      return this.value = commitDataId
    }
    let commitData = await orm('CommitData').findOne()
    if (!commitData) {
      commitData = await orm('CommitData').create({})
    }
    commitDataId = commitData._id
    this.value = commitData._id
  })

  orm.emit('initFakeLayer');
}

module.exports = syncPlugin;
