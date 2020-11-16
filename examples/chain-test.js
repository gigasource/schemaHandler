const ObjectID = require('bson').ObjectID

const orm = require("../orm");
const {parseCondition} = require("../schemaHandler");

const url = 'mongodb://localhost:27017';
// Database Name
const dbName = 'myproject';
orm.setMultiDbMode();

async function run() {
  orm.registerSchema('Model', dbName => dbName === 'myproject', {
    a: Number,
    b: {
      type: Number,
      default: 100
    },
    items: [{}],
    date: Date,
    strArr: [String]
  });

  orm.post('update:Model@myproject:c', null, function (result, target) {
  });

  const Model = orm.getCollection('Model', dbName);
  await Model.remove();
  await Model.insertMany([{a: 1, b: 1}, {a: 10},{a: 10, date: new Date().toISOString()}]);

  const models12 = await Model.find({b:1}).find({a:10}).count();
  console.log(models12);
}

run();

setTimeout(() => {
  orm.connect(url, async (err) => {
  });
}, 1000);
