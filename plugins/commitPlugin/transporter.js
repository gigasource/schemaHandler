let clientSocket
let masterSocket

const TAG = require('../tags').TRANSPORT_LAYER_TAG
const COMMIT_LAYER_TAG = require('../tags').COMMIT_LAYER_TAG

function initTransporterWithOrm(orm) {
  orm.on('externalSocketConnected', socket => {
    onlineOrderSocket = socket
  })
  // for master socket
  orm.on(`${TAG}:registerClientSocket`, (_clientSocket, dbName) => {
    _clientSocket.on('requireSync', async () => {
      await orm.emit(`${COMMIT_LAYER_TAG}:requireSync`, ...arguments, dbName)
    })
    _clientSocket.on('sync', async () => {
      await orm.emit(`${COMMIT_LAYER_TAG}:sync`, ...arguments, dbName)
    })
    _clientSocket.on('nodeCall', async () => {
      await orm.emit(`${COMMIT_LAYER_TAG}:nodeCall`, ...arguments, dbName)
    })
    const emitToAllCb = (commits, _dbName) => {
      if (_dbName !== dbName) return
      _clientSocket.emit('sync', commits, dbName)
    }
    _clientSocket.on('disconnect', () => {
      orm.off(`${TAG}:emitToAll`, emitToAllCb)
    })
    orm.on(`${TAG}:emitToAll`, emitToAllCb)
  })
  // for node socket
  orm.on(`${TAG}:registerMasterSocket`, (_masterSocket, dbName) => {
    _masterSocket.on('sync', async function () {
      await orm.emit(`${COMMIT_LAYER_TAG}:sync`, ...arguments, dbName)
    })
    _masterSocket.on('masterCall', async function () {
      await orm.emit(`${COMMIT_LAYER_TAG}:masterCall`, ...arguments, dbName)
    })
    const syncCb = (commits, _dbName) => {
      if (_dbName !== dbName) return
      _masterSocket.emit('sync', commits, dbName)
    }
    _masterSocket.on('disconnect', function () {
      orm.off(`${TAG}:emitToMaster`, syncCb)
    })
    orm.on(`${TAG}:emitToMaster`, syncCb)
  })
  // for both socket
  orm.on(`${TAG}:sync`, async function (commits, dbName, isMaster) {
    if (typeof dbName === 'boolean') {
      isMaster = dbName
    }
    if (isMaster) {
      await orm.emit(`${COMMIT_LAYER_TAG}:sync`, commits)
    } else {
      await orm.emit(`${TAG}:emitToMaster`, commits, dbName)
    }
  })
}

module.exports = {
  TAG,
  initTransporterWithOrm
}
