const {ObjectID} = require("bson");
const {parseCondition} = require("../schemaHandler");

const orm = require('../orm');
orm.connect({
  uri: 'mongodb://mongo-vn-office.gigasource.io:27017',
  options: {
    user: 'root',
    password: 'oJMbSFE0l4vnsqcsr7IdQrNqpKzwCL3',
    authSource: 'admin'
  }
}, 'online-order', function (err) {
})

async function run() {
  orm.registerSchema('Store', {
    groups: [{
      type: ObjectID
    }]
  })

  const schema = orm.getSchema('Store');
  const _parseCondition = parseCondition(schema, {
    groups: {
      $elemMatch: {$in: [new ObjectID().toString(), new ObjectID().toString()]}
    }
  });

  const ids = ["5e9ef1e75365ba001badeb78", "5ebd08d015b0df001a08a0c2", "5ea01af3e23460001a4e79cf", "5eb50e4ffa89cdd960b2d3c7", "5e9f11f15365ba001badee0f", "5e955b043efd4747223fba89", "5ea65a770006460546a6a018", "5ea65163ab2961001b261b91", "5ea2530150cda6001b2cba7d", "5f28cdad6d58e1050cddc8f5", "5f2907446d58e1050cddca31", "5f64942fdf526f5bec703beb", "5f96b208dc2b5aa50af7da00", "5fab89d30b25e7001a20030b"]

  const Store = orm.getCollection('Store');
  const stores = await Store.find({groups: {$elemMatch: {$in: ids}}});
  console.log(stores)
}

run();
