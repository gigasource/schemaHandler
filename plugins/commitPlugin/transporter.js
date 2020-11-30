let onlineOrderSocket
let masterSocket

const TAG = 'transportLayer'

function initTransporterWithOrm(orm) {
  orm.on('externalSocketConnected', socket => {
    onlineOrderSocket = socket
  })
  orm.on(`${TAG}:onMaster`, () => {

  })
}

module.exports = {
  TAG,
  initTransporterWithOrm
}
