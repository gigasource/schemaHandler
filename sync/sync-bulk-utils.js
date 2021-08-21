const _ = require('lodash')

module.exports = function (orm) {
  orm.doCreateBulk = doCreateBulk
  orm.handleFakeBulkWrite = handleFakeBulkWrite

  async function handleFakeBulkWrite(col, fakeId) {
    const currentDate = new Date()
    await orm('Recovery' + col).update({ _fakeId: { $exists: false } }, { _fakeId: fakeId, _fakeDate: currentDate }).direct()
  }

  const supportedQuery = ['updateOne', 'insertOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne']
  const convertedQuery = {
    'findOneAndUpdate': 'updateOne'
  }
  function convertChain(chain) {
    let result
    switch (chain[0].fn) {
      case 'updateOne':
        if (chain[0].args.length < 2) return null
        result = {
          updateOne: {
            filter: chain[0].args[0],
            update: chain[0].args[1],
            ...chain[0].args.length >= 3 && chain[0].args[2].upsert && {
              upsert: true
            },
            ...chain[0].args.length >= 3 && chain[0].args[2].arrayFilters && {
              arrayFilters: chain[0].args[2].arrayFilters
            },
          }
        }
        break
      case 'updateMany':
        if (chain[0].args.length < 2) return null
        result = {
          updateMany: {
            filter: chain[0].args[0],
            update: chain[0].args[1],
            ...chain[0].args.length >= 3 && chain[0].args[2].upsert && {
              upsert: true
            },
            ...chain[0].args.length >= 3 && chain[0].args[2].arrayFilters && {
              arrayFilters: chain[0].args[2].arrayFilters
            },
          }
        }
        break
      case 'replaceOne':
        if (chain[0].args.length < 2) return null
        result = {
          replaceOne: {
            filter: chain[0].args[0],
            replacement: chain[0].args[1],
            ...chain[0].args.length >= 3 && chain[0].args[2].upsert && {
              upsert: true
            },
          }
        }
        break
      case 'deleteOne':
        result = {
          deleteOne: {
            filter: chain[0].args.length ? chain[0].args[0] : {}
          }
        }
        break
      case 'deleteMany':
        result = {
          deleteMany: {
            filter: chain[0].args.length ? chain[0].args[0] : {}
          }
        }
        break
      case 'insertOne':
        if (chain[0].args.length < 1) return null
        result = {
          insertOne: {
            document: chain[0].args[0]
          }
        }
        break
    }
    // deal with case $set
    if (result.updateMany || result.updateOne) {
      let queryOp = result.updateMany ? 'updateMany' : 'updateOne'
      const ops = Object.keys(result[queryOp]['update'])
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]
        if (op[0] !== '$') {
          if (!result[queryOp]['update'].$set) {
            result[queryOp]['update'].$set = {}
          }
          result[queryOp]['update'].$set[op] = result[queryOp]['update'][op]
          delete result[queryOp]['update'][op]
        }
      }
      return result
    } else {
      return result
    }
  }

  async function doBulkQuery(col, bulkOp) {
    await orm.removeFakeOfCollection(col, {})
    while (true) {
      try {
        if (!bulkOp.length) return
        await orm(col).bulkWrite(bulkOp).direct()
        await orm('CommitData').updateOne({}, {  [`highestCommitIdOfCollection.${col}`]: _.last(bulkOp).id  })
        orm.setHighestCommitIdOfCollection(col, _.last(bulkOp).id)
        return
      } catch (e) {
        if (e.errors && e.errors.length >= 2 && e.errors[1].name === 'BulkWriteError'
          && e.errors[1].writeErrors.length && e.errors[1].writeErrors[0].err && e.errors[1].writeErrors[0].err.index !== undefined) {
          const index = e.errors[1].writeErrors[0].err.index
          await orm('CommitData').updateOne({}, { [`highestCommitIdOfCollection.${col}`]: bulkOp[index].id })
          orm.setHighestCommitIdOfCollection(col, bulkOp[index].id)
          bulkOp = bulkOp.slice(index + 1)
        } else {
          console.error('Wrong thing happened in bulk write', e.message)
          return
        }
      }
    }
  }

  async function doCreateBulk(commits) {
    const bulkOp = {}
    for (const commit of commits) {
      const { value: highestId } = await orm.emit('getHighestCommitId', commit.dbName)
      if (commit.id <= highestId) continue
      const _query = orm.getQuery(commit)
      if (!_query.chain.length) continue
      if (supportedQuery.includes(_query.chain[0].fn) || convertedQuery[_query.chain[0].fn]) {
        if (convertedQuery[_query.chain[0].fn])
          _query.chain[0].fn = convertedQuery[_query.chain[0].fn]
        const convertedChain = convertChain(_query.chain)
        convertedChain.id = commit.id
        if (convertedChain) {
          const run = !(await orm.emit(`commit:handler:shouldNotExecCommand:${commit.collectionName}`, commit));
          if (!run) continue
          if (!bulkOp[commit.collectionName]) bulkOp[commit.collectionName] = []
          bulkOp[commit.collectionName].push(convertedChain)
        }
      } else {
        if (bulkOp[commit.collectionName] && bulkOp[commit.collectionName].length) {
          await doBulkQuery(commit.collectionName, bulkOp[commit.collectionName])
          bulkOp[commit.collectionName] = []
        }
        await orm.emit('createCommit', commit)
      }
    }
    const keys = Object.keys(bulkOp)
    for (let key of keys) {
      if (bulkOp[key].length) {
        await doBulkQuery(key, bulkOp[key])
      }
    }
    await orm('CommitData').updateOne({}, {
      highestCommitId:  _.last(commits).id
    })
    orm.emit('commit:handler:finish', _.last(commits))
    orm.emit('commit:handler:finish:bulk', keys, _.last(commits).id)
  }

  orm.on('handleBulkFake', function (bulkOps) {
    let result = {
      $or: []
    }
    for (let ops of bulkOps) {
      const key = Object.keys(ops)[0]
      if (ops[key].filter)
        result.$or.push(ops[key].filter)
    }
    this.setValue(result)
  })
}
