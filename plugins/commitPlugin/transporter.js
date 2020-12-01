let onlineOrderSocket
let masterSocket

const TAG = 'transportLayer'

function initTransporterWithOrm(orm) {
  orm.on('externalSocketConnected', socket => {
    onlineOrderSocket = socket
  })
  orm.on(`${TAG}:onMaster`, (_masterSocket, dbName) => {
  })
  orm.on(`${TAG}:registerClientSocket`, (_clientSocket, dbName) => {

  })
  orm.on(`${TAG}:onClient`, (_clientSocket, dbName) => {

  })
  orm.on(`${TAG}:sync`)
}

module.exports = {
  TAG,
  initTransporterWithOrm
}
