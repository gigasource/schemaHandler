const _ = require('lodash')
const jsonFn = require('json-fn')

const syncArchive = function (orm) {
  orm('CommitArchive').createIndex({ id: 1 }).then(r => r)
  let highestArchiveId = null
  orm.doArchive = doArchive
  orm.on('commit:getArchive', async function (highestArchiveId, lim = 300) {
    const archivedCommits = await orm('CommitArchive').find({ id: { $gt: highestArchiveId } }).sort({ id: 1 }).limit(lim)
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
      await orm('CommitData').updateOne({}, { highestArchiveId })
    } else {
      await orm('CommitData').updateOne({}, { highestArchiveId: commit.id })
    }
    if (!isExists)
      await orm('CommitArchive').create(commit)
    else
      await orm('CommitArchive').updateOne({ _id: commit._id }, commit)
    await orm.emit('commit:handler:finish:archive', commit)
  })

  orm.on('getHighestArchiveId', async function (dbName) {
    let highestCommitId
    const commitData = await orm('CommitData', dbName).findOne({})
    if (!commitData || !commitData.highestArchiveId) {
      const commitWithHighestId = await orm('CommitArchive', dbName).find({}).sort('-id').limit(1)
      highestCommitId = (commitWithHighestId.length ? commitWithHighestId[0] : { id: 0 }).id;
    }
    else
      highestCommitId = commitData.highestArchiveId
    this.value = highestCommitId;
  })

  orm.onQueue('commit:archive:bulk', async function (commits) {
    if (!commits.length) return
    const groups = _.groupBy(commits, commit => commit.collectionName)
    const keys = Object.keys(groups)
    for (const col of keys) {
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
    await orm.emit('commit:handler:finish:archive', _.last(commits))
    await orm('CommitData').updateOne({}, { highestArchiveId: _.last(commits).id })
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

  async function doArchive(collectionName, condition) {
    if (!orm.isMaster || !orm.isMaster()) return
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
      await orm.emit('createArchive', {
        collectionName: collectionName,
        data: {
          _arc: true,
          docId: doc._id,
        },
        _cnt: doc._cnt ? doc._cnt : 0,
        ref: doc._id
      })
    }
  }
}

module.exports = syncArchive
