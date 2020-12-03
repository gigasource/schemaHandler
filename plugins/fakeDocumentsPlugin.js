const TAG = require('./tags').FAKE_LAYER_TAG

/*
 Only support single mode
 */
module.exports = function (orm) {
  orm.on(`${TAG}:preFakeDocuments`, async function (collectionName, parseCondition) {
    if (orm.mode !== 'single' || !parseCondition) return
    const recoveryCollectionName = collectionName + '-recovery'
    const originalData = await orm.getCollection(collectionName).find(Object.assign(parseCondition, { fake: {$ne: true} })).direct()
    await orm.getCollection(recoveryCollectionName).create(originalData).direct()
  })
  orm.on(`${TAG}:postFakeDocuments`, async function (collectionName, parseCondition) {
    if (orm.mode !== 'single' || !parseCondition) return
    await orm.getCollection(collectionName).updateMany(parseCondition, {$set: { fake: true }}).direct()
  })
  orm.on(`${TAG}:recover`, async function (collectionName, parseCondition) {
    if (orm.mode !== 'single' || !parseCondition) return
    const recoveryCollectionName = collectionName + '-recovery'
    const originalData = await orm.getCollection(recoveryCollectionName).find(parseCondition).direct()
    await orm.getCollection(recoveryCollectionName).deleteMany(parseCondition).direct()
    await orm.getCollection(collectionName).deleteMany(Object.assign(parseCondition, { fake: true })).direct()
    await orm.getCollection(collectionName).create(originalData).direct()
  })
}
