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
    console.log('Start replacing master', new Date())
    orm.emit('isReplacingMaster')
    await orm.emit('reset-session')
    await orm('CommitData').updateOne({}, { highestCommitId: 0, highestArchiveId: 0, isReplacingMaster: true, $unset: { syncData: '' } })
    await orm('Commit').deleteMany()
    await orm('CommitArchive').deleteMany()
    orm.emit('replacingMasterProgress', 'Start sync snapshot')
    await orm.startSyncSnapshot()
    orm.emit('replacingMasterProgress', 'Start create archive')
    orm.recreateArchvie && await orm.recreateArchvie()
    const whiteList = _.cloneDeep(orm.getWhiteList())
    const snapshotCol = orm.getSnapshotCollection()
    _.remove(whiteList, col => snapshotCol.includes(col))

    for (let col of whiteList) {
      await orm(col).updateMany({ _arc: { $exists: false } }, { needRecreate: true }).direct()
      const totalDocs = await orm(col).count({ needRecreate: true })
      let cnt = 0
      while (true) {
        const doc = await orm(col).findOne({ needRecreate: true })
        if (!doc) break
        delete doc.needRecreate
        await orm(col).deleteOne({ _id: doc._id }).direct()
        await orm(col).create(doc)
        cnt += 1
        orm.emit('replacingMasterProgress', `${col} ${cnt}/${totalDocs}`)
      }
    }
    await orm('CommitData').updateOne({}, { $unset: { isReplacingMaster: '' } })
    await removeFake()
    orm.emit('doneReplacingMaster')
    console.log('Done replacing master', new Date())
  }
}
