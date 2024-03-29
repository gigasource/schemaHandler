const ObjectID = require('bson').ObjectID

const orm = require("../orm");

const url = 'mongodb://localhost:27017';
// Database Name
const dbName = 'myproject';
orm.setMultiDbMode();

async function run() {
  orm.registerCollectionOptions(() => true,() => true, {
    w: 1
  })

  orm.registerCollectionOptions(() => true,() => true, {
    r: 1
  })

  const options  = orm.getOptions('test', 'test');

  orm.registerSchema((col) => col.includes('Model'), dbName => dbName === 'myproject', {
    a: Number,
    b: {
      type: Number,
      default: 100
    },
    items: [{}],
    strArr: [String]
  });

  orm.on('update:Model@myproject:c', function (result, target) {
  });

  const Model = orm.getCollection('Model', dbName);
  await Model.remove();
  const _model0 = await Model.create({a: 10});
  const objs = await Model.insertMany([
    {a: 2, b: {c: 2, d: 4}}, {a: 3}, {a: 1}, {a: 1}, {a: 4}
  ], {new: true});
  const result3 = await Model.findOne({
    'items._id': {
      $in: [new ObjectID().toString(), new ObjectID().toString()]
    }
  });
  const _model = await Model.findOne({$or: [{a: 1}, {a: 3}]}).sort({a: 1}).lean();
  const result2 = await Model.findOne({_id: _model._id.toString()});
  const result5 =await Model.findOneAndUpdate({a: 1}, {$push: {items: {_id: new ObjectID().toString(), test: 'test'}}});
  await Model.updateMany({a: 1}, {b: 2});
  const test = await Model.updateOne({a: 1}, {b: 3}, {new: true});
  const result4 = await Model.find({a: 1});
  console.log(_model0);
  console.log(result2.toJSON());
  console.log(result4);
  console.log(await Model.findById(new ObjectID().toString()));
}

run();

setTimeout(() => {
  orm.connect(url, async (err) => {
  });
}, 1000);
