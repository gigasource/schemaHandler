const _ = require('lodash')
const jsonFn = require('json-fn')

const syncArchive = function (orm) {
  orm('CommitArchive').createIndex({ id: 1 }).then(r => r)
  let highestArchiveId = null
  orm.doArchive = doArchive
  orm.on('commit:getArchive', async function (condition, lim = 300) {
    condition = jsonFn.parse(condition)
    if (!condition['$or'].length) {
      condition = {}
    }
    const archivedCommits = await orm('CommitArchive').find(condition).sort({ id: 1 }).limit(lim)
    const result = (await Promise.all(archivedCommits.map(async commit => {
      const foundDoc = await orm(commit.collectionName).findOne({ _id: commit.data.docId })
      if (!foundDoc) {
        console.log('Doc has been deleted')
        await orm('CommitArchive').deleteOne({ _id: commit._id })
        return null
      }
      if (!foundDoc._cnt) foundDoc._cnt = 0
      if (foundDoc._cnt !== commit._cnt) {
        delete commit.id
        commit._cnt = foundDoc._cnt
        await orm.emit('createArchive', commit, true)
        return null
      }
      delete foundDoc._arc
      delete commit.ref
      commit.chain = jsonFn.stringify(orm(commit.collectionName).updateOne({ _id: foundDoc._id }, foundDoc, { upsert: true }).chain)
      return commit
    }))).filter(commit => commit !== null)
    this.value = result
  })

  orm.onQueue('createArchive', async (commit, isExists = false) => {
    if (!commit.id) {
      if (!highestArchiveId) {
        const commitData = await orm('CommitData').findOne()
        highestArchiveId = commitData.highestArchiveId ? commit.highestArchiveId : 1
      }
      commit.id = highestArchiveId
      highestArchiveId += 1
    }
    await orm('CommitData').updateOne({}, { [`archiveCondition.${commit.collectionName}.highestArchiveId`]: commit.id })
    archiveCondition[commit.collectionName].highestArchiveId = commit.id
    if (!isExists)
      await orm('CommitArchive').create(commit)
    else
      await orm('CommitArchive').updateOne({ _id: commit._id }, commit)
    await orm.emit('commit:handler:finish:archive', commit)
  })

  let archiveCondition = null
  orm.on('setArchiveCondition', async function (collectionName, condition, highestId= 0, dbName) {
    const newCondition = {}
    Object.keys(condition).forEach(field => {
      newCondition[`c_${field}`] = condition[field]
    })
    condition = newCondition
    await orm.emit('getArchiveCondition')
    // todo: consider sync starting position
    // const newHighestId = await orm('CommitArchive', dbName).find({ ...condition, collectionName }).sort('-id').limit(1)
    archiveCondition[collectionName] = {
      highestArchiveId: highestId,
      condition
    }
    await orm('CommitData').updateOne({}, { [`archiveCondition.${collectionName}`]: { highestArchiveId: highestId, condition: jsonFn.stringify(condition) } }, { upsert: true })
  })

  orm.on('getArchiveCondition', async function (dbName) {
    if (archiveCondition === null) {
      const commitData = await orm('CommitData', dbName).findOne({})
      archiveCondition = commitData && commitData.archiveCondition ? commitData.archiveCondition : {}
      Object.keys(archiveCondition).forEach(col => {
        const { highestArchiveId, condition } = archiveCondition[col]
        archiveCondition[col] = {
          highestArchiveId,
          condition: jsonFn.parse(condition)
        }
      })
    }
    this.value = jsonFn.stringify({ $or: Object.keys(archiveCondition).map(col => {
      return {
        id: { $gt: archiveCondition[col].highestArchiveId },
        collectionName: col,
        ...archiveCondition[col].condition
      }
    }) })
  })

  orm.onQueue('commit:archive:bulk', async function (commits) {
    if (archiveCondition === null)
      await orm.emit('getArchiveCondition')
    if (!commits.length) return
    const groups = _.groupBy(commits, commit => commit.collectionName)
    const keys = Object.keys(groups)
    for (const col of keys) {
      if (!archiveCondition[col])
        await orm.emit('setArchiveCondition', col, {})
      const queries = groups[col].map(commit => {
        const query = jsonFn.parse(commit.chain)
        return {
          updateOne: {
            filter: query[0].args[0],
            update: query[0].args[1],
            upsert: true
          }
        }
      })
      try {
        await orm(col).bulkWrite(queries).direct()
      } catch (err) {
        console.log('Error while doing bulkWrite for archived docs of collection', col, err)
      }
    }
    Object.keys(groups).map(async col => {
      await orm('CommitData').updateOne({}, {
        [`archiveCondition.${col}.highestArchiveId`]: _.last(groups[col]).id
      })
      orm.emit(`commit:handler:finish:archive:${col}`, _.last(groups[col]))
      archiveCondition[col].highestArchiveId = _.last(groups[col]).id
    })
    orm.emit('commit:handler:finish:archive', _.last(commits))
  })

  orm.onQueue('update:CommitArchive:c', async function (commit) {
    if (!commit.chain)
      return
    let query = orm.getQuery(commit)
    if (commit.dbName) query.name += `@${commit.dbName}`
    let result
    try {
      result = await orm.execChain(query)
    } catch (e) {
      console.error('Error on query', jsonFn.stringify(query), 'is', e)
      await orm.emit('commit:report:errorExec', commit.id, e.message)
    }
  })

  async function doArchive(collectionName, condition, conditionFields = [], dbName) {
    if (!orm.isMaster || !orm.isMaster()) return
    const commitData = await orm('CommitData').findOne()
    if (!commitData) return
    if (!commitData.archiveCondition)
      commitData.archiveCondition = {}
    const { archiveCondition } = commitData
    if (!archiveCondition[collectionName]) {
      orm.emit('setArchiveCondition', collectionName, {}, 0, dbName)
    }
    await orm(collectionName).updateMany(condition, { _arc: true }).direct()
    // remove snapshot of docs
    // todo: test case with ref
    while (true) {
      const doc = await orm(collectionName).findOne({ _arc: true, $or: [{snapshot: true}, {ref: true}] })
      if (!doc) break
      await orm(collectionName).updateOne({ _id: doc._id }, { $unset: { snapshot: '', ref: '' } }).direct()
      await orm('Commit').deleteMany({ 'data.docId': doc._id, 'data.snapshot': true })
    }
    const foundDocs = await orm(collectionName).find(condition)
    for (const doc of foundDocs) {
      const newCondition = {}
      conditionFields.forEach(field => {
        newCondition[`c_${field}`] = doc[field]
      })
      await orm.emit('createArchive', {
        collectionName: collectionName,
        data: {
          _arc: true,
          docId: doc._id,
        },
        _cnt: doc._cnt ? doc._cnt : 0,
        ref: doc._id,
        ...newCondition
      })
    }
  }
}

module.exports = syncArchive
