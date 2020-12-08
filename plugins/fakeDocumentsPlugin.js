const TAG = require('./tags').FAKE_LAYER_TAG
const AwaitLock = require('await-lock').default
const lock = new AwaitLock()
/*
 - Only support single mode
 - Recover can not run when fake running and vice versa
 */
module.exports = function (orm) {
  const recoveryCollection = orm.getCollection('Recovery')
  orm.on(`${TAG}:fakeDocuments`, async function (collectionName, parseCondition, exec) {
    if (orm.mode !== 'single') return
    await lock.acquireAsync()
    const collection = orm.getCollection(collectionName)
    if (parseCondition) {
      const originalData = await collection.find(Object.assign({ ...parseCondition }, { fake: { $ne: true } })).direct()
      if (Array.isArray(originalData)) {
        originalData.forEach(data => {
          data.collectionName = collectionName
        })
      } else {
        originalData.collectionName = collectionName
      }
      await recoveryCollection.create(originalData).direct()
    }
    this.value = await exec()
    await collection.updateMany(parseCondition ? parseCondition :
      (Array.isArray(this.value) ?
        { _id: {$in: this.value.map(item => item._id)}} :
          this.value ), { fake: true }).direct()
    lock.release()
  })
  orm.on(`${TAG}:recover`, async function (collectionName, parseCondition, cb) {
    if (orm.mode !== 'single') {
      if (cb) await cb()
      return
    }
    await lock.acquireAsync()
    const collection = orm.getCollection(collectionName)
    const recoveryCondition = Object.assign({...parseCondition}, { collectionName })
    const originalData = await recoveryCollection.find(recoveryCondition).direct()
    await recoveryCollection.deleteMany(recoveryCondition).direct()
    const fakeCondition = Object.assign({...parseCondition}, { fake: true})
    await collection.deleteMany(fakeCondition).direct()
    if (!Array.isArray(originalData)) {
      delete originalData.collectionName
    } else {
      originalData.forEach(data => {
        delete data.collectionName
      })
    }
    await collection.create(originalData).direct()
    if (cb) await cb()
    lock.release()
  })
}
