const Queue = require('better-queue')
const ObjectID = require('bson').ObjectID
const jsonFn = require('json-fn')
const _ = require('lodash')
const uuid = require("uuid").v1;

const TAG = require('./tags').COMMIT_LAYER_TAG
const { initTransporterWithOrm } = require('./transporter')
const { TRANSPORT_LAYER_TAG, FAKE_LAYER_TAG } = require('./tags')

module.exports = function (orm) {
  const queue = new Queue(async function (commits, cb) {
    if (!Array.isArray(commits)) commits = [commits]
    for (let commit of commits) {
      const query = jsonFn.parse(commit.query)
      await orm.emit(`${FAKE_LAYER_TAG}:recover`, commit.collectionName, query.chain[0].args[0], async function () {
        await orm.emit(`commit:${commitTypes[commit.collectionName].commitType}${commit.tags.length ? `:${commit.tags[0]}` : ''}`, commit)
      })
      await orm.emit(`${FAKE_LAYER_TAG}:postRecover`)
    }
    cb()
  })
  const commitTypes = {}
  let isMaster, setMaster

  if (orm.mode === 'single') {
    isMaster = false
    setMaster = (_isMaster) => {
      isMaster = _isMaster
    }
  } else {
    isMaster = {}
    setMaster = (dbName, _isMaster) => {
      isMaster[dbName] = _isMaster
    }
  }
  const getMaster = (dbName) => {
    return dbName ? orm.commitHandler.isMaster[dbName] : orm.commitHandler.isMaster
  }

  orm.onDefault(`${TAG}:sync`, (commits) => {
    // check highestId here
    queue.push(commits)
  })
  queue.pause()

  const registerCommitCollections = function (commitTypeGroups) {
    for (let commitType in commitTypeGroups) {
      commitTypeGroups[commitType].forEach(collection => {
        if (typeof collection === 'string') {
          collection = {
            name: collection,
            commitType
          }
          const collectionName = collection.name
          commitTypes[collectionName] = collection
        }
      })
      startQueue()
    }
    return commitTypes
    // collectionsList.forEach(collection => {
    //   if (typeof collection === 'string') {
    //     collection = {
    //       name: collection,
    //       needMaster: true,
    //       groupName
    //     }
    //   }
    //   const collectionName = collection.name
    //   if (commitTypes[collectionName]) {
    //     console.warn(`Collection ${collectionName} is registered more than one time`)
    //   }
    //   commitTypes[collectionName] = collection
    // })
    // return true
  }

  const startQueue = function () {
    queue.resume()
  }

  const createCommit = function (query, tags, data) {
    return {
      tags,
      data,
      _id: new ObjectID(),
      query: jsonFn.stringify(query),
      collectionName: query.name,
      uuid: uuid()
    }
  }

  orm.on('pre:execChain', async function (query) {
    if (_.last(query.chain).fn === 'direct') {
      query.chain.pop()
      return
    }
    if (!commitTypes[query.name]) return
    // todo check allowed fn
    query.mockCollection = true
    const last = _.last(query.chain)
    let tags = []
    let data = {}
    if (last.fn === 'commit') {
      query.chain.pop()
      const { args } = last;
      tags = args.filter(arg => typeof arg === 'string')
      data = _.assign({}, ...args.filter(arg => typeof arg === 'object'))
    }
    orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
      if (target.isMutateCmd) {
        const commit = createCommit(_query, tags, data)
        const dbName = (orm.mode === 'single' ? undefined : query.name.split('@')[1])
        const _isMaster = (orm.mode === 'single' ? isMaster : isMaster[dbName])
        await orm.emit(`${TRANSPORT_LAYER_TAG}:sync`, commit, dbName, _isMaster)
        this.value = (await orm.emit(`${FAKE_LAYER_TAG}:fakeDocuments`, _query.name, target.condition, exec)).value
      } else {
        this.value = await exec()
      }
    })
  })

  orm.on(`${TAG}:getHighestCommitId`, async () => {
    const highestDoc = await orm.getCollection('Commit').findOne({}).sort('-id')
    this.value = highestDoc ? highestDoc.id + 1 : 1
  })

  orm.on(`update:Commit:c`, async (dbName) => {
    await orm.emit('emitToAll')
  })

  // orm.on(`${TAG}:`)

  Object.assign(orm, {
    getMaster,
    registerCommitCollections,
    setMaster
  })
}
