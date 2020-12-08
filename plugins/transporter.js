let clientSocket
let masterSocket

const TAG = require('./tags').TRANSPORT_LAYER_TAG
const COMMIT_LAYER_TAG = require('./tags').COMMIT_LAYER_TAG
const jsonFn = require('json-fn')

module.exports = function (orm) {
  let isMaster = false
  let setMaster = async (_isMaster) => {
    isMaster = _isMaster
    await orm.emit('setMaster', isMaster)
  }

  orm.on(`${TAG}:onRegisterMode`, function () {
    if (orm.mode === 'single') {
      isMaster = false
      setMaster = async (_isMaster) => {
        isMaster = _isMaster
        if (!_isMaster) {
          await orm.emit('turnMasterOff')
        }
        await orm.emit('setMaster', isMaster)
      }
    } else {
      isMaster = {}
      setMaster = async (_isMaster, dbName) => {
        isMaster[dbName] = _isMaster
        if (!_isMaster) {
          await orm.emit('turnMasterOff', dbName)
        }
        await orm.emit('setMaster', _isMaster, dbName)
      }
    }
    orm.setMaster = setMaster
  })

  // orm.on('setMaster', async (isMaster, dbName) => {
  //   if (!isMaster) {
  //     await orm.emit('turnMasterOff', dbName)
  //   }
  // })

  const getMaster = (dbName) => {
    return dbName ? isMaster[dbName] : isMaster
  }

  const convertDbname = function (commits, dbName) {
    const convert = (commit) => {
      commit.query = jsonFn.parse(commit.query)
      if (commit.query.name.includes('@')) {
        commit.query.name = dbName ? `${commit.query.name.split('@')[0]}@${dbName}` : commit.query.name.split('@')[0]
      } else {
        commit.query.name = dbName ? `${commit.query.name}@${dbName}` : commit.query.name
      }
      commit.query = jsonFn.stringify(commit.query)
    }
    if (Array.isArray(commits)) {
      commits.forEach(commit => {
        convert(commit)
      })
    } else {
      convert(commits)
    }
  }

  // for master socket
  orm.on(`${TAG}:registerClientSocket`, (_clientSocket, dbName) => {
    _clientSocket.on('requireSync', async function () {
      await orm.emit(`${COMMIT_LAYER_TAG}:requireSync`, ...arguments, dbName)
    })
    _clientSocket.on('sync', async function (commits) {
      convertDbname(commits, dbName)
      await orm.emit(`${COMMIT_LAYER_TAG}:sync`, commits)
    })
    _clientSocket.on('nodeCall', async function () {
      await orm.emit(`${COMMIT_LAYER_TAG}:nodeCall`, ...arguments, dbName)
    })
    const emitToAllCb = (commits, _dbName) => {
      if (_dbName !== dbName) return
      _clientSocket.emit('sync', commits)
    }
    const turnMasterOff = (_dbName) => {
      if (_dbName !== dbName) return
      _clientSocket.disconnect()
    }
    _clientSocket.on('disconnect', () => {
      orm.off(`${TAG}:emitToAll`, emitToAllCb)
      orm.off(`${TAG}:turnMasterOff`, turnMasterOff)
    })
    orm.on(`${TAG}:emitToAll`, emitToAllCb)
    orm.on(`${TAG}:turnMasterOff`, turnMasterOff)
  })
  // for node socket
  orm.on(`${TAG}:registerMasterSocket`, (_masterSocket, dbName) => {
    _masterSocket.on('sync', async function (commits) {
      convertDbname(commits, dbName)
      await orm.emit(`${COMMIT_LAYER_TAG}:sync`, commits)
    })
    _masterSocket.on('masterCall', async function () {
      await orm.emit(`${COMMIT_LAYER_TAG}:masterCall`, ...arguments, dbName)
    })
    const syncCb = (commits, _dbName) => {
      if (_dbName !== dbName) return
      _masterSocket.emit('sync', commits)
    }
    _masterSocket.on('disconnect', function () {
      orm.off(`${TAG}:emitToMaster`, syncCb)
    })
    orm.on(`${TAG}:emitToMaster`, syncCb)
  })
  // for both socket
  orm.on(`${TAG}:sync`, async function (commits, dbName) {
    if (isMaster) {
      await orm.emit(`${COMMIT_LAYER_TAG}:sync`, commits)
    } else {
      await orm.emit(`${TAG}:emitToMaster`, commits, dbName)
    }
  })

  Object.assign(orm, {
    getMaster,
    setMaster
  })
}

module.exports.TAG = TAG
