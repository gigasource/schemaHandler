const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const orm = require("../orm");
const {ObjectID} = require("bson");
const {stringify} = require("../utils");
const _ = require('lodash');
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require('uuid').v1;

describe("commit-sync", function () {
  beforeAll(async () => {
    orm.connect({uri: "mongodb://localhost:27017"}, 'myproject');
    schema = {
      table: String,
    };
  });

  it("case1", async function () {
    const Model = orm("Model");
    await Model.remove({})

    orm.on('pre:execChain', async function (query) {
      query.uuid = uuid();
    })

    //replace with once later
    orm.on('proxyResultPostProcess', async ({target, result}) => {
      if (target.collectionName === 'Model') {
        const _id = result._id;
        if (target.query.commit) {
          const _result = await orm(target.collectionName).findOneAndUpdate({_id}, {$set: {_fake: true}});
          this.value = _result;
          this.ok = true;
        }
      }
    })

    orm.on('pre:execChain', async function (query) {
      const last = _.last(query.chain);
      if (last.fn === 'commit') {
        query.chain.pop();
        let _chain = [...query.chain];
        const {args} = last;
        const commit = {
          tags: args.filter(arg => typeof arg === 'string'),
          data: _.assign({}, ...args.filter(arg => typeof arg === 'object')),
          chain: JSON.stringify(_chain),
          _fake: true
        }

        const CommitCol = orm(`${query.name}Commit`);
        //commitId: incremental
        const _commit = await CommitCol.create(commit);
        await orm.emit(`commit:${query.name}`, _commit, query);
        //remove later:
        query.commit = true;

        //test behavior if not create model
      }
    })

    //Làm sao để assign duoc _id cho doc vua duoc tao ra
    //gen ra uuid cho mỗi câu lệnh query, từ đó hooks vào kết quả sau khi tạo ra
    //cần once : -> ko bị leak memory
    orm.on('commit:Model', async (commit, query) => {
      debugger
      //returnResult.ok = true;
      //returnResult.value = commit;
      //debugger
    })

    orm.on('//approve event', async () => {
      //sync data
      //remove fake
      //build model
      //do something custom
    })

    //order._fake = true;


    const m1 = await Model.create({table: 10, items: [{name: 'cola', price: 10, quantity: 1}]})
      .commit('update', {table: '10'});
    //fake chi apply voi cac lenh apply cho one document

    //todo: save chain in db: use 1 collection ?? compound index?
    //todo: fake + approve process:


  });


});
