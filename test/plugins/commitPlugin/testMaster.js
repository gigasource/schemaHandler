const orm = require('../../../orm')
async function testMaster() {
  orm.connect({ uri: "mongodb://localhost:27017" }, "master-project");
  orm.registerCommitCollections({
    Test: ["Test"]
  });
  await orm.getCollection('Test').deleteMany().direct()
  await orm.getCollection('Commit').deleteMany().direct()
  await orm.setMaster(true)
  orm.use(require("./testCommit"));
  const http = require('http')
  const socketIO = require('socket.io')

  const { TRANSPORT_LAYER_TAG } = require('../../../plugins/tags')

  const httpServer = http.createServer((req, res) => res.end()).listen(9000);
  const io = socketIO.listen(httpServer, {});

  io.on('connect', async socket => {
    await orm.emit(`${TRANSPORT_LAYER_TAG}:registerClientSocket`, socket)
  })
}

testMaster()
