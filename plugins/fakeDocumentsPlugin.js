const TAG = require('./tags').FAKE_LAYER_TAG
const AwaitLock = require('await-lock').default
const lock = new AwaitLock()
/*
 - Only support single mode
 - Fake can not run when fake running and vice versa
 */
module.exports = function (orm) {
  orm.on(`${TAG}:preFakeDocuments`, async function (collectionName, parseCondition) {
    await lock.acquireAsync()
    if (orm.mode !== 'single' || !parseCondition) return
    const recoveryCollectionName = collectionName + '-recovery'
    const originalData = await orm.getCollection(collectionName).find(Object.assign({ ...parseCondition }, { fake: {$ne: true} })).direct()
    await orm.getCollection(recoveryCollectionName).create(originalData).direct()
  })
  orm.on(`${TAG}:postFakeDocuments`, async function (collectionName, parseCondition) {
    if (orm.mode !== 'single' || !parseCondition) return
    await orm.getCollection(collectionName).updateMany(parseCondition, {$set: { fake: true }}).direct()
    lock.release()
  })
  orm.on(`${TAG}:recover`, async function (collectionName, parseCondition) {
    await lock.acquireAsync()
    if (orm.mode !== 'single' || !parseCondition) return
    const recoveryCollectionName = collectionName + '-recovery'
    const originalData = await orm.getCollection(recoveryCollectionName).find(parseCondition).direct()
    await orm.getCollection(recoveryCollectionName).deleteMany(parseCondition).direct()
    await orm.getCollection(collectionName).deleteMany(Object.assign({ ...parseCondition }, { fake: true })).direct()
    await orm.getCollection(collectionName).create(originalData).direct()
  })
  orm.on(`${TAG}:postRecover`, function () {
    lock.release()
  })
}
