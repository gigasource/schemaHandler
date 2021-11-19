const _ = require('lodash')

module.exports = function (orm) {
  orm.checkIsReplacingMaster = checkIsReplacingMaster
  orm.startReplacingMaster = startReplacingMaster

  async function checkIsReplacingMaster() {
    const commitData = await orm('CommitData').findOne()
    if (commitData && commitData.isReplacingMaster) {
      await startReplacingMaster()
    }
  }

  async function removeFake() {
    const whiteList = orm.getWhiteList()
    for (const collection of whiteList) {
      const docs = await orm('Recovery' + collection).find()
      for (const doc of docs) {
        delete doc._fakeId
        delete doc._fakeDate
      }
      try {
        await orm(collection).create(docs)
      } catch (err) {}
    }
  }

  async function startReplacingMaster() {
    await orm.emit('reset-session')
    await orm('CommitData').updateOne({}, { highestCommitId: 0, highestArchiveId: 0, isReplacingMaster: true })
    await orm('Commit').deleteMany()
    await orm('CommitArchive').deleteMany()
    await orm.startSyncSnapshot()
    await orm.recreateArchvie()
    const whiteList = orm.getWhiteList()
    const snapshotCol = orm.getSnapshotCollection()

    for (let col of whiteList) {
      while (true) {
        const doc = await orm(col).findOne({ _arc: { $exists: false } })
        if (!doc) break
        await orm(col).deleteOne({ _id: doc._id }).direct()
        await orm(col).create(doc)
      }
    }
    await orm('CommitData').updateOne({}, { $unset: { isReplacingMaster: '' } })
    await removeFake()
  }
}
