const orm = require('../../../orm')
const { TRANSPORT_LAYER_TAG } = require('../../../plugins/tags')
async function testMaster() {
  orm.connect({ uri: "mongodb://localhost:27017" });
  orm.registerCommitCollections({
    Test: ["Test"]
  });
  orm.setMultiDbMode()
  await orm.emit(`${TRANSPORT_LAYER_TAG}:onRegisterMode`)
  await orm.setMaster(true, 'db1')
  await orm.getCollection('Test', 'db1').deleteMany().direct()
  await orm.getCollection('Commit', 'db1').deleteMany().direct()
  orm.use(require("./testCommit"));
  const http = require('http')
  const socketIO = require('socket.io')

  const httpServer = http.createServer((req, res) => res.end()).listen(9000);
  const io = socketIO.listen(httpServer, {});

  io.on('connect', async socket => {
    await orm.emit(`${TRANSPORT_LAYER_TAG}:registerClientSocket`, socket, 'db1')
  })
}

testMaster()
