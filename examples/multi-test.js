const ObjectID = require('bson').ObjectID

const orm = require("../orm");

const url = 'mongodb://localhost:27017';
// Database Name
const dbName = 'myproject';
orm.setMultiDbMode();

orm.connect(url, async (err) => {
  orm.registerSchema('Model', dbName, {
    a: Number,
    b: {
      type: Number,
      default: 100
    },
    items: [{}],
    strArr: [String]
  });
  const Model = orm.getCollection('Model', dbName);
  await Model.deleteMany();
  const _model0 = await Model.create({a: 10});
  await Model.insertMany([
    {a: 2, b: {c: 2, d: 4}}, {a: 3}, {a: 1}, {a: 1}, {a: 4}
  ], {new: true});
  const result3 = await Model.findOne({
    'items._id': {
      $in: [new ObjectID().toString(), new ObjectID().toString()]
    }
  });
  const _model = await Model.findOne({$or: [{a: 1}, {a: 3}]}).sort({a: 1}).lean();
  const result2 = await Model.findOne({_id: _model._id.toString()});
  await Model.findOneAndUpdate({a: 1}, {$push: {items: {$each: [{_id: new ObjectID().toString(), test: 'test'}]}}}, {new: true});
  await Model.updateMany({a: 1}, {b: 2}, {new: true});
  const result4 = await Model.find({a: 1});
  console.log(_model0);
  console.log(result2.toJSON());
  console.log(result4);
  console.log(await Model.findById(new ObjectID().toString()));
});
