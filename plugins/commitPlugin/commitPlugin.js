const Queue = require('better-queue')
const ObjectID = require('bson').ObjectID
const jsonFn = require('json-fn')

const TAG = require('../tags').COMMIT_LAYER_TAG
const { initTransporterWithOrm } = require('./transporter')
const TRANSFORM_LAYER_TAG = require('../tags').TRANSPORT_LAYER_TAG
const allowedFn = [] // todo: fill this

module.exports = function (orm) {
  initTransporterWithOrm(orm)

  orm.commitHandler = orm.commitHandler || {
    queue: new Queue(async function (commits) {
      if (!Array.isArray(commits)) {
        await orm.emit(`commit:${orm.commitHandler.commitTypes[commit.collectionName].groupName}`, commits)
        return
      }
      for (let commit of commits) {
        await orm.emit(`commit:${orm.commitHandler.commitTypes[commit.collectionName].groupName}`, commit)
      }
    }),
    commitTypes: {}
  }
  if (orm.mode === 'single') {
    orm.commitHandler.setMaster = (isMaster) => {
      if (orm.commitHandler.isMaster.length) {
        orm.commitHandler.isMaster.pop()
      }
      orm.commitHandler.isMaster = true
    }
  } else {
    orm.commitHandler.isMaster = {}
    orm.commitHandler.setMaster = (dbName, isMaster) => {
      orm.commitHandler.isMaster[dbName] = isMaster
    }
  }
  orm.commitHandler.getMaster = (dbName) => {
    return dbName ? orm.commitHandler.isMaster[dbName] : orm.commitHandler.isMaster
  }

  orm.default(`${TAG}:sync`, (commits) => {
    orm.commitHandler.queue.push(commits)
  })
  orm.commitHandler.queue.pause()

  orm.commitHandler.registerCommitCollections = function (groupName, collectionsList) {
    if (!collectionsList) collectionsList = [groupName]
    if (orm.commitHandler.commitTypes[groupName]) return false
    collectionsList.forEach(collection => {
      if (typeof collection === 'string') {
        collection = {
          name: collection,
          needMaster: true,
          groupName
        }
      }
      const collectionName = collection.name
      if (orm.commitHandler.commitTypes[collectionName]) {
        console.warn(`Collection ${collectionName} is registered more than one time`)
      }
      orm.commitHandler.commitTypes[collectionName] = collection
    })
    return true
  }

  orm.commitHandler.startQueue = function () {
    orm.commitHandler.queue.resume()
  }

  orm.commitHandler.createCommit = function (query, tags, data) {
    return {
      tags,
      data,
      _id: new ObjectID(),
      query: jsonFn.stringify(query),
      collectionName: query.name
    }
  }

  orm.post('pre:execChain', async (query) => {
    if (!orm.commitHandler.commitTypes[query.name]) return
    // todo check allowed fn
    const last = _.last(query.chain)
    let tags = []
    let data = {}
    if (last.fn === 'commit') {
      query.chain.pop()
      const { args } = last;
      tags = args.filter(arg => typeof arg === 'string')
      data = _.assign({}, ...args.filter(arg => typeof arg === 'object'))
    }
    const commit = orm.commitHandler.createCommit(query, tags, data)
    await orm.emit(`${TRANSFORM_LAYER_TAG}:sync`, commit)
    if (orm.commitHandler.commitTypes[query.name].needMaster) this.ok = true
  })
}

module.exports.TAG = TAG
