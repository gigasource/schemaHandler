const { Worker } = require('worker_threads');
const _ = require('lodash')
const Hooks = require('../hooks/hooks')
const AwaitLock = require('await-lock').default

const hook = new Hooks()
const lock = new AwaitLock()
let queueCommits = []
let isStopped = false
let worker = null
let docs = {}
let commits = {}
let lowerId = null

module.exports = function (orm) {
  const supportedCol = []

  orm.startWorker = startWorker
  orm.stopWorker = stopWorker
  orm.getAffectedDocInRange = getAffectedDocInRange
  orm.addSupportedReplayCol = addSupportedReplayCol
  orm.replayDoc = replayDoc
  orm.getReplayDocsAndCommits = getReplayDocsAndCommits

  function addSupportedReplayCol(col) {
    supportedCol.push(col)
    const schema = orm.getSchema(col)
    if (schema)
      orm.registerSchema('Temporary' + col, schema, true)
  }

  orm.on('schemaRegistered', (collectionName, dbName, schema) => {
    if (!supportedCol.includes(collectionName)) return
    const _schema = orm.getSchema('Temporary' + collectionName)
    if (!_schema)
      orm.registerSchema('Temporary' + collectionName, schema, true)
  })

  function getReplayDocsAndCommits() {
    return {
      docs,
      commits
    }
  }

  async function startWorker(path, workerData) {
    const commitData = await orm('CommitData').find()
    const highestReplayCommitStored = commitData ? commitData.replayId : 0
    queueCommits = await orm('Commit').find({ id: { $gt: highestReplayCommitStored } })
    if (!path)
      path = './sync-utils/store-worker.js'
    orm.on('replay:pushToQueue', async (commit, opts) => {
      if (!supportedCol.includes(commit.collectionName) || !commit.chain) return
      const pushedCommit = {
        id: commit.id,
        chain: commit.chain,
        _c: commit._c ? commit._c : 'io',
        affectedDoc: opts.affectedDoc ? opts.affectedDoc.map(docId => docId.toString()) : (commit.data.deletedDoc ? commit.data.deletedDoc.map(docId => docId.toString()) : []),
        execDate: commit.execDate,
        collectionName: commit.collectionName,
        _s: commit.data.snapshot
      }
      queueCommits.push(pushedCommit)
      if (isStopped) {
        worker.postMessage({
          type: 'GET_COMMIT'
        })
      }
    })
    worker = new Worker(path, {
      workerData
    })
    worker.on('message', async (msg) => {
      switch (msg.type) {
        case 'GET_COMMIT':
          if (queueCommits.length) {
            worker.postMessage({
              type: 'NEW_COMMIT',
              commits: queueCommits,
              addedDate: new Date()
            })
            queueCommits = []
            isStopped = false
          } else {
            isStopped = true
          }
          break;
        case 'RECEIVE_AFFECTED_DOC':
          hook.emit('affected-doc')
          if (msg.res) {
            docs = msg.res.docs
            commits = msg.res.commits
            lowerId = msg.res.lowerId
          }
          break;
      }
    })
  }

  function stopWorker() {

  }

  async function replayDoc(docId, col, upperId) {
    await orm('Temporary' + col).deleteMany()
    const doc = docs[docId]
    if (!doc) {
      console.log('[Sync replay] Doc is not exists')
      return
    }
    const commitList = doc.map(c => commits[c.id]).filter(commit => commit !== undefined && commit.id <= upperId)
    const snapshotCommits = commitList.filter(commit => commit._s)
    let found = -1
    for (let idx in snapshotCommits) {
      if (snapshotCommits[idx] >= lowerId) {
        found = idx > 0 ? snapshotCommits[idx - 1].id : -1
        break
      }
    }
    if (found === -1) {
      const createCommits = commitList.filter((commit, idx) => doc[idx].c)
      if (!createCommits.length) {
        console.log('[Sync replay] Can not create replay of this doc')
        return []
      }
      found = createCommits[0].id
    }
    let itrIdx = commitList.findIndex(commit => commit.id === found)
    const history = []
    while (itrIdx < commitList.length) {
      const commit = commitList[itrIdx]
      const query = orm.getQuery(commit)
      query.name = 'Temporary' + query.name
      if (commit._s) {
        await orm(query.name).deleteOne({ _id: docId })
      }
      await orm.execChain(query)
      if (commit.id >= lowerId) {
        history.push(await orm(query.name).findOne({ _id: docId }))
      }
      itrIdx += 1
    }
    return history
  }

  async function getAffectedDocInRange(from, to) {
    if (!worker) return null
    if (lock.acquired)
      return
    lock.tryAcquire()
    return new Promise(resolve => {
      hook.once('affected-doc', () => {
        lock.acquired && lock.release()
        resolve()
      })
      worker.postMessage({
        type: 'GET_AFFECTED_DOC',
        from,
        to
      })
    })
  }
}
