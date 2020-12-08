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
        if (!(commit.tags.length && commit.tags[0] === 'deleteCommit')) {
          await orm.emit(`commit:${commitTypes[commit.collectionName].commitType}${commit.tags.length ? `:${commit.tags[0]}` : ''}`, commit)
          const recoverCommit = Object.assign({ ...commit }, { tags: ['deleteCommit'] })
          await orm.emit(`${TAG}:createCommit`, recoverCommit)
        }
      })
      await orm.emit(`${FAKE_LAYER_TAG}:postRecover`)
    }
    cb()
  })
  const commitTypes = {}

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
        await orm.emit(`${TRANSPORT_LAYER_TAG}:sync`, commit, dbName)
        this.value = (await orm.emit(`${FAKE_LAYER_TAG}:fakeDocuments`, _query.name, target.condition, exec)).value
      } else {
        this.value = await exec()
      }
    })
  })

  orm.on(`${TAG}:createCommit`, async function (commit) {
    if (!commit.id) {
      commit.id = (await orm.emit(`${TAG}:getHighestCommitId`)).value
    }
    const query = jsonFn.parse(commit.query)
    const dbName = query.name.includes('@') ? query.name.split('@')[1] : undefined
    await orm.getCollection('Commit', dbName).create(commit).direct()
    await orm.emit(`${TRANSPORT_LAYER_TAG}:emitToAll`, commit, dbName)
  })

  orm.on(`${TAG}:getHighestCommitId`, async function () {
    const highestDoc = await orm.getCollection('Commit').findOne({}).sort('-id')
    this.value = highestDoc ? highestDoc.id + 1 : 1
  })

  // orm.on(`update:Commit:c`, async function (dbName) {
  //   await orm.emit(`${TRANSPORT_LAYER_TAG}:emitToAll`)
  // })

  // orm.on(`${TAG}:`)

  Object.assign(orm, {
    registerCommitCollections
  })
}
