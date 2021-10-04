const _ = require('lodash');
const {parseCondition, parseSchema} = require("../schemaHandler");
const uuid = require('uuid').v1;
const jsonFn = require('json-fn');
const dayjs = require('dayjs')
const {ObjectID} = require('bson')
const bulkUtils = require('./sync-bulk-utils')
const { Query } = require('mingo')

const syncPlugin = function (orm) {
  const whitelist = []
  let highestCommitIdOfCollection = null

  orm.handleFindQuery = handleFindQuery
  orm.setHighestCommitIdOfCollection = setHighestCommitIdOfCollection
  orm.registerCommitBaseCollection = registerCommitBaseCollection
  orm.getCommitData = getCommitData
  orm.getWhiteList = getWhiteList

  bulkUtils(orm)

  function setHighestCommitIdOfCollection(col, val) {
    highestCommitIdOfCollection[col] = val
  }

  function getWhiteList() {
    return whitelist
  }

  function setExpireAfterNumberOfId(numberOfId) {
    orm.onQueue('commit:handler:finish', async (commit) => {
      if (orm.mode !== 'multi' && !checkMaster()) {
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

  orm.on('pre:execChain', -2, function (query) {
    const last = _.last(query.chain);
    if (last.fn === "batch") {
      query.chain.pop();
      this.stop();
      query.mockCollection = true;
      orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
        const {fn, args} = _query.chain[0];
        let value;
        if (fn === 'insertOne') {
          value = {insertOne: {document: args[0]}}
        } else if (fn === 'findOneAndUpdate') {
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
          value = {deleteOne: {document: args[0]}}
        } else if (fn === 'deleteMany') {
          value = {deleteMany: {document: args[0]}}
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
    } else {
      if (whitelist.includes(query.name) && !query.chain.find(c => c.fn === 'commit')) {
        const cmds = ['update', 'Update', 'create', 'insert', 'remove', 'delete', 'bulkWrite']
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
    if (_query.chain.length < query.chain.length) {
      let cursor = orm(query.name)
      const numberOfFakeDocs = await orm(_query.name).count() // expect this number to be small
      for (let i = 0; i < query.chain.length; i++) {
        if (query.chain[i].fn !== 'skip') {
          cursor = cursor[query.chain[i].fn](...query.chain[i].args)
        } else {
          cursor = cursor[query.chain[i].fn](Math.max(0, parseInt(query.chain[i].args[0]) - numberOfFakeDocs))
        }
      }
      cursor = cursor.direct()
      result.value = await cursor
    }
  }

  async function handleFindQuery(query, result) {
    try {
      const _query = _.cloneDeep(query)
      if (_query.chain[0].fn.includes('AndUpdate')) {
        _query.chain[0].fn = _query.chain[0].fn.slice(0, -9)
      }
      _query.name = 'Recovery' + _query.name
      _query.uuid = uuid()
      await handleSkipQuery(_query, query, result)
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
            cursor[query.chain[i].fn](...query.chain[i].args)
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
        uuid: uuid(),
        tags: args.filter(arg => typeof arg === "string"),
        data: _.assign({}, ...args.filter(arg => typeof arg === "object")),
        approved: false
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
      if (!commit.chain) return;
      const isDeleteCmd = target.cmd.includes('delete') || target.cmd.includes('remove')
      const fakeCollectionName = 'Recovery' + commit.collectionName
      const _query = orm.getQuery(commit)
      _query.name = fakeCollectionName
      const exec = async () => await orm.execChain(_query)
      const currentDate = new Date()
      if (target.condition) {
        const docs = await orm(commit.collectionName).find(target.condition).direct()
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
        // return if query is create or insert
        if (query.chain && (query.chain[0].fn.includes('create') || query.chain[0].fn.includes('insert')))
          return
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
        const fakeCollectionName = 'Recovery' + commit.collectionName
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
    if (commits.length > COMMIT_BULK_WRITE_THRESHOLD) {
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
    orm.emit('commit:handler:doneAllCommits')
    console.log('Done requireSync', commits.length, commits[0]._id, new Date())
  })

  let highestIdInMemory = null
  const updateHighestId = (newHighestId) => {
    if (!newHighestId || isNaN(newHighestId))
      return
    if (!highestIdInMemory)
      highestIdInMemory = newHighestId
    else
      highestIdInMemory = Math.max(highestIdInMemory, newHighestId)
  }
  //customize
  orm.onQueue('createCommit', async function (commit) {
    if (!commit.id) {
      let { value: highestId } = await orm.emit('getHighestCommitId', commit.dbName);
      if (highestIdInMemory)
        if (highestId !== highestIdInMemory) {
          await orm.emit('commit:report:errorId', highestId, highestIdInMemory)
          highestId = highestIdInMemory
        }
      commit.id = highestId + 1;
    } else {
      // commit with id smaller than highestId has been already created
      const { value: highestId } = await orm.emit('getHighestCommitId', commit.dbName)
      if (commit.id <= highestId)
        return // Commit exists
    }
    try {
      if (orm.isMaster()) {
        commit.execDate = new Date()
        commit.isPending = true
      }
      this.value = await orm(`Commit`, commit.dbName).create(commit);
      updateHighestId(commit.id)
      await orm('CommitData', commit.dbName).updateOne({}, { highestCommitId: commit.id }, { upsert: true })
    } catch (e) {
      if (e.message.slice(0, 6) === 'E11000') {
        //console.log('sync two fast')
      }
    }
    // if (isMaster) {
    //   this.value = await orm(`Commit`, commit.dbName).create(commit);
    // }
  })

  orm.onDefault('process:commit', async function (commit) {
    commit.approved = true;
    this.value = commit;
  })

  let commitsCache = []
  let CACHE_THRESHOLD = 300
  let USE_CACHE = true
  orm.on('commit:sync:master', async function (clientHighestId, dbName) {
    if (!commitsCache.length) {
      commitsCache = await orm('Commit').find().sort({ id: -1 }).limit(CACHE_THRESHOLD)
      commitsCache.reverse()
    }
    if (commitsCache.length &&
      clientHighestId >= commitsCache[0].id &&
      clientHighestId < _.last(commitsCache).id &&
      USE_CACHE) {
      this.value = commitsCache.filter(commit => {
        return commit.id > clientHighestId
      })
    } else {
      this.value = await orm('Commit', dbName).find({id: {$gt: clientHighestId}, isPending: { $exists: false }}).limit(CACHE_THRESHOLD);
    }
  })
  orm.on('commit:handler:finish', 1, async commit => {
    if (commitsCache.length) {
      const highestCachedId = commitsCache.length ? _.last(commitsCache).id : 0
      commitsCache.push(...(await orm('Commit').find({id: {$gt: highestCachedId}, isPending: { $exists: false }}).limit(CACHE_THRESHOLD)))
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
      if (!commits || !commits.length)
        return
      for (let commit of commits) {
        if (!commit.tags) {
          await orm.emit(`process:commit:${commit.collectionName}`, commit)
        } else {
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

  async function removeFake() {
    for (const collection of whitelist) {
      const docs = await orm('Recovery' + collection).find()
      for (const doc of docs) {
        delete doc._fakeId
        delete doc._fakeDate
      }
      await orm(collection).create(docs)
    }
  }

  async function removeAll() {
    await orm('Commit').deleteMany()
    for (const collection of whitelist) {
      await orm(collection).remove().direct()
    }
  }

  // this must be called after master is set
  orm.on('setUpNewMaster', async function (isMaster) {
    if (isMaster)
      await removeFake()
    else
      await removeAll()
    const highestCommitId = isMaster ? (await orm('Commit').findOne({}).sort('-id') || {id: 0}).id : 0;
    await orm('CommitData').updateOne({}, { highestCommitId }, { upsert: true })
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

  // if (isMaster) {
  //   //use only for master
  //
  //   orm.on('update:Commit:c', async function (commit) {
  //     let query = getQuery(commit);
  //     if (commit.dbName) query.name += `@${commit.dbName}`;
  //     const result = await orm.execChain(query);
  //     orm.emit(`commit:result:${commit.uuid}`, result);
  //     await orm.emit('master:transport:sync', commit.id);
  //   })
  //
  //   orm.on('commit:sync:master', async function (clientHighestId, dbName) {
  //     this.value = await orm('Commit', dbName).find({id: {$gt: clientHighestId}});
  //   })
  // }

  orm.emit('initFakeLayer');
}

module.exports = syncPlugin;
