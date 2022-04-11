const levelup = require('levelup')
const fs = require('fs')
const path = require('path')
const { parentPort, isMainThread, workerData } = require('worker_threads');
const sublevel = require('level-sublevel')
const jsonFn = require('json-fn')

let db
const stores = {}

function create(_path) {
  try {
    const leveldown = require('leveldown')
    const dbPath = path.resolve(_path, 'replay')
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath)
    }
    db = sublevel(levelup(leveldown(dbPath)))
    stores.commitStore = db.sublevel('commit_store', { valueEncoding: 'json' })
    stores.commitAddedDate = db.sublevel('commit_added_date', { valueEncoding: 'json' })
    stores.commitExecDate = db.sublevel('commit_exec_date', { valueEncoding: 'json' })
    stores.docCommit = db.sublevel('doc_commit', { valueEncoding: 'json' })
  } catch (err) {
    console.error(err)
  }
}

async function handleAffectedDoc(docId, commit, isCreate, ops) {
  docId = docId.toString()
  const _key = `${docId}-${commit.collectionName}`
  try {
    let currentDocValue = await new Promise((resolve, reject) => {
      stores.docCommit.get(_key, (err, value) => {
        if (err) reject(err)
        resolve(value)
      })
    })
    // currentDocValue = jsonFn.parse(currentDocValue)
    let needSort = false
    if (currentDocValue.length && commit.id < currentDocValue[currentDocValue.length - 1].id) {
      needSort = true
    }
    currentDocValue.push({ id: commit.id, c: isCreate })
    if (needSort) {
      currentDocValue.sort((a, b) => a.id <= b.id)
    }
    ops.push({
      type: 'put', key: _key, value: currentDocValue, prefix: stores.docCommit
    })
  } catch (err) {
    // does not exists
    ops.push({
      type: 'put', key: _key, value: [{ id: commit.id, c: isCreate }], prefix: stores.docCommit
    })
  }
}

async function addCommit(commit, addedDate) {
  try {
    const ops = [
      { type: 'put', key: commit.id, value: commit, prefix: stores.commitStore },
      { type: 'put', key: Buffer.from((+addedDate).toString()), value: commit.id, prefix: stores.commitAddedDate},
      { type: 'put', key: Buffer.from((+commit.execDate).toString()), value: commit.id, prefix: stores.commitExecDate}
    ]
    if (['io', 'im', 'i', 'c', 'cm'].includes(commit._c)) {
      const query = jsonFn.parse(commit.chain)
      const docs = query[0].args[0]
      if (Array.isArray(docs)) {
        const docsId = docs.map(doc => doc._id)
        for (let id of docsId) {
          await handleAffectedDoc(id, commit, !commit._s, ops)
        }
      } else {
        await handleAffectedDoc(docs._id, commit, !commit._s, ops)
      }
    } else {
      for (const docId of commit.affectedDoc) {
        await handleAffectedDoc(docId, commit, false, ops)
      }
    }
    await db.batch(ops)
  } catch (err) {
    console.error(err)
  }
}

async function getAffectedDoc(from, to) {
  const listCommitId = await new Promise((resolve, reject) => {
    let listCommitId = []
    stores.commitExecDate.createReadStream({
      gte: Buffer.from((+from).toString()),
      lte: Buffer.from((+to).toString())
    }).on('data', (data) => {
      listCommitId.push(data.value)
    }).on('error', (err) => {
      console.error(err)
      reject(err)
    }).on('close', () => {
    }).on('end', () => {
      resolve(listCommitId)
    })
  })
  if (!listCommitId.length) return null
  const lowerId = listCommitId[0]
  const commitResult = {}
  const docResult = {}
  const lowerBoundCommitIds = []
  for (let id of listCommitId) {
    const commit = await new Promise((resolve, reject) => {
      stores.commitStore.get(id, (err, value) => {
        if (err) reject(err)
        resolve(value)
      })
    })
    commitResult[id] = commit
    const affectedDoc = commit.affectedDoc.map(docId => `${docId}-${commit.collectionName}`)
    const docs = await stores.docCommit.getMany(affectedDoc)
    for (let idx in docs) {
      const unparsedData = docs[idx]
      const docId = commit.affectedDoc[idx]
      const data = jsonFn.parse(unparsedData)
      docResult[docId] = data
      lowerBoundCommitIds.push(...data.filter(commitData => commitData.id < lowerId))
    }
  }
  lowerBoundCommitIds.sort((a, b) => a.id <= b.id)
  const lowerBoundCommits = await stores.docCommit.getMany(lowerBoundCommitIds)
  for (let commit of lowerBoundCommits) {
    commitResult[commit.id] = commit
  }
  return {
    docs: docResult,
    commits: commitResult,
    lowerId
  }
}

if (!isMainThread) {
  create(workerData.path)
  initListener()
}

function initListener() {
  parentPort.on('message', async msg => {
    switch (msg.type) {
      case 'NEW_COMMIT':
        for (let commit of msg.commits) {
          await addCommit(commit, msg.addedDate)
        }
        parentPort.postMessage({
          type: 'GET_COMMIT'
        })
        break;
      case 'REPLAY_COMMIT':
        await doReplay(msg.highestCommitId)
        break;
      case 'GET_COMMIT':
        parentPort.postMessage({
          type: 'GET_COMMIT'
        })
        break;
      case 'GET_AFFECTED_DOC':
        const res = await getAffectedDoc(msg.from, msg.to)
        parentPort.postMessage({
          type: 'RECEIVE_AFFECTED_DOC',
          res
        })
        break;
    }
  })
  parentPort.postMessage({
    type: 'GET_COMMIT'
  })
}
