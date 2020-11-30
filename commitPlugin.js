const Queue = require('better-queue')
const ObjectID = require('bson').ObjectID
const jsonFn = require('json-fn')

module.exports = function (orm) {
  orm.commitHandler = orm.commitHandler || {
    queue: new Queue(async function (commits) {
      if (!Array.isArray(commits)) {
        commits = [commits]
      }
      for (let commit of commits) {
        await orm.execPostAsync(`commit:${orm.commitHandler.commitTypes[commit.collectionName]}`, null, [commit]);
      }
    }),
    commitTypes: {}
  }
  orm.commitHandler.queue.pause()

  orm.commitHandler.registerCommitCollections = function (groupName, collectionsList) {
    if (!collectionsList) collectionsList = [groupName]
    if (orm.commitHandler.commitTypes[groupName]) return false
    collectionsList.forEach(collection => {
      if (orm.commitHandler.commitTypes[collection]) {
        console.warn(`Collection ${collection} is registered more than one time`)
      }
      orm.commitHandler.commitTypes[collection] = groupName
    })
    return true
  }

  orm.commitHandler.startQueue = function () {
    orm.commitHandler.queue.resume()
  }

  orm.commitHandler.createCommit = function (query) {
    return {
      _id: new ObjectID(),
      query: jsonFn.stringify(query),
      collectionName: query.name
    }
  }

  orm.commitHandler.sync = function (commits, ack) {
    // todo: implement this function
  }

  orm.post('pre:execChain', async (query, returnResult) => {
    if (!orm.commitHandler.commitTypes[query.name]) return
    const last = _.last(query.chain)
    if (last.fn === 'commit') {
      query.chain.pop()
      const { args } = last;
    }
    const commit = orm.commitHandler.createCommit(query)
    orm.commitHandler.sync(commit, (commits) => {
      orm.commitHandler.queue.push(commits)
    });
  })
}
