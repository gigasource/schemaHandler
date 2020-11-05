const orm = require("../orm");

const url = 'mongodb://localhost:27017';
// Database Name
const dbName = 'myproject';
//orm.setMultiDbMode();

orm.connect(url, dbName, async (err) => {
  const Model = orm.getCollection('Model');
  await Model.insertMany([
    {a: 2, b: {c: 2, d: 4}}, {a: 3}, {a: 1}, {a: 4}
  ]);
  const _model = await Model.findOne({$or: [{a: 1}, {a: 3}]}).sort({a: 1}).lean();
  console.log(_model);
});
